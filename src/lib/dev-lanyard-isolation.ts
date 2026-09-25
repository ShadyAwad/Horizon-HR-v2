import type { EventManager, RootState } from '@react-three/fiber';

export function readLanyardIsolation(search: string): 'normal' | 'off' | 'no-events' {
  const mode = new URLSearchParams(search).get('stanzaLanyard');
  return mode === 'off' || mode === 'no-events' ? mode : 'normal';
}

// No default event manager is created: no DOM pointer listeners, event connection
// or raycasts. Canvas, physics, artwork and the frame scheduler stay mounted.
export function disconnectedLanyardEvents(): EventManager<HTMLElement> {
  return { enabled: false, priority: 1, connect: () => undefined, disconnect: () => undefined };
}

export function registerLanyardIsolationAudit(get: () => RootState) {
  const snapshot = () => {
    const state = get();
    const meshes = new Set<number>();
    state.internal.interaction.forEach((root) => root.traverse((object) => {
      if ('isMesh' in object && object.isMesh) meshes.add(object.id);
    }));
    return {
      mode: readLanyardIsolation(window.location.search),
      canvasConnected: state.gl.domElement.isConnected,
      frameloop: state.frameloop,
      eventsEnabled: state.events.enabled,
      eventsConnected: Boolean(state.events.connected),
      interactiveRoots: state.internal.interaction.length,
      descendantMeshes: meshes.size,
      note: 'Candidate mesh count, not hit count or triangle tests. No polling.',
    };
  };
  const target = window as Window & { __STANZA_LANYARD_ISOLATION__?: typeof snapshot };
  target.__STANZA_LANYARD_ISOLATION__ = snapshot;
  return () => { if (target.__STANZA_LANYARD_ISOLATION__ === snapshot) delete target.__STANZA_LANYARD_ISOLATION__; };
}
