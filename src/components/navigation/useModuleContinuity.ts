import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {isDashboardWorkspaceId, type DashboardWorkspaceId} from '../../navigation/workspace-registry';

export const moduleContinuityKey = (tenantId: string, userId: string) =>
  `stanza.last-module.v1:${tenantId}:${userId}`;

export function authorisedLastModule(value: unknown, allowed: ReadonlySet<string>): DashboardWorkspaceId | null {
  return typeof value === 'string' && isDashboardWorkspaceId(value) && allowed.has(value) ? value : null;
}

function read(key: string) {
  try {return localStorage.getItem(key);} catch {return null;}
}
function write(key: string, module: string | null) {
  try {if (module) {if (localStorage.getItem(key) !== module) localStorage.setItem(key, module);} else localStorage.removeItem(key);} catch { /* Storage is optional. */ }
}

/** Called only inside the authenticated dashboard, using its current navigation allowlist. */
export function useModuleContinuity({tenantId, userId, restoredSession, availableIds, activeId, select, capabilitiesReady}:
  {tenantId: string; userId: string; restoredSession: boolean; availableIds: ReadonlySet<string>;
   activeId: string; select: (id: DashboardWorkspaceId) => void; capabilitiesReady: boolean}) {
  const key = moduleContinuityKey(tenantId, userId);
  const [previous] = useState(() => read(key));
  const [ready, setReady] = useState(false);
  const [candidate, setCandidate] = useState<DashboardWorkspaceId | null>(null);
  const initialized = useRef(false);
  const resume = authorisedLastModule(candidate, availableIds);
  useLayoutEffect(() => {
    if (initialized.current) return;
    // These two entries use server-resolved capabilities rather than role claims.
    if (!capabilitiesReady && (previous === 'semanticIntelligence' || previous === 'semanticPlatform')) return;
    initialized.current = true;
    const valid = authorisedLastModule(previous, availableIds);
    if (!valid) write(key, null);
    else if (restoredSession) select(valid);
    else setCandidate(valid);
    setReady(true);
  }, [availableIds, capabilitiesReady, key, previous, restoredSession, select]);
  useLayoutEffect(() => {
    if (!ready) return;
    if (candidate && (!resume || activeId !== 'geofence')) setCandidate(null);
    if (!availableIds.has(activeId)) {
      write(key, null);
      select('geofence');
    }
  }, [activeId, availableIds, candidate, key, ready, resume, select]);
  useEffect(() => {
    if (ready && !candidate && availableIds.has(activeId)) write(key, activeId);
  }, [activeId, availableIds, candidate, key, ready]);
  return {ready, resume, continuePrevious: () => {if (resume) select(resume); setCandidate(null);},
    startHere: () => {setCandidate(null); select('geofence');}};
}
