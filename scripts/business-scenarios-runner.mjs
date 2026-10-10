import {config} from 'dotenv';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {once} from 'node:events';
config({quiet:true});config({path:'.env.development.local',override:true,quiet:true});
if(!['development','test','demo'].includes(process.env.NODE_ENV||'development'))throw Error('Business scenarios refuse production');
const scenarios=['hiring-equipment','attendance-leave','privacy-publication'];
const integrations={'attendance-integration':'scripts/attendance-integration-test.ts','attendance-departure':'scripts/attendance-departure-integration-test.ts','communications-sessions':'scripts/communications-session-test.ts'};
const allowed=[...scenarios,...Object.keys(integrations)];
const suites=process.argv.slice(2);if(!suites.length)suites.push(...scenarios);
if(suites.some(s=>!allowed.includes(s)))throw Error('Unknown business scenario');
for(const suite of suites){
 const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');const port=reservation.address().port;await new Promise(r=>reservation.close(r));
 const base='http://localhost:'+port;
 const env={...process.env,NODE_ENV:'development',STANZA_RUNTIME_PROFILE:'local-preview',PORT:String(port),APP_BASE_URL:base,WEBAUTHN_ORIGIN:base,WEBAUTHN_RP_ID:'localhost',TRUST_PROXY_HOPS:'0',DEV_AUTH_HEADERS:'false',ALLOW_TRYCLOUDFLARE_DEV_ORIGINS:'false',BROWSER_BASE_URL:base,ATTENDANCE_TEST_BASE_URL:base,COMMUNICATIONS_TEST_BASE_URL:base};
 // Fresh task-owned server isolates rate-limit budgets; production limits are never changed.
 // No global worker is started: scenario C exercises the real rollup through its own disposable queue/worker.
 const server=spawn(process.execPath,['dist/server.cjs'],{env,windowsHide:true,stdio:['ignore','inherit','inherit']});
 let stopped=false;const exited=once(server,'exit').then(()=>{stopped=true;});
 try {
  let ready=false;for(let n=0;n<120&&!stopped;n++){try{const r=await fetch(base+'/api/system/live',{signal:AbortSignal.timeout(1000)});if(r.status===200){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,250));}if(!ready)throw Error('Task-owned preview did not become ready');
  const test=spawn(process.execPath,['--import','tsx',integrations[suite]||`scripts/business-${suite}-test.ts`],{env,windowsHide:true,stdio:'inherit'});
  const [code]=await once(test,'exit');if(code!==0)throw Error(`Business ${suite} failed (${code})`);
 } finally {if(!stopped)server.kill();await exited;}
}
