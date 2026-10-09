import {useEffect,useMemo,useRef} from 'react';
export const MAX_BOUNDARY_DELAY=2_147_483_647;
/** Use server-relative time; a consumed boundary cannot refetch the same stale snapshot. */
export function useAttendanceBoundary(serverNow:string|undefined,nextChangeAt:string|undefined,onChanged:()=>void,identity='',receivedAt?:number){
 const callback=useRef(onChanged);callback.current=onChanged;
 const consumed=useRef('');const lastVisibleAttempt=useRef(0);
 const snapshot=useMemo(()=>({received:receivedAt??Date.now(),server:Date.parse(serverNow||''),boundary:Date.parse(nextChangeAt||'')}),[serverNow,nextChangeAt,identity,receivedAt]);
 useEffect(()=>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  const key=identity+':'+nextChangeAt;
  const clear=()=>{if(timer!==undefined){clearTimeout(timer);timer=undefined;}};
  const remaining=()=>snapshot.boundary-snapshot.server-(Date.now()-snapshot.received);
  const schedule=()=>{clear();if(document.hidden||!Number.isFinite(snapshot.server)||!Number.isFinite(snapshot.boundary)||snapshot.boundary<=snapshot.server||consumed.current===key)return;
   const delay=remaining()+50;
   if(delay<=0){consumed.current=key;callback.current();return;}
   timer=setTimeout(schedule,Math.min(delay,MAX_BOUNDARY_DELAY));
  };
  const visible=()=>{if(document.hidden)clear();else if(Date.now()-Math.max(snapshot.received,lastVisibleAttempt.current)>=30_000){lastVisibleAttempt.current=Date.now();if(snapshot.boundary>snapshot.server&&remaining()<=0)consumed.current=key;callback.current();schedule();}else schedule();};
  schedule();document.addEventListener('visibilitychange',visible);
  return()=>{clear();document.removeEventListener('visibilitychange',visible);};
 },[snapshot,nextChangeAt,identity]);
}