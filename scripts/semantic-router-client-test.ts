import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { ACTIONS,getIntent } from '../src/lib/intelligent-router';
const states:unknown[]=[],effects:{deps:unknown[];cleanup?:()=>void}[]=[],pending:{index:number;fn:()=>void|(()=>void)}[]=[];
let existingCalls=0;
let stateIndex=0,effectIndex=0,dirty=false,nextTimer=0;
const timers=new Map<number,()=>void>(),requests:{url:string;options:RequestInit;resolve:(r:unknown)=>void}[]=[];
const react={useState(initial:unknown){const index=stateIndex++;if(!(index in states))states[index]=initial;return [states[index],(next:unknown)=>{const value=typeof next==='function'?next(states[index]):next;if(value!==states[index]){states[index]=value;dirty=true;}}];},useEffect(fn:()=>void|(()=>void),deps:unknown[]){const index=effectIndex++;if(!effects[index]||deps.some((d,i)=>d!==effects[index].deps[i])){effects[index]?.cleanup?.();effects[index]={deps};pending.push({index,fn});}}};
const module={exports:{} as {useIntelligentRouter:Function}};
runInNewContext(transformSync(readFileSync('src/components/command-palette/useIntelligentRouter.ts','utf8'),{loader:'ts',format:'cjs'}).code,{module,exports:module.exports,AbortController,Array,
  setTimeout:(fn:()=>void)=>{const id=++nextTimer;timers.set(id,fn);return id;},clearTimeout:(id:number)=>timers.delete(id),
  require(name:string){if(name==='react')return react;if(name==='../../lib/intelligent-router')return {ACTIONS,getIntent};if(name==='../../lib/api')return {apiUrl:(s:string)=>s,apiFetch:(url:string,options:RequestInit={})=>{if(url.endsWith('/existing')){existingCalls++;assert.equal(options.body,'{}','existing telemetry contains no query text');return Promise.resolve({ok:true});}return new Promise(resolve=>requests.push({url,options,resolve}));}};throw Error(name);},
});
const commands=[{id:'leave:request'},{id:'roster:schedule'},{id:'router:grievance-inbox'}];
function render(query:string,normal=0){let output:any;for(let n=0;n<10;n++){dirty=false;stateIndex=effectIndex=0;output=module.exports.useIntelligentRouter(query,normal,commands);for(const e of pending.splice(0)){const cleanup=e.fn();effects[e.index].cleanup=cleanup||undefined;}if(!dirty)return output;}throw Error('Unstable hook');}
const fire=()=>{const callbacks=[...timers.values()];timers.clear();callbacks.forEach(fn=>fn());};
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
const respond=(index:number,result:object)=>requests[index].resolve({ok:true,json:async()=>result});
render('',13);assert.equal(requests.length,1,'status only');respond(0,{reasoningState:'ready',canReview:false,learningEnabled:true});await flush();
render('request leave',1);fire();assert.equal(requests.length,1,'normal command matching never calls routing inference');assert.equal(existingCalls,1);
render('novel phrase');fire();assert.equal(JSON.parse(String(requests[1].options.body)).allowReasoning,false,'AI initially opt-in');
respond(1,{result:{outcome:'matched',method:'llm',intentKey:'request_leave',actionKey:'FORGED',commandId:'leave:request',fallbackUsed:true}});await flush();assert.equal(render('novel phrase').routedCommands.length,0,'forged action fails closed');
const output=render('novel phrase');output.setAllowReasoning(true);render('novel phrase');fire();assert.equal(JSON.parse(String(requests[2].options.body)).allowReasoning,true);
render('another phrase');assert((requests[2].options.signal as AbortSignal).aborted,'query changes abort pending resolution');fire();assert.equal(JSON.parse(String(requests[3].options.body)).allowReasoning,false,'query change revokes prior AI consent');
respond(2,{result:{outcome:'matched',method:'llm',intentKey:'request_leave',actionKey:'OPEN_REQUEST_LEAVE',commandId:'leave:request',fallbackUsed:true}});await flush();assert.equal(render('another phrase').result,null,'late response cannot repopulate different query');
respond(3,{result:{outcome:'matched',method:'semantic',intentKey:'request_leave',actionKey:'OPEN_REQUEST_LEAVE',commandId:'leave:request',fallbackUsed:false}});await flush();assert.equal(render('another phrase').routedCommands.length,1);
render('ambiguous shift phrase');fire();respond(4,{result:{outcome:'ambiguous',method:'semantic',choices:['current_shift','next_shift','tomorrow_shift'],fallbackUsed:false}});await flush();assert.equal(render('ambiguous shift phrase').routedCommands.length,1,'multiple intent interpretations sharing one destination never duplicate command IDs');
const entityIntent=getIntent('employee_grievance_lookup')!,entityId='00000000-0000-4000-8000-000000000001';
render('employee entity phrase');fire();respond(5,{result:{outcome:'matched',method:'semantic',intentKey:entityIntent.key,actionKey:entityIntent.actionKey,commandId:entityIntent.commandId,entityRoute:{status:'ambiguous',entities:[],cases:[]}}});await flush();const entityOutput=render('employee entity phrase');assert.equal(entityOutput.routedCommands.length,0,'unresolved entities cannot open inbox');
entityOutput.chooseEntity('employee',entityId);render('employee entity phrase');fire();assert.equal(JSON.parse(String(requests[6].options.body)).entityChoices.employee,entityId);assert.equal(JSON.parse(String(requests[6].options.body)).allowReasoning,false,'clarification does not grant AI consent');
respond(6,{result:{outcome:'matched',method:'semantic',intentKey:entityIntent.key,actionKey:entityIntent.actionKey,commandId:entityIntent.commandId,entityRoute:{status:'resolved',caseId:entityId,cases:[{id:entityId}]}}});await flush();assert.equal(render('employee entity phrase').routedCommands.length,1);
render('different entity phrase');fire();assert.equal(JSON.parse(String(requests[7].options.body)).entityChoices,undefined,'entity selections never survive query changes');
stateIndex=effectIndex=0;assert.equal(module.exports.useIntelligentRouter('changed before effects',0,commands).result,null,'stale action disappears synchronously before effects');pending.length=0;
for(const e of effects)e.cleanup?.();assert((requests[7].options.signal as AbortSignal).aborted,'unmount cancels transport');
console.log('PASS real palette hook: deterministic avoidance, explicit query consent, forged-action rejection, cancellation, stale-response suppression and immediate proposal clearing');
