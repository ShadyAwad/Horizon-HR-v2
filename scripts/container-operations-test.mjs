import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
const image=process.env.OPERATIONS_IMAGE||'stanza-operations-check:local';
const suffix=randomBytes(6).toString('hex'),network='stanza-ops-net-'+suffix,names=['redis','web','worker'].map(role=>'stanza-ops-'+role+'-'+suffix);
const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',timeout:30000}).trim();
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const config=['NODE_ENV=production','APP_BASE_URL=https://stanza.example','WEBAUTHN_ORIGIN=https://stanza.example','WEBAUTHN_RP_ID=stanza.example','TRUST_PROXY_HOPS=0','DATABASE_URL=postgres://probe:probe@127.0.0.1:1/unavailable','DATABASE_SSL=false','DATABASE_ALLOW_PLAINTEXT=true','REDIS_URL=redis://'+names[0]+':6379','QR_TOKEN_ENCRYPTION_KEY='+Buffer.alloc(32,1).toString('base64'),...['PROFILE_IMAGE_DIRECTORY','COMPANY_FEED_IMAGE_DIRECTORY','ASSET_EVIDENCE_DIRECTORY','GRIEVANCE_ATTACHMENT_DIRECTORY'].map((key,i)=>key+'=/data/'+['profile-images','company-feed','assets','private-grievances'][i])].flatMap(value=>['--env',value]);
try{
 docker('network','create',network);
 docker('run','--detach','--name',names[0],'--network',network,'redis:7-alpine');
 for(const [index,entry] of [[1,'server.cjs'],[2,'worker.cjs']])docker('run','--detach','--name',names[index],'--network',network,...(index===2?['--no-healthcheck']:[]),...config,image,'node','dist/'+entry);
 let ready=false;for(let i=0;i<80;i++){const log=docker('logs',names[2]);try{const status=docker('exec',names[1],'node','-e',"fetch('http://127.0.0.1:3000/api/system/live').then(r=>console.log(r.status)).catch(()=>console.log('starting'))");if(status==='200'&&log.includes('Redis connection ready.')){ready=true;break;}}catch{}await wait(200);}assert(ready,'Production processes must start');
 assert.equal(docker('exec',names[1],'id','-u'),'1000');
 assert.equal(docker('exec',names[1],'node','-e',"console.log(require('fs').existsSync('.env'))"),'false');
 docker('exec',names[1],'node','-e',"try{require.resolve('tsx');process.exit(1)}catch{};");
 const failure=docker('exec',names[1],'node','-e',"fetch('http://127.0.0.1:3000/api/system/ready').then(async r=>console.log(r.status,JSON.stringify(await r.json())))");assert.equal(failure,'503 {"success":false}');
 docker('stop','--time','5',names[0]);await wait(500);docker('start',names[0]);await wait(3000);
 for(const name of names.slice(1)){docker('stop','--time','20',name);const logs=docker('logs',name);assert.equal(docker('inspect','--format','{{.State.ExitCode}}',name),'0',name+': '+logs);assert.match(logs,/shutdown_complete/);}
 console.log('PASS clean production dependencies, non-root web/worker, liveness, dependency failure, Redis stop/restart and real SIGTERM draining');
}finally{for(const name of names.reverse())try{docker('rm','--force',name);}catch{}try{docker('network','rm',network);}catch{}}
