import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { INTENTS,normalizeQuery } from '../src/lib/intelligent-router';
import { resolveQuery } from '../src/server/intelligent-router/router';
if(process.env.NODE_ENV==='production')throw Error('Browser fixture is development-only');
const candidates=new Map<string,{id:string;normalized_query:string;proposed_intent:string;confirmed:boolean}>(),promoted=new Set<string>();
let counter=0,reasoningCalls=0;
const server=await createServer({configFile:false,plugins:[react(),tailwindcss(),{name:'router-fixture',configureServer(vite){vite.middlewares.use(async(req,res,next)=>{
  if(req.url==='/router-fixture'){res.setHeader('Content-Type','text/html');res.end(await vite.transformIndexHtml('/router-fixture','<html><head><title>Router fixture</title></head><body><div id="root"></div><script type="module" src="/scripts/semantic-router-browser.tsx"></script></body></html>'));return;}
  if(!req.url?.startsWith('/api/command-router')){next();return;}
  res.setHeader('Content-Type','application/json');const path=req.url.replace('/api/command-router','');
  try{
    let body='';for await(const chunk of req)body+=chunk;const b=body?JSON.parse(body):{};let payload:object={};
    if(path==='/status')payload={reasoningState:'ready',canReview:true,learningEnabled:true};
    else if(path==='/resolve'){
      const q=normalizeQuery(b.query);
      const result=await resolveQuery(b.query,{actor:{tenantId:'fixture',employeeId:'fixture'},allowed:async i=>i.key!=='hiring',minimumScore:.84,minimumMargin:.1,embedding:{model:'mock',dimensions:2,version:'1',embed:async()=>[1,0]},search:{search:async()=>{
        if(q==='provider outage')throw Error('fixture outage');
        return promoted.has(q)||[...promoted].some(p=>p.includes('quiet day')&&q.includes('quiet day'))||q==='could i have a day away'||q==='نفسي ارتاح بكره'?[{intentKey:'request_leave',score:.98}]:q==='away options'?[{intentKey:'request_leave',score:.9},{intentKey:'leave_balance',score:.86}]:[];
      }},authorization:{resolve:async()=>b.allowReasoning?{state:'ready',provider:{interpret:async()=>{reasoningCalls++;return q.includes('quiet day')?{status:'resolved',proposedIntentKey:'request_leave',confidence:'high'}:{status:'unsupported'};}}}:{state:'disabled'}}});
      if(result.method==='llm'&&result.outcome==='matched'&&b.learn){const id=`fixture-${++counter}`;candidates.set(id,{id,normalized_query:q,proposed_intent:result.intentKey!,confirmed:false});result.candidateId=id;}
      payload={result,reasoningCalls};
    }else if(path==='/candidates')payload={candidates:[...candidates.values()].filter(c=>c.confirmed)};
    else if(path.endsWith('/confirm')){const c=candidates.get(path.split('/')[2]);if(c)c.confirmed=true;payload={confirmed:Boolean(c)};}
    else if(path.endsWith('/review')){const id=path.split('/')[2],c=candidates.get(id);if(c?.confirmed&&b.decision==='approve')promoted.add(c.normalized_query);candidates.delete(id);payload={promoted:true};}
    else if(path==='/fixture-stats')payload={reasoningCalls,promoted:[...promoted]};
    res.end(JSON.stringify({success:true,...payload}));
  }catch{res.statusCode=500;res.end(JSON.stringify({success:false}));}
});}}],server:{host:'127.0.0.1',port:4179,strictPort:true},appType:'custom'});
await server.listen();console.log('Browser fixture: http://127.0.0.1:4179/router-fixture');
