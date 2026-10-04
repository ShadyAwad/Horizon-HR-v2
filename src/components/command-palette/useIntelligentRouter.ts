import { useEffect, useState } from 'react';
import { apiFetch, apiUrl } from '../../lib/api';
import { ACTIONS, getIntent, type RouterResult } from '../../lib/intelligent-router';
import type { StanzaCommand } from './command-palette-types';
export function useIntelligentRouter(query:string,normalResults:number,commands:readonly StanzaCommand[]) {
  const [resolved,setResolved]=useState<{query:string;result:RouterResult}|null>(null),[busy,setBusy]=useState(false),[allowReasoning,setAllowReasoning]=useState(false),[learn,setLearn]=useState(false);
  // Old proposals disappear during render, before effect cleanup or network completion.
  const result=normalResults===0&&resolved?.query===query?resolved.result:null;
  const [status,setStatus]=useState<{reasoningState:string;embeddingConfigured:boolean;semanticState:string;canReview:boolean;learningEnabled:boolean;openaiLocalAvailable?:boolean;openaiConnection?:{connected:boolean;pending:boolean;model?:string;accountLabel?:string;persistent?:boolean;expiresAt?:string;scopes?:string[];refreshedAt?:string}}|null>(null);
  const [statusVersion,setStatusVersion]=useState(0);
  // Consent applies to one query. Changing it requires a new explicit opt-in.
  useEffect(()=>{setAllowReasoning(false);setLearn(false);},[query]);
  useEffect(()=>{ const c=new AbortController();void apiFetch(apiUrl('/api/command-router/status'),{signal:c.signal}).then(async r=>{if(r.ok)setStatus(await r.json());}).catch(()=>{});return ()=>c.abort(); },[statusVersion]);
  useEffect(()=>{
    setResolved(null);setBusy(false);
    if(normalResults || query.trim().length<3 || query.length>500)return;
    const c=new AbortController();
    const timer=setTimeout(()=>{setBusy(true);void apiFetch(apiUrl('/api/command-router/resolve'),{method:'POST',signal:c.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({query,allowReasoning,learn,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone})})
      .then(async r=>{if(!r.ok)throw Error('unavailable');const payload=await r.json();if(!c.signal.aborted){setResolved({query,result:payload.result});if(typeof payload.semanticState==='string')setStatus(current=>current?{...current,semanticState:payload.semanticState}:current);}})
      .catch(()=>{if(!c.signal.aborted)setResolved({query,result:{outcome:'provider_unavailable',method:'none',fallbackUsed:false}});})
      .finally(()=>{if(!c.signal.aborted)setBusy(false);});},400);
    return ()=>{clearTimeout(timer);c.abort();};
  },[query,normalResults,allowReasoning,learn]);
  useEffect(()=>{
    if(!normalResults||query.trim().length<3)return;
    const c=new AbortController(),timer=setTimeout(()=>{void apiFetch(apiUrl('/api/command-router/existing'),{method:'POST',signal:c.signal,headers:{'Content-Type':'application/json'},body:'{}'}).catch(()=>{});},400);
    return()=>{clearTimeout(timer);c.abort();};
  },[query,normalResults]);
  // Re-resolve server proposals through both allowlists and currently visible commands.
  const intents=result?.outcome==='matched'?[getIntent(result.intentKey)]:result?.outcome==='ambiguous'&&Array.isArray(result.choices)?result.choices.map(getIntent):[];
  const routedCommands=[...new Map(intents.flatMap(i=>{
    if(!i || !ACTIONS.has(i.actionKey) || result?.outcome==='matched'&&(result.actionKey!==i.actionKey || result.commandId!==i.commandId))return [];
    const command=commands.find(c=>c.id===i.commandId);return command?[command]:[];
  }).map(command=>[command.id,command] as const)).values()];
  async function confirm(command:StanzaCommand) {
    if(result?.candidateId && result.commandId===command.id) await apiFetch(apiUrl(`/api/command-router/candidates/${result.candidateId}/confirm`),{method:'POST'}).catch(()=>{});
  }
  return {result,busy,status,refreshStatus:()=>{setAllowReasoning(false);setLearn(false);setStatusVersion(v=>v+1);},allowReasoning,setAllowReasoning,learn,setLearn,routedCommands,confirm};
}
