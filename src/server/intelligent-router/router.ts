import { INTENTS, getIntent, normalizeQuery, unsafeOperation, type Intent, type RouterResult } from '../../lib/intelligent-router';
import { ReasoningUnavailable, EmbeddingCache, validateReasoning, type EmbeddingProvider, type ReasoningAuthorization } from './providers';
export type SemanticHit = { intentKey: string; score: number; promoted?:boolean };
export interface SemanticSearch { search(vector: number[], provider: EmbeddingProvider, allowedKeys: string[]): Promise<SemanticHit[]> }
export type RouterDependencies = { allowed: (intent: Intent) => Promise<boolean>; available?: () => Promise<Intent[]>; search: SemanticSearch; embedding?: EmbeddingProvider; authorization: ReasoningAuthorization; actor: { tenantId: string; employeeId: string; sessionId?: string }; cache?: EmbeddingCache; minimumScore: number; minimumMargin: number };
export function aggregateIntents(hits: SemanticHit[], allowed: readonly Intent[]) {
  const keys = new Set(allowed.map(i => i.key)), scores = new Map<string, number>();
  for (const hit of hits) if (keys.has(hit.intentKey) && Number.isFinite(hit.score) && hit.score <= 1 && hit.score >= -1) scores.set(hit.intentKey, Math.max(scores.get(hit.intentKey) ?? -1, hit.score));
  return [...scores].map(([intentKey, score]) => ({ intentKey, score, ...(hits.some(h=>h.intentKey===intentKey&&h.score===score&&h.promoted)?{promoted:true}:{}) })).sort((a, b) => b.score - a.score || a.intentKey.localeCompare(b.intentKey));
}
export async function resolveQuery(raw: string, d: RouterDependencies): Promise<RouterResult> {
  const start = performance.now();
  const finish = (r: RouterResult): RouterResult => ({ ...r, latencyMs: performance.now() - start });
  const query = normalizeQuery(raw);
  const empty: RouterResult = { outcome: 'no_match', method: 'none', fallbackUsed: false };
  if (!query || raw.length > 500 || unsafeOperation(query)) return finish(empty);
  const matched = async (i: Intent, method: RouterResult['method'], extra: Partial<RouterResult> = {}): Promise<RouterResult> => {
    // Recheck at result time: cached embeddings and model proposals grant no permissions.
    if (!getIntent(i.key) || !await d.allowed(i)) return finish({ ...empty, ...extra, method, outcome: 'unauthorized' });
    return finish({ ...empty, ...extra, outcome: 'matched', method, intentKey: i.key, actionKey: i.actionKey, commandId: i.commandId });
  };
  const exact = INTENTS.find(i => i.aliases.some(a => normalizeQuery(a) === query));
  if (exact) return matched(exact, 'exact');
  const rule = INTENTS.find(i => i.rule?.test(query));
  if (rule) return matched(rule, 'rule');
  const allowed: Intent[] = d.available ? (await d.available()).filter(i => getIntent(i.key)) : [];
  if (!d.available) for (const i of INTENTS) if (getIntent(i.key) && await d.allowed(i)) allowed.push(i);
  if (!allowed.length) return finish({ ...empty, outcome: 'unauthorized' });
  let semantic: Partial<RouterResult> = {}, choices: string[] = [], unavailable = false;
  if (d.embedding) {
    try {
      const embeddingStart=performance.now();
      const vector = await (d.cache ?? new EmbeddingCache()).embed(d.embedding, query, `${d.actor.tenantId}:${d.actor.employeeId}`);
      semantic.embeddingLatencyMs=performance.now()-embeddingStart;
      const hits = aggregateIntents(await d.search.search(vector, d.embedding, allowed.map(i => i.key)), allowed);
      if (hits.length) {
        const top = hits[0], competing = hits[1]?.score ?? 0, margin = top.score - competing;
        semantic = { ...semantic, score: top.score, competingScore: competing, margin };
        if (top.score >= d.minimumScore && margin >= d.minimumMargin) return matched(getIntent(top.intentKey)!, 'semantic', {...semantic,promotedSemanticHit:top.promoted===true});
        if (top.score >= d.minimumScore) choices = hits.filter(h => top.score - h.score < d.minimumMargin).map(h => h.intentKey);
      }
    } catch { unavailable = true; }
  }
  const unresolved = (): RouterResult => finish({ ...empty, ...semantic, outcome: choices.length ? 'ambiguous' : unavailable ? 'provider_unavailable' : 'no_match', method: Object.keys(semantic).length ? 'semantic' : 'none', ...(choices.length ? { choices } : {}) });
  try {
    const auth = await d.authorization.resolve(d.actor);
    if (auth.state !== 'ready') return unresolved();
    // Explicit multi-step markers control optional escalation, never query length alone.
    const complex = /\b(?:then|after that|first.*(?:and|then))\b|وبعدين|ثم/u.test(query);
    const proposal = validateReasoning(await auth.provider.interpret({ query, intents: allowed, complex }));
    if (proposal.status === 'ambiguous') return finish({ ...unresolved(), outcome: 'ambiguous', choices: choices.length ? choices : allowed.map(i => i.key), method: 'llm', fallbackUsed: true });
    const proposed = getIntent(proposal.proposedIntentKey);
    if (proposal.status !== 'resolved' || !proposed || proposal.confidence !== 'high') return finish({ ...empty, ...semantic, method: 'llm', fallbackUsed: true });
    return matched(proposed, 'llm', { ...semantic, fallbackUsed: true });
  } catch (error) {
    const invalid = error instanceof Error && error.message === 'INVALID_REASONING';
    return finish({ ...unresolved(), outcome: invalid ? 'no_match' : choices.length ? 'ambiguous' : 'provider_unavailable', method: 'llm', fallbackUsed: true, ...(error instanceof ReasoningUnavailable ? {providerFailure:{reason:error.reason,stage:error.stage,...error.diagnostics,...(error.httpStatus ? {httpStatus:error.httpStatus} : {})}} : {}) });
  }
}
