import assert from 'node:assert/strict';
import {BusinessFixtures} from './business-scenario-fixtures';
const f=new BusinessFixtures();
const probe=process.env.RELEASE_SECURITY_PROBE==='true';
try {
 await f.setup('release-passkeys');
 const page=await f.page(f.employee);
 await page.evaluate('globalThis.__name = (fn) => fn');
 const cdp=await f.employee.context.newCDPSession(page);
 await cdp.send('WebAuthn.enable');
 const {authenticatorId}=await cdp.send('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',transport:'internal',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true}});
 async function credential(kind:'create'|'get',options:any) {
  return page.evaluate(async({kind,options}:any)=>{
   const bytes=(s:string)=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
   options.challenge=bytes(options.challenge);
   if(options.user)options.user.id=bytes(options.user.id);
   for(const key of ['excludeCredentials','allowCredentials'])if(options[key])options[key]=options[key].map((x:any)=>({...x,id:bytes(x.id)}));
   const value:any=kind==='create'?await navigator.credentials.create({publicKey:options}):await navigator.credentials.get({publicKey:options});
   return value.toJSON();
  },{kind,options});
 }
 const registration=await f.ok(f.employee,'/api/auth/passkeys/register/options',{});
 const registered=await credential('create',registration.options);
 await f.ok(f.employee,'/api/auth/passkeys/register/verify',{credential:registered,deviceLabel:'Disposable release authenticator'});
 assert.equal((await f.ok(f.employee,'/api/auth/passkeys')).passkeys.length,1);
 assert.equal((await f.ok(f.foreign,'/api/auth/passkeys')).passkeys.length,0);
 console.log('PASS virtual authenticator registration and private credential listing');
 async function assertion(){const r=await f.ok(null,'/api/auth/passkeys/login/options',{email:f.employee.email});return credential('get',r.options);}
 if(process.env.PASSKEY_BASELINE_REMOVAL==='true'){
  const fresh=await assertion();
  await f.ok(null,'/api/auth/passkeys/login/verify',{email:f.employee.email,credential:fresh});
  const removed=await assertion();
  await f.db.query('DELETE FROM user_webauthn_credentials WHERE tenant_id=$1 AND employee_id=$2',[f.primary,f.employee.id]);
  assert.equal((await f.api(null,'/api/auth/passkeys/login/verify',{email:f.employee.email,credential:removed})).status,401,'removed credential denied');
 }else{
 const first=await assertion();
 const before=(await f.db.query("SELECT count(*)::int n FROM audit_logs WHERE tenant_id=$1 AND action='passkey.login'",[f.primary])).rows[0].n;
 const lock=await f.db.connect();
 let results:any[];
 try {
  await lock.query('BEGIN');
  await lock.query("SELECT id FROM webauthn_challenges WHERE tenant_id=$1 AND employee_id=$2 AND challenge_type='authentication' AND used_at IS NULL FOR UPDATE",[f.primary,f.employee.id]);
  const pending=[f.api(null,'/api/auth/passkeys/login/verify',{email:f.employee.email,credential:first}),f.api(null,'/api/auth/passkeys/login/verify',{email:f.employee.email,credential:first})];
  let blocked=0;
  for(let i=0;i<60;i++){
   blocked=(await f.db.query("SELECT count(*)::int n FROM pg_stat_activity WHERE usename='stanza_runtime' AND wait_event_type='Lock' AND query LIKE '%UPDATE webauthn_challenges%' ")).rows[0].n;
   if(blocked>=2)break;await new Promise(r=>setTimeout(r,50));
  }
  assert.equal(blocked,2,'both real challenge updates reached the lock');
  await lock.query('COMMIT');results=await Promise.all(pending);
 }finally{await lock.query('ROLLBACK');lock.release();}
 const successes=results!.filter(r=>r.status===200).length;
 console.log(`Concurrent assertion successes: ${successes}; expected 1`);
 if(!probe)assert.equal(successes,1,'a challenge must be consumed exactly once under concurrency');
 const after=(await f.db.query("SELECT count(*)::int n FROM audit_logs WHERE tenant_id=$1 AND action='passkey.login'",[f.primary])).rows[0].n;
 if(!probe)assert.equal(after-before,1,'only successful authentication audited');
 assert.equal((await f.api(null,'/api/auth/passkeys/login/verify',{email:f.employee.email,credential:first})).status,400,'sequential replay denied');
 const expired=await assertion();
 await f.db.query("UPDATE webauthn_challenges SET expires_at=NOW()-interval '1 second' WHERE tenant_id=$1 AND employee_id=$2 AND used_at IS NULL",[f.primary,f.employee.id]);
 assert.equal((await f.api(null,'/api/auth/passkeys/login/verify',{email:f.employee.email,credential:expired})).status,400,'expired challenge denied');
 const wrongOrigin=await assertion();
 const clientData=JSON.parse(Buffer.from(wrongOrigin.response.clientDataJSON,'base64url').toString());clientData.origin='https://wrong-origin.example.invalid';
 wrongOrigin.response.clientDataJSON=Buffer.from(JSON.stringify(clientData)).toString('base64url');
 const denied=await f.api(null,'/api/auth/passkeys/login/verify',{email:f.employee.email,credential:wrongOrigin});
 console.log('Wrong origin status: '+denied.status);
 if(!probe){assert.equal(denied.status,400);assert(!JSON.stringify(denied.body).includes('wrong-origin'));}
 const foreign=await assertion();
 assert.equal((await f.api(null,'/api/auth/passkeys/login/verify',{email:f.foreign.email,credential:foreign})).status,401,'foreign account cannot use credential');
 }
 await cdp.send('WebAuthn.removeVirtualAuthenticator',{authenticatorId});
 console.log('PASS virtual authenticator replay, expiry, origin, ownership and removed credential');
}finally{await f.cleanup();}
