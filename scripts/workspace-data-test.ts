import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { WIDGETS, canUseWidget, widgetPath } from '../src/components/workspace-composer/widget-catalog';

// Execute the real hook with deterministic effects/state and deferred transport.
let state: any;
let dependencies: unknown[] | undefined;
let cleanup: (() => void) | undefined;
let pendingEffect: (() => (() => void)) | undefined;
const requests: Array<{url:string;signal:AbortSignal;resolve:(value:any)=>void}> = [];
const react = {
  useState(initial:unknown) {
    state ??= initial;
    return [state, (next:any) => { state = typeof next === 'function' ? next(state) : next; }];
  },
  useEffect(effect:()=>(()=>void), deps:unknown[]) {
    if (!dependencies || deps.some((value,index)=>value!==dependencies![index])) {
      pendingEffect=effect; dependencies=deps;
    }
  },
};
const module = {exports:{} as any};
runInNewContext(transformSync(readFileSync('src/components/workspace-composer/useWidgetData.ts','utf8'), {loader:'ts',format:'cjs'}).code, {
  module, exports:module.exports, AbortController,
  require(name:string) {
    if(name==='react') return react;
    if(name==='../../lib/api') return {
      apiUrl:(path:string)=>path,
      apiFetch:(url:string,options:{signal:AbortSignal})=>new Promise(resolve=>requests.push({url,signal:options.signal,resolve})),
    };
    if(name==='../../lib/api-response') return {readApiJson:async(value:any)=>value};
    throw new Error(`Unexpected dependency ${name}`);
  },
});
function render(paths:string[], identity='tenant:user:allowed', refresh=0) {
  const result=module.exports.useWidgetData(paths,identity,refresh);
  if(pendingEffect) {cleanup?.();cleanup=pendingEffect();pendingEffect=undefined;}
  return result;
}
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
const expense=widgetPath('expenses');
render([expense,expense]);
assert.equal(requests.length,1,'duplicate instances share a request');
requests[0].resolve({items:[{id:'private-claim'}]});await flush();
assert.equal(render([expense])[expense].data.items[0].id,'private-claim');
for(let i=0;i<100;i++)render([expense]);
assert.equal(requests.length,1,'rerenders/idle do not fetch again');
const savedWidgets=[WIDGETS.find(w=>w.id==='expenses')!];
const revoked={id:'user',tenantId:'tenant',name:'Test',email:'test@example.invalid',role:'employee' as const,permissions:[]};
const permittedPaths=savedWidgets.filter(w=>canUseWidget(revoked,w)).map(w=>widgetPath(w.id));
assert.equal(permittedPaths.length,0,'saved widget does not grant permission');
assert.equal(Object.keys(render(permittedPaths,'tenant:user:revoked')).length,0,'old data disappears before effects run');
assert(requests[0].signal.aborted,'permission loss aborts old requests');
assert.equal(requests.length,1,'revoked widget makes no request');
render([expense],'other-tenant:user');
assert.equal(requests.length,2);
assert.equal(Object.keys(render([expense],'other-tenant:user')).length,0,'no cross-identity cached data');
render([expense],'other-tenant:user',1);
assert(requests[1].signal.aborted);
requests[1].resolve({items:[{id:'stale'}]});await flush();
assert.equal(Object.keys(render([expense],'other-tenant:user',1)).length,0,'late response cannot repopulate refreshed data');
requests[2].resolve({items:[]});await flush();
assert.equal(render([expense],'other-tenant:user',1)[expense].data.items.length,0);
cleanup?.();assert(requests[2].signal.aborted,'unmount cancels transport');
console.log('PASS real widget hook: deduplication, idle stability, permission-loss clearing/no-fetch, identity isolation, refresh cancellation, stale response rejection and unmount');
