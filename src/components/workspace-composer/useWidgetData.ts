import { useEffect, useState } from 'react';
import { apiFetch, apiUrl } from '../../lib/api';
import { readApiJson } from '../../lib/api-response';
export type WidgetResult={data?:any;error?:string};
/** One request per unique endpoint per refresh. No polling or persistent data cache. */
export function useWidgetData(paths:string[],identity:string,refresh:number){
 const signature=JSON.stringify([...new Set(paths)].sort());
 const [snapshot,setSnapshot]=useState<{key:string;values:Record<string,WidgetResult>}>({key:'',values:{}});
 const key=identity+signature+refresh;
 useEffect(()=>{
  const controller=new AbortController();let live=true;setSnapshot({key,values:{}});
  for(const path of JSON.parse(signature) as string[])void apiFetch(apiUrl(path),{signal:controller.signal,cache:'no-store'}).then(r=>readApiJson(r,'Workspace service')).then(data=>{
   if(live)setSnapshot(s=>s.key===key?{key,values:{...s.values,[path]:{data}}}:s);
  }).catch(error=>{if(live&&!controller.signal.aborted)setSnapshot(s=>s.key===key?{key,values:{...s.values,[path]:{error:error instanceof Error?error.message:'Unable to load widget.'}}}:s);});
  return()=>{live=false;controller.abort();};
 },[key,signature]);
 return snapshot.key===key?snapshot.values:{};
}
