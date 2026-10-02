/** Explicit loopback-only built-bundle profile. Never substitutes for production. */
export function isLocalPreview(env: NodeJS.ProcessEnv = process.env) {
  if (env.STANZA_RUNTIME_PROFILE !== 'local-preview') return false;
  if (env.NODE_ENV === 'production') throw new Error('Local preview cannot run with NODE_ENV=production');
  return true;
}
