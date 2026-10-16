import './router-env';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {getMigrationPool,migrationUrl} from './migration-pool';
import {assertDatabaseMutationSafety} from './mutation-safety';
import {lockRecovery,recoverDemo,RECOVERY_TABLES} from './demo/recovery';
import {readManifest} from './demo/reset';
assertDatabaseMutationSafety(migrationUrl(),'Demo recovery regression',true,true);
const pool=getMigrationPool(),client=await pool.connect();
async function fingerprint(t:string){const result:Record<string,string>={};for(const table of RECOVERY_TABLES)result[table]=(await client.query(`SELECT md5(COALESCE(string_agg(to_jsonb(r)::text,'' ORDER BY id),'')) hash FROM ${table} r WHERE tenant_id=$1`,[t])).rows[0].hash;return result;}
try{
 await client.query('BEGIN');const tenant=await lockRecovery(client),t=tenant.id,manifest=await readManifest(client,t);
 const competitor=await pool.connect();try{await competitor.query('BEGIN');await assert.rejects(()=>lockRecovery(competitor),/Another demo seed/);}finally{await competitor.query('ROLLBACK');competitor.release();}console.log('PASS simultaneous recovery refused by bounded advisory lock');
 const employee=(await client.query("SELECT id FROM employees WHERE tenant_id=$1 AND email='employee@stanza-demo.com'",[t])).rows[0].id;
 const foreign=randomUUID();await client.query('INSERT INTO tenants(id,slug,company_name) VALUES($1,$2,$3)',[foreign,'demo-recovery-regression-'+foreign,'Disposable recovery control']);
 const foreignAsset=randomUUID();await client.query("INSERT INTO assets(id,tenant_id,name,asset_tag,category,status,condition) VALUES($1,$2,'Foreign control','RESTORE-CONTROL','laptop','available','good')",[foreignAsset,foreign]);
 const control=await fingerprint(foreign),passwords=(await client.query('SELECT id,password_hash FROM employees WHERE tenant_id=$1 ORDER BY id',[t])).rows;
 const candidateId=manifest.hiring_applicants[0],candidateName=(await client.query('SELECT full_name FROM hiring_applicants WHERE tenant_id=$1 AND id=$2',[t,candidateId])).rows[0].full_name;
 const stableTables=['employees','tenant_roles','tenant_role_permissions','company_locations','geofences','assets'];
 const baseline:Record<string,string>={};for(const table of stableTables)baseline[table]=(await client.query("SELECT md5(COALESCE(string_agg((to_jsonb(r)-ARRAY['updated_at','created_at','password_hash'] - CASE WHEN '"+table+"'='tenant_role_permissions' THEN ARRAY['id'] ELSE ARRAY[]::text[] END)::text,'' ORDER BY "+(table==='tenant_role_permissions'?'role_id,permission_key':'id')+"),'')) hash FROM "+table+" r WHERE tenant_id=$1",[t])).rows[0].hash;
 const ticket=randomUUID();await client.query("INSERT INTO support_tickets(id,tenant_id,requester_id,issue_type,summary,description,urgency) VALUES($1,$2,$3,'it_help','Recovery fixture','Disposable recovery check','normal')",[ticket,t,employee]);
 await client.query("UPDATE hiring_applicants SET full_name='Disposable changed fixture' WHERE tenant_id=$1 AND id=$2",[t,manifest.hiring_applicants[0]]);
 const session=randomUUID();await client.query("INSERT INTO auth_sessions(id,tenant_id,employee_id,session_token_hash,expires_at) VALUES($1,$2,$3,$4,now()+interval '1 hour')",[session,t,employee,'recovery-fixture-'+randomUUID()]);
 const badge=randomUUID();await client.query("INSERT INTO qr_access_tokens(id,tenant_id,purpose,subject_type,employee_id,token_hash,created_by_employee_id) VALUES($1,$2,'employee_verification','employee',$3,$4,$3)",[badge,t,employee,createHash('sha256').update(randomUUID()).digest('hex')]);
 const beforeFailure=await fingerprint(t);await client.query('SAVEPOINT failure_probe');
 await assert.rejects(()=>recoverDemo(client,tenant,phase=>{if(phase==='reseed existing company')throw Error('Owned halfway failure');}),/Owned halfway failure/);
 await client.query('ROLLBACK TO SAVEPOINT failure_probe');assert.deepEqual(await fingerprint(t),beforeFailure);console.log('PASS halfway failure rolls back additions, cases and sessions');
 const counts=async()=>{const r:Record<string,number>={};for(const table of RECOVERY_TABLES)r[table]=Number((await client.query(`SELECT count(*) FROM ${table} WHERE tenant_id=$1`,[t])).rows[0].count);return r;};
 const removed=await recoverDemo(client,tenant);assert(removed>0);assert.equal((await client.query('SELECT 1 FROM support_tickets WHERE tenant_id=$1 AND id=$2',[t,ticket])).rowCount,0);assert.equal((await client.query('SELECT 1 FROM auth_sessions WHERE tenant_id=$1',[t])).rowCount,0);
 assert.equal((await client.query('SELECT 1 FROM qr_access_tokens WHERE tenant_id=$1 AND id=$2',[t,badge])).rowCount,0);
 assert.deepEqual((await client.query('SELECT id,password_hash FROM employees WHERE tenant_id=$1 ORDER BY id',[t])).rows,passwords);
 assert.equal((await client.query('SELECT full_name FROM hiring_applicants WHERE tenant_id=$1 AND id=$2',[t,candidateId])).rows[0].full_name,candidateName);
 for(const table of stableTables)assert.equal((await client.query("SELECT md5(COALESCE(string_agg((to_jsonb(r)-ARRAY['updated_at','created_at','password_hash'] - CASE WHEN '"+table+"'='tenant_role_permissions' THEN ARRAY['id'] ELSE ARRAY[]::text[] END)::text,'' ORDER BY "+(table==='tenant_role_permissions'?'role_id,permission_key':'id')+"),'')) hash FROM "+table+" r WHERE tenant_id=$1",[t])).rows[0].hash,baseline[table],table+' baseline restored');
 const first=await counts();await recoverDemo(client,tenant);assert.deepEqual(await counts(),first);assert.deepEqual(await fingerprint(foreign),control);console.log('PASS mutation/recovery/twice; passwords, foreign tenant and baseline counts preserved; sessions invalidated');
 const wrong=process.env.DEMO_TENANT_ID;process.env.DEMO_TENANT_ID=foreign;await assert.rejects(()=>lockRecovery(client),/match|exact/);process.env.DEMO_TENANT_ID=wrong;
 console.log('PASS exact tenant mismatch refuses recovery');
}finally{await client.query('ROLLBACK');client.release();await pool.end();console.log('PASS all recovery regression changes and foreign fixture rolled back; curated demo retained');}
