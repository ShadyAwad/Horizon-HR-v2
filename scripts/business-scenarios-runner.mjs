import {loadDevelopmentEnvironment} from './development-environment.mjs';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
loadDevelopmentEnvironment();
if(!['development','test','demo'].includes(process.env.NODE_ENV||'development'))throw Error('Business scenarios refuse production');
const scenarios=['hiring-equipment','attendance-leave','privacy-publication'];
const integrations=Object.fromEntries(['completion','queries','shapes','assignment','document','html','errors-production','feed-version','feed-date','security-baseline'].map(p=>['input-'+p,'scripts/input-security-test.ts']).concat(['registration','ownership','reg-orders-a','reg-orders-b','auth-orders-a','auth-orders-b','reg-race','auth-race','reg-expiry','reg-malformed','auth-malformed','account','removal','sessions','authorization'].map(p=>['passkey-'+p,'scripts/passkey-security-test.ts']).concat(Object.entries({'maplibre':'scripts/maplibre-browser-test.ts','pwa-audit':'scripts/pwa-release-test.ts','feed-browser':'scripts/company-feed-polish-browser-test.ts','communications-sessions':'scripts/communications-session-test.ts','release-passkeys-removal':'scripts/release-passkeys-test.ts','files-jobs':'scripts/public-files-test.ts','files-offers':'scripts/public-files-test.ts','files-images':'scripts/public-files-test.ts','files-uploads':'scripts/public-files-test.ts','files-qr':'scripts/public-files-test.ts','privacy-qr':'scripts/privacy-response-test.ts','people-baseline':'scripts/people-browser-test.ts','privacy-cases':'scripts/privacy-response-test.ts','privacy-hiring':'scripts/privacy-response-test.ts','privacy-feed':'scripts/privacy-response-test.ts','permission-auth-baseline':'scripts/permission-revocation-test.ts','permission-hiring':'scripts/permission-revocation-test.ts','permission-services':'scripts/permission-revocation-test.ts','permission-hiring-baseline':'scripts/permission-revocation-test.ts','permission-core':'scripts/permission-revocation-test.ts','permission-leave':'scripts/permission-revocation-test.ts','tenant-isolation':'scripts/tenant-isolation-test.ts','tenant-isolation-entities':'scripts/tenant-isolation-test.ts','feed-status':'scripts/feed-status-test.ts','origin-csrf':'scripts/origin-csrf-test.ts','origin-csrf-production':'scripts/origin-csrf-test.ts','attendance-integration':'scripts/attendance-integration-test.ts','attendance-departure':'scripts/attendance-departure-integration-test.ts','communications-sessions':'scripts/communications-session-test.ts','release-security':'scripts/release-security-test.ts','release-passkeys':'scripts/release-passkeys-test.ts'}))));
const allowed=[...scenarios,...Object.keys(integrations)];
const suites=process.argv.slice(2);if(!suites.length)suites.push(...scenarios);
if(suites.some(s=>!allowed.includes(s)))throw Error('Unknown business scenario');
for(const suite of suites){
 const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');const port=reservation.address().port;await new Promise(r=>reservation.close(r));
 const base='http://localhost:'+port;
 const production=suite==='maplibre'||suite==='origin-csrf-production'||suite==='input-errors-production'||suite==='input-completion';
 const fileAudit=suite.startsWith('files-')||suite==='pwa-audit';
 const fileStorage=fileAudit?await mkdtemp(path.join(os.tmpdir(),'stanza-files-')):undefined;
 const fileEnv=fileAudit?{FILE_AUDIT_PHASE:suite.slice(6),FILE_AUDIT_STORAGE_ROOT:fileStorage,PROFILE_IMAGE_DIRECTORY:path.join(fileStorage,'avatars'),COMPANY_FEED_IMAGE_DIRECTORY:path.join(fileStorage,'feed'),ASSET_EVIDENCE_DIRECTORY:path.join(fileStorage,'assets'),GRIEVANCE_ATTACHMENT_DIRECTORY:path.join(fileStorage,'grievances'),DOCUMENT_EXTRACTION_TEMP_DIR:path.join(fileStorage,'extractions'),...(suite==='files-uploads'?{NODE_ENV:'test',DOCUMENT_EXTRACTION_PROVIDER:'fixture',ALLOW_DOCUMENT_EXTRACTION_FIXTURES:'true'}:{})}:{};
 const storage=production?await mkdtemp(path.join(os.tmpdir(),'stanza-origin-production-')):undefined;
 const productionEnv=production?{NODE_ENV:'production',STANZA_RUNTIME_PROFILE:'production',TRUST_PROXY_HOPS:'1',WEB_REPLICAS:'1',STANZA_DEMO_ENV:'false',ALLOW_DOCUMENT_EXTRACTION_FIXTURES:'false',DATABASE_SSL:'false',DATABASE_ALLOW_PLAINTEXT:'true',DATABASE_POOL_MAX:'2',QR_TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('base64'),PROFILE_IMAGE_DIRECTORY:path.join(storage,'avatars'),COMPANY_FEED_IMAGE_DIRECTORY:path.join(storage,'feed'),ASSET_EVIDENCE_DIRECTORY:path.join(storage,'assets'),GRIEVANCE_ATTACHMENT_DIRECTORY:path.join(storage,'grievances'),ORIGIN_TEST_PRODUCTION:'true'}:{};
 const env={...process.env,NODE_ENV:'development',STANZA_RUNTIME_PROFILE:'local-preview',PORT:String(port),APP_BASE_URL:base,WEBAUTHN_ORIGIN:base,WEBAUTHN_RP_ID:'localhost',TRUST_PROXY_HOPS:'0',DEV_AUTH_HEADERS:'false',ALLOW_TRYCLOUDFLARE_DEV_ORIGINS:'false',BROWSER_BASE_URL:base,TENANT_AUDIT_ENTITIES:String(suite==='tenant-isolation-entities'),PERMISSION_AUDIT_PHASE:suite.startsWith('permission-')?suite.slice(11):'',PRIVACY_TEST_PHASE:suite.startsWith('privacy-')?suite.slice(8):'',PASSKEY_BASELINE_REMOVAL:String(suite==='release-passkeys-removal'),PASSKEY_AUDIT_PHASE:suite.startsWith('passkey-')?suite.slice(8):'',INPUT_AUDIT_PHASE:suite.startsWith('input-')?suite.slice(6):'',CORS_ALLOWED_ORIGINS:base,RESEND_API_KEY:'',EMAIL_FROM:'',ATTENDANCE_TEST_BASE_URL:base,COMMUNICATIONS_TEST_BASE_URL:base,...productionEnv,...fileEnv};
 // Fresh task-owned server isolates rate-limit budgets; production limits are never changed.
 // No global worker is started: scenario C exercises the real rollup through its own disposable queue/worker.
 const verifySessionLogs=suite==='release-security';
 const verifyPrivacyLogs=suite.startsWith('input-')||suite.startsWith('passkey-')||fileAudit||['privacy-cases','privacy-hiring','privacy-feed'].includes(suite),captureLogs=verifySessionLogs||verifyPrivacyLogs;
 const privateMarkers=[];
 let serverLogs='';const sessionTokens=[];
 const server=spawn(process.execPath,['dist/server.cjs'],{env,windowsHide:true,stdio:captureLogs?['ignore','pipe','pipe']:['ignore','inherit','inherit']});
 if(captureLogs)for(const stream of [server.stdout,server.stderr])stream.on('data',chunk=>{serverLogs+=chunk;process.stdout.write(chunk);});
 let stopped=false;const exited=once(server,'exit').then(()=>{stopped=true;});
 try {
  let ready=false;for(let n=0;n<120&&!stopped;n++){try{const r=await fetch(base+'/api/system/live',{signal:AbortSignal.timeout(1000)});if(r.status===200){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,250));}if(!ready)throw Error('Task-owned preview did not become ready');
  const test=spawn(process.execPath,['--import','tsx',integrations[suite]||`scripts/business-${suite}-test.ts`],{env:{...env,NODE_ENV:'development'},windowsHide:true,stdio:captureLogs?['inherit','inherit','inherit','ipc']:'inherit'});
  if(verifySessionLogs)test.on('message',message=>{if(message?.type==='session-log-check'&&Array.isArray(message.tokens))sessionTokens.push(...message.tokens);});
  if(verifyPrivacyLogs)test.on('message',message=>{if(message?.type==='privacy-log-check'&&Array.isArray(message.markers))privateMarkers.push(...message.markers);});
  const [code]=await once(test,'exit');if(code!==0)throw Error(`Business ${suite} failed (${code})`);
 } finally {if(!stopped)server.kill();await exited;if(storage){if(!storage.startsWith(path.join(os.tmpdir(),'stanza-origin-production-')))throw Error('Unexpected fixture storage');await rm(storage,{recursive:true,force:true});}if(fileStorage){if(path.dirname(fileStorage)!==os.tmpdir()||!path.basename(fileStorage).startsWith('stanza-files-'))throw Error('Unexpected file-audit storage');await rm(fileStorage,{recursive:true,force:true});}}
 if(verifyPrivacyLogs){if(!privateMarkers.length)throw Error('Missing sensitive fixture markers for log verification');if(privateMarkers.some(marker=>typeof marker!=='string'||serverLogs.includes(marker)))throw Error('Sensitive fixture content appeared in server logs');console.log('PASS sensitive fixture markers absent from captured server logs');}
 if(verifySessionLogs){
  if(sessionTokens.length<4)throw Error('Missing real session tokens for log redaction verification');
  if(sessionTokens.some(token=>typeof token!=='string'||serverLogs.includes(token)))throw Error('Session log redaction check failed');
  console.log('PASS issued session tokens absent from captured task-owned server logs');
 }
}
