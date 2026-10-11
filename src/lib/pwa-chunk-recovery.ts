const CHUNK_RELOAD_KEY = 'stanza.chunk-recovery.v1';
const RELOAD_WINDOW_MS = 60_000;
/** Recover a deployed-away Vite chunk once; never replay a mutation or loop offline. */
export function installStaleChunkRecovery() {
  window.addEventListener('vite:preloadError', (event) => {
    if (!navigator.onLine) return;
    try {
      const now = Date.now();
      const previous = Number(window.sessionStorage.getItem(CHUNK_RELOAD_KEY) || 0);
      if (Number.isFinite(previous) && now - previous < RELOAD_WINDOW_MS) return;
      window.sessionStorage.setItem(CHUNK_RELOAD_KEY, String(now));
      event.preventDefault();
      window.location.reload();
    } catch {
      // Without persistent loop protection, leave recovery to the user's reload.
    }
  });
}
