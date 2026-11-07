import assert from 'node:assert/strict';
import {request} from 'node:http';
import {gzipSync,deflateSync} from 'node:zlib';
import {BusinessFixtures} from './business-scenario-fixtures';
const f=new BusinessFixtures();
const tokens:string[]=[];
async function rememberTokens(){for(const actor of f.actors)for(const cookie of await actor.context.cookies())if(cookie.name==='stanza_session'&&!tokens.includes(cookie.value))tokens.push(cookie.value);}
async function denied(label:string,url='/api/auth/sessions'){
 const r=await f.api(f.employee,url);assert.equal(r.status,401,label);assert.equal(r.body.success,false);assert(!/stack|password_hash|DATABASE_URL|postgres|C:\\/i.test(JSON.stringify(r.body)));console.log('PASS '+label);
}
try{
 await f.setup('release-security');const {employee,limited}=f;
 await rememberTokens();
 assert.equal((await f.api(employee,'/api/auth/sessions')).status,200,'active cookie session authorizes');
 for(const value of ['%ZZ','%','%E0%A4%A']){
  const malformed=await employee.context.request.get(f.base+'/api/auth/sessions',{headers:{Cookie:'stanza_session='+value},timeout:5000});
  assert.equal(malformed.status(),401,'malformed cookie controlled response');
  assert.equal((await f.api(employee,'/api/auth/sessions')).status,200,'server remains available with valid session');
 }
 console.log('PASS malformed session cookies return 401 and server stays alive');
 const session=(await f.ok(employee,'/api/auth/sessions')).sessions.find((s:any)=>s.isCurrent);assert(session);
 for(const status of ['is_active','employment_status']){
  await f.db.query(status==='is_active'?'UPDATE employees SET is_active=false WHERE tenant_id=$1 AND id=$2':"UPDATE employees SET employment_status='terminated' WHERE tenant_id=$1 AND id=$2",[f.primary,employee.id]);
  await denied('existing session rejects deactivated account via '+status);
  const before=(await f.db.query('SELECT count(*)::int n FROM auth_sessions WHERE tenant_id=$1 AND employee_id=$2',[f.primary,employee.id])).rows[0].n;
  const login=await employee.context.request.post(f.base+'/api/auth/login',{headers:{Origin:f.base},data:{email:employee.email,password:f.password}});
  assert.equal(login.status(),401);assert(!login.headers()['set-cookie']);
  const after=(await f.db.query('SELECT count(*)::int n FROM auth_sessions WHERE tenant_id=$1 AND employee_id=$2',[f.primary,employee.id])).rows[0].n;
  assert.equal(after,before,'denied inactive login creates no session');
  await f.db.query("UPDATE employees SET is_active=true,employment_status='active' WHERE tenant_id=$1 AND id=$2",[f.primary,employee.id]);
  assert.equal((await f.api(employee,'/api/auth/sessions')).status,200);
 }
 console.log('PASS both account activity flags deny new sessions without inserting auth records');
 await f.db.query("UPDATE auth_sessions SET expires_at=NOW()-interval '1 second' WHERE id=$1 AND tenant_id=$2",[session.id,f.primary]);
 await denied('expired session denied');
 await f.db.query("UPDATE auth_sessions SET expires_at=NOW()+interval '1 hour' WHERE id=$1 AND tenant_id=$2",[session.id,f.primary]);
 await f.db.query('UPDATE auth_sessions SET revoked_at=NOW() WHERE id=$1 AND tenant_id=$2',[session.id,f.primary]);
 await denied('revoked session denied');
 await f.db.query('UPDATE auth_sessions SET revoked_at=NULL WHERE id=$1 AND tenant_id=$2',[session.id,f.primary]);
 const own=await f.ok(employee,'/api/auth/sessions');
 assert(own.sessions.every((s:any)=>!('session_token_hash' in s||'token' in s)),'session listing contains no token/hash');
 assert(own.sessions.every((s:any)=>!s.employeeId||s.employeeId===employee.id),'session listing is own-only');
 const foreignLogout=await limited.context.request.post(f.base+'/api/auth/logout',{headers:{Origin:'https://different-origin.example.invalid'}});
 assert.equal(foreignLogout.status(),403);assert.equal((await f.api(limited,'/api/auth/sessions')).status,200,'rejected logout preserves session');
 const cookie=(await employee.context.cookies()).find((c:any)=>c.name==='stanza_session');assert(cookie);
 assert.equal((await f.api(employee,'/api/auth/logout',{})).status,200);
 assert((await f.db.query('SELECT revoked_at FROM auth_sessions WHERE id=$1 AND tenant_id=$2',[session.id,f.primary])).rows[0].revoked_at);
 const replay=await employee.context.request.get(f.base+'/api/auth/sessions',{headers:{Cookie:'stanza_session='+cookie.value}});assert.equal(replay.status(),401,'old cookie denied after logout');
 console.log('PASS same-origin logout revokes current session; replay denied; cross-origin logout blocked');
 // Exercise the global parser before authentication/routing on the real built server.
 async function compressedRequest(body:Buffer,encoding?:string,tail?:Buffer,contentType='application/json') {
  return new Promise<number>((resolve,reject)=>{
   const req=request(f.base+'/api/release-parser-probe',{method:'POST',headers:{Origin:f.base,'Content-Type':contentType,'Content-Length':body.length+(tail?.length??0),...(encoding?{'Content-Encoding':encoding}:{})}},res=>{
    res.resume();res.once('end',()=>resolve(res.statusCode!));res.once('error',reject);
   });
   req.once('error',reject);req.setTimeout(5000,()=>req.destroy(new Error('Compressed request did not complete')));
   if(tail){req.write(body);setTimeout(()=>req.end(tail),75);}else req.end(body);
  });
 }
 async function parserStillHealthy() {
  await new Promise(resolve=>setTimeout(resolve,250));
  assert.equal((await f.publicContext.request.get(f.base+'/api/system/live')).status(),200,'late decoder errors must not shut down the server');
 }
 const json=Buffer.from('{}');
 for(const [encoding,encode] of [['gzip',gzipSync],['deflate',deflateSync]] as const){
  assert.equal(await compressedRequest(encode(json),encoding),404,'valid compressed JSON retains normal route behavior');
  const first=Buffer.concat([encode(json),Buffer.from([0])]);
  const tail=Buffer.alloc(100*1024,0x58);
  assert.equal(await compressedRequest(Buffer.concat([first,tail]),encoding),404);
  await parserStillHealthy();
  assert.equal(await compressedRequest(first,encoding,tail),404,'delayed trailing bytes finish safely');
  await parserStillHealthy();
 }
 assert.equal(await compressedRequest(json),404,'ordinary JSON retains normal route behavior');
 assert.equal(await compressedRequest(Buffer.from('invalid gzip'),'gzip'),400);
 assert.equal(await compressedRequest(json,'unsupported'),415);
 assert.equal(await compressedRequest(gzipSync(json),'gzip',undefined,'application/json; charset=iso-8859-1'),415);
 assert.equal(await compressedRequest(gzipSync(Buffer.from(JSON.stringify({value:'x'.repeat(2*1024*1024)}))),'gzip'),413,'limit applies to expanded JSON');
 await parserStillHealthy();
 console.log('PASS global JSON parser: gzip/deflate immediate and delayed trailing bytes cannot shut down server; valid compressed/plain, invalid compression, encoding/charset and expanded limit controls');
 await rememberTokens();assert(tokens.length>=4);process.send?.({type:'session-log-check',tokens});
}finally{await f.cleanup();}
