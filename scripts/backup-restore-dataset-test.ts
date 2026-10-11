import './router-env';
import assert from 'node:assert/strict';
import {readFile,writeFile,unlink} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {PDFDocument} from 'pdf-lib';
import {BusinessFixtures} from './business-scenario-fixtures';
import {getDbPool,getHrQueue,closeHrResources,withTenant} from '../src/lib/hr-background';
import {verifyTenantDatabase} from './tenant-database-checks';
import {spawnSync} from 'node:child_process';
const f=new BusinessFixtures(),mode=process.argv[2],manifest=process.env.RESTORE_MANIFEST!;
assert.match(new URL(process.env.DATABASE_URL!).pathname,/^\/stanza_restore_[a-f0-9]{16}_(source|target)$/);
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
try{
 if(mode==='create'){
  await f.setup('restore');const {admin,employee}=f;
  const location=(await f.db.query("INSERT INTO company_locations(tenant_id,name,latitude,longitude,boundary) VALUES($1,'Restore location',30,31,ST_Buffer(ST_SetSRID(ST_MakePoint(31,30),4326)::geography,1000)::geometry) RETURNING id",[f.primary])).rows[0];
  await f.ok(admin,'/api/roster/shifts',{employeeId:employee.id,startTime:new Date(Date.now()-3600000).toISOString(),endTime:new Date(Date.now()+3600000).toISOString()});await f.ok(employee,'/api/clock-in',{latitude:30,longitude:31});const clock=await f.ok(employee,'/api/clock-status');await f.ok(employee,'/api/clock-out',{latitude:30,longitude:31,confirmEarly:true,timeLogId:clock.timeLogId});
  const asset=await f.ok(admin,'/api/hr/assets',{assetTag:'RESTORE-'+f.tag,name:'Restore laptop',category:'laptop',condition:'good'});
  await f.ok(employee,'/api/me/leave-requests',{leaveType:'annual',startDate:'2030-02-01',endDate:'2030-02-02',reason:'Restore leave'});
  const grievance=(await f.ok(employee,'/api/grievances',{title:'Restore private case',description:'Owned restore marker'})).grievance;
  const pdf=await PDFDocument.create();pdf.addPage().drawText('STANZA OWNED RESTORE FILE');const bytes=Buffer.from(await pdf.save());
  const upload=await employee.context.request.post(f.base+`/api/grievances/${grievance.id}/attachments`,{headers:{Origin:f.base},multipart:{version:String(grievance.version),file:{name:'restore.pdf',mimeType:'application/pdf',buffer:bytes}}});assert.equal(upload.status(),200);const attachment=(await upload.json()).attachment;
  const file=(await f.db.query('SELECT storage_key FROM grievance_attachments WHERE id=$1',[attachment.id])).rows[0];
  await f.ok(admin,'/api/support',{issueType:'it_help',urgency:'normal',summary:'Restore Support',description:'Owned restore marker'});
  const job=(await f.ok(admin,'/api/hiring/jobs',{title:'Restore engineer',description:'Owned restore marker',managerId:admin.id,ownerId:admin.id,employmentType:'full_time',headcount:'1'})).job;await f.ok(admin,`/api/hiring/jobs/${job.id}/status`,{status:'open'});
  await f.ok(admin,'/api/company-feed/posts',{title:'Restore publication',contentText:'Owned restore publication',status:'published',visibility:[{type:'all'}]});
  await f.db.query("INSERT INTO router_semantic_examples(tenant_id,intent_key,example_text,normalized_text,embedding,embedding_model,embedding_dimensions,embedding_version,source,approval_state,approved_by) SELECT $1,intent_key,'Restore private example','restore private example',embedding,embedding_model,embedding_dimensions,embedding_version,'tenant','approved',$2 FROM router_semantic_examples WHERE tenant_id IS NULL LIMIT 1",[f.primary,admin.id]);
  const pending=(await f.db.query("SELECT count(*)::int n FROM outbox_events WHERE tenant_id=$1 AND event_type='background.hr' AND processed_at IS NULL",[f.primary])).rows[0].n;assert(pending>=4);
  await writeFile(manifest,JSON.stringify({tenant:f.primary,foreignTenant:f.foreignTenant,actors:f.actors.map(a=>({id:a.id,tenantId:a.tenantId,email:a.email,roleId:a.roleId})),password:f.password,employee:employee.id,location:location.id,grievance:grievance.id,attachment:attachment.id,fileKey:file.storage_key,fileHash:hash(bytes),job:job.id,publicToken:job.public_token,pending}));
  console.log('PASS owned representative dataset and private PDF created; pending durable events:',pending);
 }else{
  assert.equal(mode,'verify');const saved=JSON.parse(await readFile(manifest,'utf8'));const {chromium}=await import('node:module').then(m=>m.createRequire(import.meta.url)(process.env.BROWSER_PLAYWRIGHT_MODULE!));f.browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-gpu','--renderer-process-limit=2']});(f as any).password=saved.password;f.tenants.push(saved.tenant,saved.foreignTenant);f.primary=saved.tenant;f.foreignTenant=saved.foreignTenant;
  for(const a of saved.actors)await f.login(a.id,a.tenantId,a.email,a.roleId);[f.admin,f.employee,f.limited,f.foreign]=f.actors;f.publicContext=await f.browser.newContext();
  await verifyTenantDatabase(f);const test=spawnSync(process.execPath,['--import','tsx','scripts/runtime-role-test.ts'],{env:process.env,stdio:'inherit'});assert.equal(test.status,0);
  assert.equal((await f.ok(f.employee,'/api/clock-status')).isClockedIn,false);await f.ok(f.admin,'/api/hr/assets');await f.ok(f.admin,'/api/support');await f.ok(f.admin,'/api/hiring/jobs');const feed=await f.ok(f.employee,'/api/company-feed');assert(feed.posts.some((p:any)=>p.title==='Restore publication'));assert.equal((await f.publicContext.request.get(f.base+'/api/public/jobs/'+saved.publicToken)).status(),200);
  const url=f.base+`/api/grievances/${saved.grievance}/attachments/${saved.attachment}`;const download=await f.employee.context.request.get(url);assert.equal(download.status(),200);assert.equal(hash(await download.body()),saved.fileHash);assert.match(download.headers()['cache-control'],/no-store/);assert.equal((await f.foreign.context.request.get(url)).status(),404);assert.equal((await f.publicContext.request.get(url)).status(),401);
  const target=path.resolve(process.env.GRIEVANCE_ATTACHMENT_DIRECTORY!,saved.fileKey);assert(target.startsWith(path.resolve(process.env.GRIEVANCE_ATTACHMENT_DIRECTORY!)+path.sep));await unlink(target);const missing=await f.employee.context.request.get(url);assert(missing.status()>=400&&missing.status()<500);const body=await missing.text();assert(!/stack|ENOENT|SELECT |Error:/.test(body));assert(!body.includes(process.env.GRIEVANCE_ATTACHMENT_DIRECTORY!));assert.equal((await fetch(f.base+'/api/system/live')).status,200);await writeFile(target,await download.body());
  const semantic=(await f.ok(f.admin,'/api/command-router/resolve',{query:'where can I see what I got paid?',allowReasoning:false})).result;assert.equal(semantic.method,'semantic');assert.equal(semantic.fallbackUsed,false);
  let done=false;for(let i=0;i<100;i++){const n=(await f.db.query("SELECT count(*)::int n FROM outbox_events WHERE tenant_id=$1 AND event_type='background.hr' AND processed_at IS NULL",[f.primary])).rows[0].n;if(!n){done=true;break;}await new Promise(r=>setTimeout(r,150));}assert(done,'restored pending outbox recovers with empty Redis');
  const before=(await f.db.query('SELECT to_jsonb(s) row FROM attendance_daily_summaries s WHERE tenant_id=$1',[f.primary])).rows;assert(before.length);const auditBefore=(await f.db.query('SELECT count(*)::int n FROM audit_logs WHERE tenant_id=$1',[f.primary])).rows[0].n;
  const events=(await f.db.query("SELECT id,payload FROM outbox_events WHERE tenant_id=$1 AND event_type='background.hr'",[f.primary])).rows;const queue=getHrQueue();for(const event of events){const job=await queue.add(event.payload.name,{...event.payload.data,dispatchId:event.id},{jobId:'restore-replay-'+event.id});for(let i=0;i<100;i++){const state=await job.getState();if(state==='completed')break;assert.notEqual(state,'failed');await new Promise(r=>setTimeout(r,100));}assert.equal(await job.getState(),'completed');}
  const after=(await f.db.query('SELECT to_jsonb(s) row FROM attendance_daily_summaries s WHERE tenant_id=$1',[f.primary])).rows;for(const row of [...before,...after])delete row.row.updated_at;assert.deepEqual(after,before);assert.equal((await f.db.query('SELECT count(*)::int n FROM audit_logs WHERE tenant_id=$1',[f.primary])).rows[0].n,auditBefore);
  console.log('PASS restored login, modules, public job, private bytes/authorization, missing-file safe response, semantic routing, empty-Redis outbox recovery and duplicate rollup/audit delivery');
 }
}finally{await f.browser?.close();await f.db.end();await closeHrResources();}