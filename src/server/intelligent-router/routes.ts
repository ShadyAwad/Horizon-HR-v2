import type express from 'express';
import type { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { withTenant } from '../../lib/hr-background';
import { logServerError } from '../../lib/server-logging';
import { INTENTS, getIntent, type Intent } from '../../lib/intelligent-router';
import { resolveScopedPermission } from '../organisation/scoped-permissions';
import { recordAuditEvent } from '../audit/audit-events';
import { createAuthorization, createEmbedding, routerConfig } from './config';
import { EmbeddingCache, type EmbeddingProvider, type ReasoningAuthorization } from './providers';
import { resolveQuery } from './router';
import { RouterTelemetry } from './telemetry';
import { LocalOpenAIProfileStore } from './openai-profile-store';
import { LocalOpenAIAuth, localOpenAIEnabled, retainLocalAuthorization } from './openai-local-auth';
import { createCandidate, PgSemanticSearch, promoteCandidate, recordMetric } from './store';

type Dependencies = { standardAuth: express.RequestHandler; mutationGuard: express.RequestHandler; rateLimiter: express.RequestHandler };
export function registerIntelligentRouterRoutes(app: express.Express, d: Dependencies, runtime: { config?: ReturnType<typeof routerConfig>; embedding?: EmbeddingProvider; authorization?: ReasoningAuthorization } = {}) {
  const config = runtime.config ?? routerConfig(), embedding = runtime.embedding ?? createEmbedding(config), cache = new EmbeddingCache();
  const userAuthorization = localOpenAIEnabled() ? new LocalOpenAIAuth(process.env.STANZA_ROUTER_OPENAI_HOST_ID!,config.model,u => withTenant(u.tenantId,async c => Boolean((await c.query('SELECT 1 FROM auth_sessions WHERE tenant_id=$1 AND employee_id=$2 AND id=$3 AND revoked_at IS NULL AND expires_at>now()',[u.tenantId,u.employeeId,u.sessionId])).rowCount)),fetch,new LocalOpenAIProfileStore(process.env.STANZA_ROUTER_OPENAI_HOST_ID!)) : undefined;
  if(userAuthorization)retainLocalAuthorization(userAuthorization);
  const authorization = runtime.authorization ?? createAuthorization(config,process.env,{user:userAuthorization});
  const telemetry = new RouterTelemetry(error => { const code=(error as {code?:unknown})?.code; logServerError('[Router telemetry; retry in 60s]',typeof code==='string' && /^[0-9A-Z]{5}$/.test(code) ? {code:'SQLSTATE_'+code} : error); });
  const actor = (req: express.Request) => ({ tenantId: req.authUser!.tenantId, employeeId: req.authUser!.employeeId, sessionId: req.authSessionId });
  const permission = async (c: PoolClient, u: ReturnType<typeof actor>, key: string, company = false) => (await resolveScopedPermission(c, { tenantId: u.tenantId, actorEmployeeId: u.employeeId, permissionKey: key, ...(company ? {} : { targetEmployeeId: u.employeeId }) })).allowed;
  const active = async (c: PoolClient, u: ReturnType<typeof actor>) => Boolean((await c.query("SELECT 1 FROM employees WHERE tenant_id=$1 AND id=$2 AND is_active AND employment_status='active'", [u.tenantId,u.employeeId])).rowCount);
  const allowed = async (u: ReturnType<typeof actor>, i: Intent) => withTenant(u.tenantId, async c => {
    if (!await active(c,u)) return false;
    if (!i.permissions.length) return true;
    for (const p of i.permissions) if (await permission(c,u,p)) return true;
    return false;
  });
  const available = (u: ReturnType<typeof actor>) => withTenant(u.tenantId, async c => {
    if (!await active(c,u)) return [];
    const intents: Intent[] = [];
    for (const i of INTENTS) {
      if (!getIntent(i.key)) continue;
      if (!i.permissions.length) { intents.push(i); continue; }
      for (const p of i.permissions) if (await permission(c,u,p)) { intents.push(i); break; }
    }
    return intents;
  });
  const review = async (c: PoolClient, u: ReturnType<typeof actor>) => await active(c,u) && await permission(c,u,'roles.manage',true);
  const route = (method: 'get' | 'post', url: string, fn: (req: express.Request) => Promise<object>) => app[method](url,d.standardAuth,d.rateLimiter,...(method === 'post' ? [d.mutationGuard] : []),async (req,res) => {
    const requestId = randomUUID();
    res.setHeader('X-Stanza-Router-Request-Id',requestId);
    res.setHeader('Cache-Control','no-store');
    try { res.json({ success:true,...await fn(req) }); }
    catch (error) {
      const code = error instanceof Error ? error.message : '';
      if (['REVIEW_DENIED','CANDIDATE_UNAVAILABLE','INVALID_QUERY','CONTRADICTORY_EXAMPLE','EMBEDDING_DISABLED','OPENAI_AUTH_UNAVAILABLE','OPENAI_SESSION_REQUIRED','OPENAI_AUTH_BUSY','OPENAI_MODEL_UNAVAILABLE','OPENAI_STORE_UNAVAILABLE','OPENAI_STORE_BUSY','OPENAI_RAW_CHECK_REQUIRED'].includes(code)) {
        res.status(code === 'REVIEW_DENIED' ? 403 : code === 'CANDIDATE_UNAVAILABLE' ? 404 : code.startsWith('OPENAI_') || code === 'EMBEDDING_DISABLED' ? 503 : 400).json({success:false,code}); return;
      }
      logServerError(`[Router:${requestId}]`,error);
      res.status(503).json({success:false,code:'ROUTER_UNAVAILABLE'});
    }
  });
  route('post','/api/command-router/openai/connect',async req => {
    if(!userAuthorization)throw Error('OPENAI_AUTH_UNAVAILABLE');
    return userAuthorization.start(actor(req));
  });
  route('get','/api/command-router/openai/models',async req => {
    if(!userAuthorization)throw Error('OPENAI_AUTH_UNAVAILABLE');
    return {models:await userAuthorization.models(actor(req))};
  });
  route('post','/api/command-router/openai/model',async req => {
    if(!userAuthorization)throw Error('OPENAI_AUTH_UNAVAILABLE');
    if(Object.keys(req.body ?? {}).some(k=>k!=='model'))throw Error('INVALID_QUERY');
    return userAuthorization.selectModel(actor(req),req.body?.model);
  });
  route('post','/api/command-router/openai/probe',async req => {
    if(!userAuthorization)throw Error('OPENAI_AUTH_UNAVAILABLE');
    if(!['raw','structured'].includes(req.body?.mode) || Object.keys(req.body ?? {}).some(k=>k!=='mode'))throw Error('INVALID_QUERY');
    return {probe:await userAuthorization.probe(actor(req),req.body.mode==='structured')};
  });
  route('post','/api/command-router/openai/disconnect',async req => {
    if(!userAuthorization)throw Error('OPENAI_AUTH_UNAVAILABLE');
    return userAuthorization.disconnect(actor(req));
  });
  route('get','/api/command-router/status',async req => {
    const u = actor(req), state = await authorization.resolve(u);
    const canReview = await withTenant(u.tenantId,c => review(c,u));
    const semanticState = await withTenant(u.tenantId, async c => {
      const catalog = (await c.query("SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='vector') AS vector, to_regclass('router_semantic_examples') IS NOT NULL AS migrated")).rows[0];
      if (!catalog.vector) return 'pgvector_missing';
      if (!catalog.migrated) return 'migration_required';
      if (!embedding) return 'credentials_missing';
      const examples = await c.query('SELECT 1 FROM router_semantic_examples WHERE approval_state=$1 AND embedding_model=$2 AND embedding_dimensions=$3 AND embedding_version=$4 AND (tenant_id IS NULL OR tenant_id=$5) LIMIT 1', ['approved',embedding.model,embedding.dimensions,embedding.version,u.tenantId]);
      return examples.rowCount ? 'configured_not_verified' : 'examples_missing';
    });
    return { openaiLocalAvailable:Boolean(userAuthorization),openaiConnection:userAuthorization ? await userAuthorization.status(u) : null,mode:config.mode,reasoningState:state.state,embeddingConfigured:Boolean(embedding),semanticState,learningEnabled:config.learning,canReview };
  });
  route('post','/api/command-router/resolve',async req => {
    if (typeof req.body?.query !== 'string' || !req.body.query.trim() || req.body.query.length>500 || Object.keys(req.body).some(k => !['query','allowReasoning','learn'].includes(k)) || req.body.allowReasoning !== undefined && typeof req.body.allowReasoning !== 'boolean' || req.body.learn !== undefined && typeof req.body.learn !== 'boolean') throw Error('INVALID_QUERY');
    const u = actor(req);
    const result = await resolveQuery(req.body.query,{actor:u,allowed:i => allowed(u,i),available:()=>available(u),search:new PgSemanticSearch(u.tenantId,config.topK),embedding,authorization:req.body.allowReasoning === true ? authorization : {resolve:async () => ({state:'disabled'})},cache,minimumScore:config.minimumScore,minimumMargin:config.minimumMargin});
    // Optional persistence cannot break deterministic routing during migration/provider outages.
    const persisted = await telemetry.record(() => withTenant(u.tenantId,async c => {
      if (config.learning && req.body.learn === true) result.candidateId = await createCandidate(c,u.tenantId,u.employeeId,req.body.query,result);
      await recordMetric(c,u.tenantId,result,result.candidateId ? 1 : 0);
    }));
    if (!persisted) delete result.candidateId;
    return { result };
  });
  route('post','/api/command-router/candidates/:id/confirm',async req => {
    const u=actor(req), id=req.params.id;
    if (!/^[a-f0-9-]{36}$/i.test(id)) throw Error('CANDIDATE_UNAVAILABLE');
    return withTenant(u.tenantId,async c => {
      const row=(await c.query("SELECT * FROM router_candidates WHERE tenant_id=$1 AND employee_id=$2 AND id=$3 AND review_state='pending' AND expires_at>now()",[u.tenantId,u.employeeId,id])).rows[0];
      const i=getIntent(row?.proposed_intent);
      if (!row || !i || !await allowed(u,i)) throw Error('CANDIDATE_UNAVAILABLE');
      await c.query("UPDATE router_candidates SET confirmation_state='confirmed' WHERE tenant_id=$1 AND employee_id=$2 AND id=$3",[u.tenantId,u.employeeId,id]);
      return {confirmed:true};
    });
  });
  route('get','/api/command-router/candidates',async req => {
    const u=actor(req);
    return withTenant(u.tenantId,async c => {
      if (!await review(c,u)) throw Error('REVIEW_DENIED');
      return {candidates:(await c.query("SELECT id,normalized_query,proposed_intent,created_at FROM router_candidates WHERE tenant_id=$1 AND review_state='pending' AND confirmation_state='confirmed' AND expires_at>now() ORDER BY created_at LIMIT 50",[u.tenantId])).rows};
    });
  });
  route('post','/api/command-router/candidates/:id/review',async req => {
    const u=actor(req), id=req.params.id;
    if (!/^[a-f0-9-]{36}$/i.test(id) || !['approve','reject'].includes(req.body?.decision)) throw Error('INVALID_QUERY');
    if (req.body.decision==='approve') {
      if (!embedding) throw Error('EMBEDDING_DISABLED');
      return promoteCandidate(u.tenantId,u.employeeId,id,embedding,c => review(c,u));
    }
    return withTenant(u.tenantId,async c => {
      if (!await review(c,u)) throw Error('REVIEW_DENIED');
      const row=await c.query("UPDATE router_candidates SET review_state='rejected',reviewed_at=now(),reviewed_by=$3 WHERE tenant_id=$1 AND id=$2 AND review_state='pending' RETURNING id",[u.tenantId,id,u.employeeId]);
      if (!row.rowCount) throw Error('CANDIDATE_UNAVAILABLE');
      await recordAuditEvent(c,{tenantId:u.tenantId,actorId:u.employeeId,action:'router.example_rejected',targetType:'router_candidate',targetId:id});
      return {rejected:true};
    });
  });
  route('get','/api/command-router/metrics',async req => {
    const u=actor(req);
    return withTenant(u.tenantId,async c => {
      if (!await review(c,u)) throw Error('REVIEW_DENIED');
      const metrics=(await c.query('SELECT * FROM router_daily_metrics WHERE tenant_id=$1 AND day>=current_date-30 ORDER BY day,method',[u.tenantId])).rows;
      const vectorMetrics=(await c.query(`SELECT day,embedding_model,embedding_dimensions,embedding_version,queries,semantic_row_count,cardinality(latency_samples) AS sample_count,
        (SELECT percentile_cont(.5) WITHIN GROUP(ORDER BY latency) FROM unnest(latency_samples) latency) AS p50_ms,
        (SELECT percentile_cont(.95) WITHIN GROUP(ORDER BY latency) FROM unnest(latency_samples) latency) AS p95_ms
        FROM router_vector_metrics WHERE tenant_id=$1 AND day>=current_date-30 ORDER BY day`,[u.tenantId])).rows;
      return {metrics,vectorMetrics};
    });
  });
}
