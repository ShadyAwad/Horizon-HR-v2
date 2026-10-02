import type { PoolClient } from 'pg';
import { withTenant } from '../../lib/hr-background';
import { getIntent, normalizeQuery, type RouterResult } from '../../lib/intelligent-router';
import { validateVector, type EmbeddingProvider } from './providers';
import type { SemanticSearch } from './router';
import { recordAuditEvent } from '../audit/audit-events';

export class PgSemanticSearch implements SemanticSearch {
  constructor(readonly tenantId: string, readonly topK: number) {}
  async search(vector: number[], provider: EmbeddingProvider, allowedKeys: string[]) {
    const literal = JSON.stringify(validateVector(vector, provider.dimensions));
    return withTenant(this.tenantId, async c => {
      // Materialized spaces ensure incompatible dimensions never reach the distance operator.
      // Deliberate system + tenant searches avoid a tenant corpus displacing system top K.
      const start = performance.now();
      const rows = await c.query(`WITH space AS MATERIALIZED (
        SELECT intent_key,embedding,tenant_id FROM router_semantic_examples WHERE approval_state='approved'
        AND embedding_model=$3 AND embedding_dimensions=$4 AND embedding_version=$5 AND intent_key=ANY($6::text[])
        AND (tenant_id IS NULL OR tenant_id=$1)
      ), system_hits AS (SELECT intent_key,1-(embedding <=> $2::vector) AS score FROM space WHERE tenant_id IS NULL ORDER BY embedding <=> $2::vector LIMIT $7),
      tenant_hits AS (SELECT intent_key,1-(embedding <=> $2::vector) AS score FROM space WHERE tenant_id=$1 ORDER BY embedding <=> $2::vector LIMIT $7)
      SELECT COALESCE((SELECT jsonb_agg(h) FROM (SELECT * FROM system_hits UNION ALL SELECT * FROM tenant_hits) h),'[]'::jsonb) AS hits,
      (SELECT count(*) FROM space) AS semantic_row_count`, [this.tenantId, literal, provider.model, provider.dimensions, provider.version, allowedKeys, this.topK]);
      const latency = performance.now() - start;
      // Rolling sample of 256 vector-query timings, never queries or embeddings.
      // Metrics failure is isolated by a savepoint so retrieval remains usable.
      await c.query('SAVEPOINT router_vector_telemetry');
      try {
        await c.query(`INSERT INTO router_vector_metrics(tenant_id,embedding_model,embedding_dimensions,embedding_version,queries,semantic_row_count,latency_samples)
          VALUES($1,$2,$3,$4,1,$5,ARRAY[$6::double precision])
          ON CONFLICT(tenant_id,day,embedding_model,embedding_dimensions,embedding_version) DO UPDATE SET queries=router_vector_metrics.queries+1,semantic_row_count=EXCLUDED.semantic_row_count,
          latency_samples=router_vector_metrics.latency_samples[greatest(1,cardinality(router_vector_metrics.latency_samples)-254):]||EXCLUDED.latency_samples`,
          [this.tenantId,provider.model,provider.dimensions,provider.version,rows.rows[0].semantic_row_count,latency]);
      } catch { await c.query('ROLLBACK TO SAVEPOINT router_vector_telemetry'); }
      await c.query('RELEASE SAVEPOINT router_vector_telemetry');
      return rows.rows[0].hits.map((r: {intent_key:string;score:number}) => ({ intentKey: r.intent_key, score: Number(r.score) }));
    });
  }
}
export async function recordMetric(c: PoolClient, tenant: string, r: RouterResult, candidate = 0, promotion = 0, request = true) {
  await c.query(`INSERT INTO router_daily_metrics(tenant_id,method,outcome,intent_key,requests,latency_ms,semantic_score_sum,semantic_margin_sum,semantic_samples,fallbacks,candidates,promotions)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    ON CONFLICT(tenant_id,day,method,outcome,intent_key) DO UPDATE SET requests=router_daily_metrics.requests+EXCLUDED.requests,latency_ms=router_daily_metrics.latency_ms+EXCLUDED.latency_ms,
    semantic_score_sum=router_daily_metrics.semantic_score_sum+EXCLUDED.semantic_score_sum,semantic_margin_sum=router_daily_metrics.semantic_margin_sum+EXCLUDED.semantic_margin_sum,semantic_samples=router_daily_metrics.semantic_samples+EXCLUDED.semantic_samples,
    fallbacks=router_daily_metrics.fallbacks+EXCLUDED.fallbacks,candidates=router_daily_metrics.candidates+EXCLUDED.candidates,promotions=router_daily_metrics.promotions+EXCLUDED.promotions`,
  [tenant,r.method,r.outcome,r.intentKey ?? '',request ? 1 : 0,r.latencyMs ?? 0,r.score ?? 0,r.margin ?? 0,r.score === undefined ? 0 : 1,r.fallbackUsed ? 1 : 0,candidate,promotion]);
}
export async function createCandidate(c: PoolClient, tenant: string, employee: string, query: string, r: RouterResult) {
  if (r.method !== 'llm' || r.outcome !== 'matched' || !getIntent(r.intentKey)) return undefined;
  const result = await c.query(`INSERT INTO router_candidates(tenant_id,employee_id,normalized_query,proposed_intent) VALUES($1,$2,$3,$4)
    ON CONFLICT(tenant_id,employee_id,normalized_query,proposed_intent) DO NOTHING RETURNING id`, [tenant,employee,normalizeQuery(query),r.intentKey]);
  return result.rows[0]?.id as string | undefined;
}
/** Call only after company-scoped review authorization. Provider work occurs outside DB locks. */
export async function promoteCandidate(tenant: string, reviewer: string, id: string, provider: EmbeddingProvider, checkReview: (c: PoolClient) => Promise<boolean>) {
  const candidate = await withTenant(tenant, async c => {
    if (!await checkReview(c)) throw Error('REVIEW_DENIED');
    return (await c.query("SELECT * FROM router_candidates WHERE tenant_id=$1 AND id=$2 AND confirmation_state='confirmed' AND review_state='pending' AND expires_at>now()", [tenant,id])).rows[0];
  });
  if (!candidate || !getIntent(candidate.proposed_intent)) throw Error('CANDIDATE_UNAVAILABLE');
  const text = normalizeQuery(candidate.normalized_query);
  const duplicate = await withTenant(tenant, async c => (await c.query(`SELECT intent_key FROM router_semantic_examples WHERE (tenant_id IS NULL OR tenant_id=$1) AND normalized_text=$2 AND embedding_model=$3 AND embedding_dimensions=$4 AND embedding_version=$5`, [tenant,text,provider.model,provider.dimensions,provider.version])).rows[0]);
  if (duplicate && duplicate.intent_key !== candidate.proposed_intent) throw Error('CONTRADICTORY_EXAMPLE');
  const vector = duplicate ? undefined : validateVector(await provider.embed(text), provider.dimensions);
  return withTenant(tenant, async c => {
    if (!await checkReview(c)) throw Error('REVIEW_DENIED');
    const locked = (await c.query("SELECT id FROM router_candidates WHERE tenant_id=$1 AND id=$2 AND review_state='pending' AND confirmation_state='confirmed' AND expires_at>now() FOR UPDATE", [tenant,id])).rows[0];
    if (!locked) throw Error('CANDIDATE_UNAVAILABLE');
    // Serialize phrase promotion to reject concurrent contradictory intent approvals.
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [JSON.stringify([tenant,text,provider.model,provider.dimensions,provider.version])]);
    const existing = (await c.query(`SELECT intent_key FROM router_semantic_examples WHERE (tenant_id IS NULL OR tenant_id=$1) AND normalized_text=$2 AND embedding_model=$3 AND embedding_dimensions=$4 AND embedding_version=$5`, [tenant,text,provider.model,provider.dimensions,provider.version])).rows[0];
    if (existing && existing.intent_key !== candidate.proposed_intent) throw Error('CONTRADICTORY_EXAMPLE');
    if (!existing && vector) await c.query(`INSERT INTO router_semantic_examples(tenant_id,intent_key,example_text,normalized_text,embedding,embedding_model,embedding_dimensions,embedding_version,source,approval_state,approved_by)
      VALUES($1,$2,$3,$3,$4::vector,$5,$6,$7,'promoted_query','approved',$8)`, [tenant,candidate.proposed_intent,text,JSON.stringify(vector),provider.model,provider.dimensions,provider.version,reviewer]);
    await c.query("UPDATE router_candidates SET review_state='approved',embedding_status='embedded',reviewed_at=now(),reviewed_by=$3 WHERE tenant_id=$1 AND id=$2", [tenant,id,reviewer]);
    await recordAuditEvent(c,{tenantId:tenant,actorId:reviewer,action:'router.example_approved',targetType:'router_candidate',targetId:id,metadata:{intentKey:candidate.proposed_intent,embeddingModel:provider.model,embeddingVersion:provider.version,duplicate:Boolean(existing)}});
    await recordMetric(c,tenant,{method:'semantic',outcome:'matched',intentKey:candidate.proposed_intent,fallbackUsed:false},0,existing ? 0 : 1,false);
    return { promoted: !existing, duplicate: Boolean(existing) };
  });
}
