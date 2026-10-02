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
import { createCandidate, PgSemanticSearch, promoteCandidate, recordMetric } from './store';

type Dependencies = { standardAuth: express.RequestHandler; mutationGuard: express.RequestHandler; rateLimiter: express.RequestHandler };
export function registerIntelligentRouterRoutes(app: express.Express, d: Dependencies, runtime: { config?: ReturnType<typeof routerConfig>; embedding?: EmbeddingProvider; authorization?: ReasoningAuthorization } = {}) {
  const config = runtime.config ?? routerConfig(), embedding = runtime.embedding ?? createEmbedding(config), authorization = runtime.authorization ?? createAuthorization(config), cache = new EmbeddingCache();
  const actor = (req: express.Request) => ({ tenantId: req.authUser!.tenantId, employeeId: req.authUser!.employeeId });
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
      if (['REVIEW_DENIED','CANDIDATE_UNAVAILABLE','INVALID_QUERY','CONTRADICTORY_EXAMPLE','EMBEDDING_DISABLED'].includes(code)) {
        res.status(code === 'REVIEW_DENIED' ? 403 : code === 'CANDIDATE_UNAVAILABLE' ? 404 : code === 'EMBEDDING_DISABLED' ? 503 : 400).json({success:false,code}); return;
      }
      logServerError(`[Router:${requestId}]`,error);
      res.status(503).json({success:false,code:'ROUTER_UNAVAILABLE'});
    }
  });
  route('get','/api/command-router/status',async req => {
    const u = actor(req), state = await authorization.resolve(u);
    const canReview = await withTenant(u.tenantId,c => review(c,u));
    return { mode:config.mode,reasoningState:state.state,embeddingConfigured:Boolean(embedding),learningEnabled:config.learning,canReview };
  });
  route('post','/api/command-router/resolve',async req => {
    if (typeof req.body?.query !== 'string' || !req.body.query.trim() || req.body.query.length>500 || Object.keys(req.body).some(k => !['query','allowReasoning','learn'].includes(k)) || req.body.allowReasoning !== undefined && typeof req.body.allowReasoning !== 'boolean' || req.body.learn !== undefined && typeof req.body.learn !== 'boolean') throw Error('INVALID_QUERY');
    const u = actor(req);
    const result = await resolveQuery(req.body.query,{actor:u,allowed:i => allowed(u,i),available:()=>available(u),search:new PgSemanticSearch(u.tenantId,config.topK),embedding,authorization:req.body.allowReasoning === true ? authorization : {resolve:async () => ({state:'disabled'})},cache,minimumScore:config.minimumScore,minimumMargin:config.minimumMargin});
    // Optional persistence cannot break deterministic routing during migration/provider outages.
    try { await withTenant(u.tenantId,async c => {
      if (config.learning && req.body.learn === true) result.candidateId = await createCandidate(c,u.tenantId,u.employeeId,req.body.query,result);
      await recordMetric(c,u.tenantId,result,result.candidateId ? 1 : 0);
    }); } catch (error) { delete result.candidateId; logServerError('[Router telemetry]',error); }
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
