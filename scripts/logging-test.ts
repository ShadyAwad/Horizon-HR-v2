import assert from 'node:assert/strict';
import { safeErrorCode, logServerError } from '../src/lib/server-logging';
assert.equal(safeErrorCode({ code: '23505', detail: 'private employee record' }), '23505');
assert.equal(safeErrorCode({ code: 'PERMISSION_DENIED', message: 'private complaint' }), 'PERMISSION_DENIED');
assert.equal(safeErrorCode({ statusCode: 403 }), 'HTTP_403');
for (const error of [null, 'secret reset token', { code: 'private@example.invalid' }, { code: 'A'.repeat(65) }, { statusCode: NaN }, { statusCode: 200 }, new Error('provider key and body')])
    assert.equal(safeErrorCode(error), 'INTERNAL_ERROR');
const captured: unknown[][] = [];
const original = console.error;
try {
    console.error = (...args: unknown[]) => { captured.push(args); };
    logServerError('[Operation] Failed:', { code: '23514', message: 'secret', detail: 'private record', stack: 'credentials', password: 'secret' });
}
finally {
    console.error = original;
}
assert.deepEqual(JSON.parse(captured[0][0] as string), {level:'error',operation:'[Operation] Failed:',code:'23514'});
assert.equal(captured.length,1);
console.log('PASS operational errors expose only bounded codes and context, without SQL details, bodies or credentials.');

// Exercise the real middleware, including /api mount-prefix stripping at finish.
const {default:express}=await import('express');
const {requestIds}=await import('../src/lib/request-context');
const app=express();app.use(requestIds);
app.get('/api/named',(_req,res)=>res.json({ok:true}));
app.get('/api/failure',(_req,res)=>res.status(500).end());
app.use('/api',(_req,res)=>res.status(404).json({code:'API_ROUTE_NOT_FOUND'}));
app.use('/static.js',(_req,res)=>res.status(200).send('static'));
app.use('/cached.js',(_req,res)=>res.status(304).end());
app.use('/missing.js',(_req,res)=>res.status(404).end());
app.get('*',(_req,res)=>res.send('<!doctype html>'));
const server=app.listen(0,'127.0.0.1');
await new Promise<void>(resolve=>server.once('listening',resolve));
const address=server.address();assert(address&&typeof address!=='string');
const base=`http://127.0.0.1:${address.port}`;
const previousEnv=process.env.NODE_ENV;
const consoles={info:console.info,warn:console.warn,error:console.error};
const events:{channel:string;entry:any}[]=[];
try{
 for(const channel of ['info','warn','error'] as const)console[channel]=(...args:unknown[])=>{events.push({channel,entry:JSON.parse(String(args[0]))});};
 const check=async(path:string,status:number,channel?:string,route?:string)=>{
  events.length=0;const response=await fetch(base+path);await response.text();
  assert.equal(response.status,status);assert.match(response.headers.get('x-request-id')||'',/^[a-f0-9-]{36}$/);
  if(!channel){assert.equal(events.length,0);return;}
  assert.equal(events.length,1);assert.equal(events[0].channel,channel);
  assert.equal(events[0].entry.level,channel);assert.equal(events[0].entry.requestId,response.headers.get('x-request-id'));
  assert.equal(events[0].entry.status,status);assert.equal(events[0].entry.route,route);
  assert.equal(events[0].entry.operation,'http_request');assert.equal(typeof events[0].entry.durationMs,'number');
 };
 process.env.NODE_ENV='development';
 await check('/static.js',200);await check('/cached.js',304);await check('/spa/deep/link',200);
 await check('/api/named',200,'info','/api/named');
 await check('/api/unknown',404,'warn','unmatched');
 await check('/api',404,'warn','unmatched');
 await check('/api/failure',500,'error','/api/failure');
 await check('/missing.js',404,'warn','unmatched');
 process.env.NODE_ENV='production';
 await check('/static.js',200,'info','unmatched');await check('/cached.js',304,'info','unmatched');await check('/spa/deep/link',200,'info','*');
 await check('/api/named',200,'info','/api/named');await check('/api/unknown',404,'warn','unmatched');
}finally{
 Object.assign(console,consoles);
 if(previousEnv===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previousEnv;
 await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
}
console.log('PASS request logs: quiet dev static/SPA successes; named API info, API/static misses warn, failures error, request IDs and production successes preserved.');
