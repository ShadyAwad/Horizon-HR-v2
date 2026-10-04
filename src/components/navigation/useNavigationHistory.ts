import { useEffect, useRef, useState } from 'react';
import { historyTarget, visitDestination, type NavigationHistory } from './navigation-history';
// Session-local history follows the existing dashboard state; refresh starts at the loaded destination.
export function useNavigationHistory(destination: string, allowed: (value: string) => boolean, select: (value: string) => void) {
 const [history, setHistory] = useState<NavigationHistory>(() => ({entries:[destination], index:0}));
 const pending = useRef<number | null>(null);
 useEffect(() => {
  const target = pending.current;
  setHistory(previous => target !== null && previous.entries[target] === destination
   ? {...previous, index: target} : visitDestination(previous, destination));
  pending.current = null;
 }, [destination]);
 const back = historyTarget(history,-1,allowed), forward = historyTarget(history,1,allowed);
 const go = (index: number | null) => { if (index === null) return; pending.current = index; select(history.entries[index]); };
 return {canBack:back !== null,canForward:forward !== null,back:()=>go(back),forward:()=>go(forward)};
}
