import assert from 'node:assert/strict';
import {spawn,type ChildProcess} from 'node:child_process';
import {once} from 'node:events';
import {createServer,connect,type Socket} from 'node:net';
import {Queue,QueueEvents,Worker} from 'bullmq';
import {BusinessFixtures} from './business-scenario-fixtures';
import {getRedisConnection,withTenant} from '../src/lib/hr-background';
import {processMessage} from '../src/server/communications/communications-queue';
import {randomUUID} from 'node:crypto';
import {QrTokenService} from '../src/server/qr/qr-token-service';
const f=new BusinessFixtures(),connection=getRedisConnection(),workers:ChildProcess[]=[];
assert.match(new URL(process.env.DATABASE_URL!).pathname,/^\/stanza_migration_test_[a-f0-9]{24}$/,'audit only operates on disposable migration database');
assert(process.env.WORKER_SMOKE_REDIS_URL && process.env.REDIS_URL===process.env.WORKER_SMOKE_REDIS_URL,'task-owned Redis required');
assert(['127.0.0.1','localhost'].includes(connection.host!)&&connection.port!==6379,'never use normal Redis');
assert(!process.env.RESEND_API_KEY,'no external email credentials');
let logs='',worker:ChildProcess|undefined;const queue=new Queue('hr-queue',{connection}),events=new QueueEvents('hr-queue',{connection});
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function until(check:()=>Promise<boolean>,message:string,timeout=20000){const deadline=Date.now()+timeout;while(Date.now()<deadline){if(await check())return;await sleep(100);}throw Error(message);}
async function start(){const child=spawn(process.execPath,['dist/worker.cjs'],{windowsHide:true,env:{...process.env,RESEND_API_KEY:'',EMAIL_FROM:''},stdio:['ignore','pipe','pipe']});workers.push(child);let own='';for(const s of [child.stdout,child.stderr])s?.on('data',b=>{logs+=b;own+=b;});await until(async()=>own.includes('Redis connection ready.'),'owned worker startup');return child;}
async function stop(child?:ChildProcess){if(!child||child.exitCode!==null||child.signalCode!==null)return;const exited=once(child,'exit');child.kill();await exited;}
async function healthy(){assert.equal((await f.publicContext.request.get(f.base+'/api/system/live')).status(),200);}
async function job(name:string,data:unknown,options:object={}){const j=await queue.add(name,data,{attempts:3,backoff:{type:'fixed',delay:100},removeOnComplete:100,removeOnFail:100,...options});return j;}
async function finished(j:any){await j.waitUntilFinished(events,90000);}
async function failed(j:any){await until(async()=>await j.getState()==='failed','bounded failed state');await healthy();}
const marker='WORKER_PRIVATE_'+f.tag;
try{
 await events.waitUntilReady();await f.setup('worker-audit');process.send?.({type:'privacy-log-check',markers:[marker,f.password]});
 const data={tenantId:f.primary,employeeId:f.employee.id,workDate:'2033-05-02'};
 await f.db.query("INSERT INTO time_logs(tenant_id,employee_id,clock_in_time,clock_out_time,location_status,is_valid_geofence) VALUES($1,$2,'2033-05-02T08:00:00Z','2033-05-02T10:00:00Z','outside',false),($1,$2,'2033-05-02T11:00:00Z','2033-05-02T12:30:00Z','verified',true)",[f.primary,f.employee.id]);
 const support=(await f.ok(f.admin,'/api/support',{issueType:'it_help',urgency:'normal',summary:'Worker fixture',description:marker})).ticket;
 const count=async()=>Number((await f.db.query("SELECT count(*) n FROM outbox_events WHERE tenant_id=$1 AND event_type='notification.support_updated'",[f.primary])).rows[0].n);
  const before=await count();
 const historyCount=async()=>Number((await f.db.query('SELECT count(*) n FROM support_ticket_events WHERE tenant_id=$1 AND ticket_id=$2',[f.primary,support.id])).rows[0].n);
 const auditCount=async()=>Number((await f.db.query('SELECT count(*) n FROM audit_logs WHERE tenant_id=$1 AND entity_id=$2',[f.primary,support.id])).rows[0].n);
 const beforeHistory=await historyCount(),beforeAudit=await auditCount();
 await f.db.query(`CREATE FUNCTION worker_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.tenant_id='${f.primary}'::uuid AND NEW.event_type='notification.support_updated' THEN RAISE EXCEPTION 'owned rollback fixture'; END IF; RETURN NEW; END $$;CREATE TRIGGER worker_audit_failure BEFORE INSERT ON outbox_events FOR EACH ROW EXECUTE FUNCTION worker_audit_failure()`);
 assert.equal((await f.api(f.admin,'/api/support/'+support.id+'/update',{status:'in_progress',expectedStatus:'open'})).status,500);
 assert.equal((await f.db.query('SELECT status FROM support_tickets WHERE id=$1',[support.id])).rows[0].status,'open');assert.equal(await count(),before);assert.equal(await historyCount(),beforeHistory);assert.equal(await auditCount(),beforeAudit);await healthy();
 await f.db.query('DROP TRIGGER worker_audit_failure ON outbox_events;DROP FUNCTION worker_audit_failure()');
 await f.ok(f.admin,'/api/support/'+support.id+'/update',{status:'in_progress',expectedStatus:'open'});assert.equal(await count(),before+1);
 console.log('PASS actual Support mutation: injected precommit outbox failure rolls back business/audit/event/outbox; normal commit persists both');
 const location=(await f.db.query("INSERT INTO company_locations(tenant_id,name,latitude,longitude,boundary) VALUES($1,'Owned worker geofence',30,31,ST_Buffer(ST_SetSRID(ST_MakePoint(31,30),4326)::geography,1000)::geometry) RETURNING id",[f.primary])).rows[0].id;assert(location);
  assert.equal((await f.api(f.employee,'/api/clock-in',{latitude:30,longitude:31,tenant_id:f.foreignTenant,employee_id:f.foreign.id})).status,200);
 assert.equal((await f.db.query('SELECT count(*)::int n FROM time_logs WHERE tenant_id=$1 AND employee_id=$2',[f.foreignTenant,f.foreign.id])).rows[0].n,0);await healthy();
 const pending=(await f.db.query("SELECT id,payload FROM outbox_events WHERE tenant_id=$1 AND event_type='background.hr' AND processed_at IS NULL",[f.primary])).rows;assert(pending.length>0);
 assert.equal((await f.db.query('SELECT count(*)::int n FROM time_logs WHERE tenant_id=$1 AND employee_id=$2 AND clock_out_time IS NULL',[f.primary,f.employee.id])).rows[0].n,1);
 for(const r of pending){assert.equal(r.payload.data.tenantId,f.primary);if(r.payload.data.employeeId)assert.equal(r.payload.data.employeeId,f.employee.id);}
 // Remove only a fixture Redis delivery; database-backed outbox must replay after worker process restart.
 for(const r of pending){const j=await queue.getJob('dispatch-'+r.id);if(j)await j.remove();}
 console.log('PASS real API without worker: business state authoritative, durable pending work and forged identity denied');
 worker=await start();await until(async()=>(await f.db.query("SELECT count(*)::int n FROM outbox_events WHERE tenant_id=$1 AND event_type='background.hr' AND processed_at IS NULL",[f.primary])).rows[0].n===0,'outbox recovered');
 const auditBefore=Number((await f.db.query('SELECT count(*) n FROM audit_logs WHERE tenant_id=$1',[f.primary])).rows[0].n);
 for(const r of pending)await finished(await job(r.payload.name,{...r.payload.data,dispatchId:r.id}));
 assert.equal(Number((await f.db.query('SELECT count(*) n FROM audit_logs WHERE tenant_id=$1',[f.primary])).rows[0].n),auditBefore,'duplicate audit dispatch creates no audit row');
 await finished(await job('rollupAttendanceDailySummary',data));await finished(await job('rollupAttendanceDailySummary',data));
 const summaries=(await f.db.query('SELECT first_clock_in,last_clock_out,total_minutes,invalid_geofence_count FROM attendance_daily_summaries WHERE tenant_id=$1 AND employee_id=$2 AND work_date=$3',[f.primary,f.employee.id,data.workDate])).rows;
 assert.equal(summaries.length,1);assert.equal(summaries[0].total_minutes,210);assert.equal(summaries[0].invalid_geofence_count,1);assert.equal(new Date(summaries[0].first_clock_in).toISOString(),'2033-05-02T08:00:00.000Z');assert.equal(new Date(summaries[0].last_clock_out).toISOString(),'2033-05-02T12:30:00.000Z');
 console.log('PASS delayed built worker recovery, missing Redis delivery replay, duplicate audit and deterministic 210-minute attendance rollup');
 await f.db.query(`CREATE FUNCTION worker_rollup_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.tenant_id='${f.primary}'::uuid AND NEW.work_date='2033-05-02'::date THEN RAISE EXCEPTION 'owned rollup failure'; END IF; RETURN NEW; END $$;CREATE TRIGGER worker_rollup_failure BEFORE INSERT ON attendance_daily_summaries FOR EACH ROW EXECUTE FUNCTION worker_rollup_failure()`);
 const retry=await job('rollupAttendanceDailySummary',data,{backoff:{type:'fixed',delay:1000}});await until(async()=>Number((await queue.getJob(retry.id!))?.attemptsMade)>=1,'first retry failure observed');
 await f.db.query('DROP TRIGGER worker_rollup_failure ON attendance_daily_summaries;DROP FUNCTION worker_rollup_failure()');await finished(retry);assert.equal((await queue.getJob(retry.id!))?.attemptsMade,2);
 const invalid=await job('rollupAttendanceDailySummary',{...data,workDate:'not-a-date'});await failed(invalid);assert.equal((await queue.getJob(invalid.id!))?.attemptsMade,3);await finished(await job('rollupAttendanceDailySummary',data));
 console.log('PASS real worker deterministic DB failure → retry → success; exhaustion observable; next valid job succeeds and web stays healthy');
 const qr=(await new QrTokenService().issue({tenantId:f.foreignTenant,employeeId:f.foreign.id},{purpose:'onboarding_invite',expiresInMinutes:60})).tokenRecordId;
 await f.db.query("UPDATE qr_access_tokens SET expires_at=now()-interval '1 minute' WHERE id=$1",[qr]);
 await finished(await job('expireQrAccessToken',{tenantId:f.primary,tokenRecordId:qr}));assert.equal((await f.db.query('SELECT status FROM qr_access_tokens WHERE id=$1',[qr])).rows[0].status,'active');
 await finished(await job('expireQrAccessToken',{tenantId:f.foreignTenant,tokenRecordId:qr}));await finished(await job('expireQrAccessToken',{tenantId:f.foreignTenant,tokenRecordId:qr}));assert.equal((await f.db.query("SELECT count(*)::int n FROM audit_logs WHERE tenant_id=$1 AND entity_id=$2 AND action='qr.token_expired'",[f.foreignTenant,qr])).rows[0].n,1);
 await finished(await job('rollupAttendanceDailySummary',{...data,employeeId:f.foreign.id}));assert.equal((await f.db.query('SELECT count(*)::int n FROM attendance_daily_summaries WHERE tenant_id=$1 AND employee_id=$2',[f.primary,f.foreign.id])).rows[0].n,0);
 await finished(await job('expireQrAccessToken',{tenantId:f.primary,tokenRecordId:randomUUID()}));
  for(const bad of [{},null,{tenantId:f.primary}, {tenantId:f.primary,tokenRecordId:'invalid'},{tenantId:f.primary,tokenRecordId:{toString:null}}])await failed(await job('expireQrAccessToken',bad,{attempts:1}));await finished(await job('rollupAttendanceDailySummary',data));
 console.log('PASS built worker tenant mismatch, matching QR expiry, replay, stale target and malformed payload failures followed by good jobs');
 // Block only this owned rollup at its real PostgreSQL advisory-lock boundary, then terminate only its worker.
 const lock=await f.db.connect();await lock.query('BEGIN');await lock.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`attendance-rollup:${data.tenantId}:${data.employeeId}:${data.workDate}`]);
 try{const crash=await job('rollupAttendanceDailySummary',data);await until(async()=>await crash.getState()==='active','crash fixture active');await stop(worker);worker=undefined;await healthy();await lock.query('ROLLBACK');worker=await start();await finished(crash);assert.equal((await f.db.query('SELECT count(*)::int n FROM attendance_daily_summaries WHERE tenant_id=$1 AND employee_id=$2 AND work_date=$3',[f.primary,f.employee.id,data.workDate])).rows[0].n,1);console.log('PASS owned worker killed during active DB-blocked job → restart/stalled recovery → one summary; web unaffected');}finally{await lock.query('ROLLBACK');lock.release();}
 await stop(worker);worker=undefined;
 // Real web/worker outage through an owned loopback endpoint; normal Redis is never altered.
 const reserve=createServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');const proxyPort=(reserve.address() as any).port;await new Promise<void>(r=>reserve.close(()=>r()));
 const webReserve=createServer();webReserve.listen(0,'127.0.0.1');await once(webReserve,'listening');const webPort=(webReserve.address() as any).port;await new Promise<void>(r=>webReserve.close(()=>r()));const outageBase='http://localhost:'+webPort;
 const outageEnv={...process.env,REDIS_URL:'redis://127.0.0.1:'+proxyPort,NODE_ENV:'test',STANZA_RUNTIME_PROFILE:'local-preview',APP_BASE_URL:outageBase,WEBAUTHN_ORIGIN:outageBase,WEBAUTHN_RP_ID:'localhost',RESEND_API_KEY:'',EMAIL_FROM:''};
 const outageWeb=spawn(process.execPath,['dist/server.cjs'],{windowsHide:true,env:{...outageEnv,PORT:String(webPort)},stdio:['ignore','pipe','pipe']});workers.push(outageWeb);for(const stream of [outageWeb.stdout,outageWeb.stderr])stream?.on('data',b=>logs+=b);
 await until(async()=>{try{return (await fetch(outageBase+'/api/system/live')).ok;}catch{return false;}},'isolated outage web starts');
 const begun=Date.now();const closed=await f.employee.context.request.post(outageBase+'/api/clock-out',{headers:{Origin:outageBase},data:{latitude:30,longitude:31},timeout:15000});assert.equal(closed.status(),200);assert(Date.now()-begun<12000);assert((await fetch(outageBase+'/api/system/live')).ok);
 const backlog=(await f.db.query("SELECT id FROM outbox_events WHERE tenant_id=$1 AND event_type='background.hr' AND processed_at IS NULL",[f.primary])).rows;assert(backlog.length>0);await stop(outageWeb);
 const outageWorker=spawn(process.execPath,['dist/worker.cjs'],{windowsHide:true,env:outageEnv,stdio:['ignore','pipe','pipe']});workers.push(outageWorker);let recoveredOutput='';for(const stream of [outageWorker.stdout,outageWorker.stderr])stream?.on('data',b=>{logs+=b;recoveredOutput+=b;});
 const sockets=new Set<Socket>();const proxy=createServer(socket=>{const target=connect({host:connection.host!,port:connection.port!});sockets.add(socket);sockets.add(target);socket.on('error',()=>{});target.on('error',()=>socket.destroy());socket.on('close',()=>{target.destroy();sockets.delete(socket);});target.on('close',()=>sockets.delete(target));socket.pipe(target);target.pipe(socket);});
 try{await sleep(600);assert.equal(outageWorker.exitCode,null,'Redis connection failure does not kill owned worker');proxy.listen(proxyPort,'127.0.0.1');await once(proxy,'listening');await until(async()=>recoveredOutput.includes('Redis connection ready.'),'worker reconnect ready');await until(async()=>(await f.db.query("SELECT count(*)::int n FROM outbox_events WHERE tenant_id=$1 AND event_type='background.hr' AND processed_at IS NULL",[f.primary])).rows[0].n===0,'persisted work resumes after web restart/outage');await healthy();console.log('PASS real API enqueue outage: bounded success and durable pending work; web stopped, failed worker connection survives, proxy recovery drains database-backed work');}finally{await stop(outageWorker);for(const socket of sockets)socket.destroy();if(proxy.listening)await new Promise<void>(r=>proxy.close(()=>r()));}
 // Direct real message consumer, fixture-only provider: sequential replay is a no-op, retries share provider key.
 const candidate=(await f.ok(f.admin,'/api/hiring/applicants',{fullName:'Worker candidate',positionTitle:'Engineer',email:'fixture@example.invalid'})).applicant;
 const message=(await f.ok(f.admin,'/api/hiring/applicants/'+candidate.id+'/message',{subject:'Owned fixture',body:marker})).message;
 await f.db.query("UPDATE communication_messages SET status='queued' WHERE id=$1",[message.id]);let deliveries=0;const keys:string[]=[];
 const send=async(_input:unknown,key?:string)=>{deliveries++;keys.push(key!);return {ok:true as const,id:'fixture-only'};};
 await processMessage({data:{tenantId:f.foreignTenant,messageId:message.id},attemptsMade:0},send);assert.equal(deliveries,0);
 await processMessage({data:{tenantId:f.primary,messageId:message.id},attemptsMade:0},send);await processMessage({data:{tenantId:f.primary,messageId:message.id},attemptsMade:1},send);assert.equal(deliveries,1);assert.equal(keys[0],'stanza-message-'+message.id);
 assert.equal((await f.db.query('SELECT count(*)::int n FROM communication_message_events WHERE message_id=$1 AND status=\'sent\'',[message.id])).rows[0].n,1);
 console.log('PASS real message processor foreign tenant denied, successful replay no duplicate delivery/events and stable provider key');
 // Deterministic duplicate-delivery window: both consumers enter provider after separate committed claims.
 const duplicate=(await f.ok(f.admin,'/api/hiring/applicants/'+candidate.id+'/message',{subject:'Concurrent fixture',body:marker})).message;await f.db.query("UPDATE communication_messages SET status='queued' WHERE id=$1",[duplicate.id]);
 let release!:()=>void,entered=0;const gate=new Promise<void>(r=>release=r);const deduplicatedProvider=async()=>{entered++;if(entered===2)release();await gate;return {ok:true as const,id:'same-idempotent-provider-result'};};
 await Promise.all([processMessage({data:{tenantId:f.primary,messageId:duplicate.id},attemptsMade:0},deduplicatedProvider),processMessage({data:{tenantId:f.primary,messageId:duplicate.id},attemptsMade:0},deduplicatedProvider)]);
 assert.equal((await f.db.query("SELECT count(*)::int n FROM communication_message_events WHERE message_id=$1 AND status='sent'",[duplicate.id])).rows[0].n,1,'concurrent idempotent delivery finalizes exactly once');
  assert.equal((await f.db.query("SELECT count(*)::int n FROM audit_logs WHERE tenant_id=$1 AND entity_id=$2 AND action='communications.email.sent'",[f.primary,duplicate.id])).rows[0].n,1);
 const stale=(await f.ok(f.admin,'/api/hiring/applicants/'+candidate.id+'/message',{subject:'Stale result fixture',body:marker})).message;await f.db.query("UPDATE communication_messages SET status='queued' WHERE id=$1",[stale.id]);
 let firstEntered!:()=>void,releaseStale!:()=>void;const enteredPromise=new Promise<void>(r=>firstEntered=r),staleGate=new Promise<void>(r=>releaseStale=r);
 const older=processMessage({data:{tenantId:f.primary,messageId:stale.id},attemptsMade:0},async()=>{firstEntered();await staleGate;return {ok:false as const,kind:'transient' as const,code:'PROVIDER_NETWORK_ERROR'};});
 await enteredPromise;await processMessage({data:{tenantId:f.primary,messageId:stale.id},attemptsMade:0},async()=>({ok:true as const,id:'fixture-confirmed'}));releaseStale();await older;
 assert.equal((await f.db.query('SELECT status FROM communication_messages WHERE id=$1',[stale.id])).rows[0].status,'sent');
 assert.equal((await f.db.query("SELECT count(*)::int n FROM communication_message_events WHERE message_id=$1 AND status IN ('sent','queued')",[stale.id])).rows[0].n,1);
 console.log('PASS concurrent message replay creates one terminal event/audit; stale transient result cannot revert a confirmed delivery');
 assert(!logs.includes(marker)&&!logs.includes(f.password),'worker logs exclude sensitive fixture content');await healthy();console.log('PASS worker log privacy and foreground health');
}finally{
 for(const child of workers)await stop(child);await events.close();await queue.close();await f.cleanup();console.log('PASS owned workers stopped and fixture tenants cleaned; disposable database/Redis cleanup owned by outer runner');
}
