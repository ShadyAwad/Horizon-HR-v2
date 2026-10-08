const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

export function apiUrl(path: string) {
  return `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

export function apiFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  if (init.method && !['GET','HEAD'].includes(init.method.toUpperCase())) sharedReads.clear();
  return fetch(input, { ...init, credentials: 'include' });
}


// In-flight sharing only: no response cache, no retries, and no cross-identity reuse.
let identity = 'anonymous';
const sharedReads = new Map<string,{promise:Promise<Response>;controller:AbortController}>();
export function setApiRequestIdentity(user:{id:string;tenantId?:string}|null) {
 const next=user?user.tenantId+':'+user.id:'anonymous';
 if(next===identity)return;
 for(const read of sharedReads.values())read.controller.abort();
 sharedReads.clear();identity=next;
}
export function apiFetchShared(input:string,init:RequestInit={}) {
 if(init.method && init.method.toUpperCase()!=='GET')return apiFetch(input,init);
 const headers=Array.from(new Headers(init.headers).entries()).sort(([a],[b])=>a.localeCompare(b));
 const key=JSON.stringify([identity,input,headers,init.cache]);
 if(init.signal?.aborted)return Promise.reject(new DOMException('Aborted','AbortError'));
 let entry=sharedReads.get(key);
 if(!entry){
  const controller=new AbortController();
  const promise=apiFetch(input,{...init,signal:controller.signal});
  entry={promise,controller};sharedReads.set(key,entry);
  const remove=()=>{if(sharedReads.get(key)===entry)sharedReads.delete(key);};
  void promise.then(remove,remove);
 }
 const promise=entry.promise;
 return new Promise<Response>((resolve,reject)=>{
  const abort=()=>reject(new DOMException('Aborted','AbortError'));
  init.signal?.addEventListener('abort',abort,{once:true});
  void promise.then(response=>{if(!init.signal?.aborted)resolve(response.clone());},reject).finally(()=>init.signal?.removeEventListener('abort',abort));
 });
}
