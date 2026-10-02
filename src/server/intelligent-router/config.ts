import { OpenAIEmbeddingProvider, OpenAIReasoningProvider, type AiMode, type ReasoningAuthorization, type ReasoningProvider } from './providers';
export function routerConfig(env: NodeJS.ProcessEnv = process.env) {
  const mode = env.STANZA_ROUTER_AI_MODE || 'disabled';
  if (!['disabled', 'user-authorized', 'tenant-provided', 'application-funded'].includes(mode)) throw Error('Invalid STANZA_ROUTER_AI_MODE');
  const effort = env.STANZA_ROUTER_REASONING_EFFORT || 'low';
  if (!['low', 'medium'].includes(effort)) throw Error('Router effort supports only low or medium');
  const numeric = (key: string, fallback: number, min: number, max: number, integer = false) => { const value = Number(env[key] ?? fallback); if (!Number.isFinite(value) || value < min || value > max || integer && !Number.isInteger(value)) throw Error(`Invalid ${key}`); return value; };
  return { mode: mode as AiMode, model: env.STANZA_ROUTER_REASONING_MODEL || 'gpt-6.1-sol', effort: effort as 'low' | 'medium', escalate: effort === 'medium' || env.STANZA_ROUTER_ESCALATE_COMPLEX === 'true', embeddingModel: env.STANZA_ROUTER_EMBEDDING_MODEL || 'text-embedding-3-small', dimensions: numeric('STANZA_ROUTER_EMBEDDING_DIMENSIONS', 1536, 1, 2000, true), version: env.STANZA_ROUTER_EMBEDDING_VERSION || 'v1', minimumScore: numeric('STANZA_ROUTER_MIN_SCORE', .84, 0, 1), minimumMargin: numeric('STANZA_ROUTER_MIN_MARGIN', .10, 0, 1), topK: numeric('STANZA_ROUTER_TOP_K', 32, 2, 100, true), learning: env.STANZA_ROUTER_LEARNING === 'true' };
}
/** Deployment boundary: no browser credentials and no assumed ChatGPT enrollment. */
export function createAuthorization(config: ReturnType<typeof routerConfig>, env: NodeJS.ProcessEnv = process.env, adapters: { user?: ReasoningAuthorization; tenant?: ReasoningAuthorization } = {}): ReasoningAuthorization {
  let applicationProvider: ReasoningProvider | undefined;
  if (config.mode === 'application-funded' && env.STANZA_ROUTER_REASONING_KEY) applicationProvider = new OpenAIReasoningProvider(env.STANZA_ROUTER_REASONING_KEY, config.model, config.effort, config.escalate);
  return { async resolve(actor) {
    if (config.mode === 'disabled') return { state: 'disabled' };
    if (config.mode === 'user-authorized') return adapters.user ? adapters.user.resolve(actor) : { state: 'authorization_unavailable' };
    if (config.mode === 'tenant-provided') return adapters.tenant ? adapters.tenant.resolve(actor) : { state: 'authorization_unavailable' };
    return applicationProvider ? { state: 'ready', provider: applicationProvider } : { state: 'credentials_missing' };
  } };
}
export function createEmbedding(config: ReturnType<typeof routerConfig>, env: NodeJS.ProcessEnv = process.env) { return env.STANZA_ROUTER_EMBEDDING_KEY ? new OpenAIEmbeddingProvider(env.STANZA_ROUTER_EMBEDDING_KEY, config.embeddingModel, config.dimensions, config.version) : undefined; }
