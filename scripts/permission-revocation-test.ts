import './router-env';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {BusinessFixtures,type ScenarioActor} from './business-scenario-fixtures';
import {getMigrationPool} from './migration-pool';
import {withTenant} from '../src/lib/hr-background';
const f=new BusinessFixtures();
const phase=process.env.PERMISSION_AUDIT_PHASE||'leave';
assert(['leave','core','services','hiring-baseline','hiring','auth-baseline'].includes(phase),'Unknown permission audit phase');
const tables=['user_webauthn_credentials','webauthn_challenges','communication_messages','communication_meetings','employees','tenant_roles','tenant_role_permissions','employee_role_assignments','assets','asset_assignments','support_tickets','support_ticket_events','leave_requests','leave_request_history','grievances','grievance_messages','grievance_case_events','hiring_jobs','hiring_interviews','communication_meeting_attendees','hiring_stage_history','hiring_applicants','hiring_applicant_notes','hiring_evaluations','hiring_offers','hiring_onboarding_tasks','company_feed_posts','company_feed_drafts','audit_logs','outbox_events','qr_access_tokens'];
async function snapshot(){const state:Record<string,unknown>={};for(const t of tables)state[t]=(await f.db.query(`SELECT to_jsonb(r) value FROM ${t} r WHERE tenant_id=ANY($1::uuid[]) ORDER BY to_jsonb(r)::text`,[f.tenants])).rows;return JSON.stringify(state);}
async function denied(actor:ScenarioActor,url:string,data?:unknown,method?:string){const before=await snapshot();const r=await f.api(actor,url,data,method);assert([403,404].includes(r.status),`${url} expected authorization denial; received ${r.status}`);assert.equal(await snapshot(),before,'denial must not change business/authority/audit/outbox records');return r;}
async function keys(actor:ScenarioActor,permissionKeys:string[]){await f.ok(f.admin,`/api/hr/organisation/roles/${actor.roleId}/permissions`,{permissionKeys},'PUT');}
try{
 await f.setup('permission-'+phase);
 if(phase==='core'){
  const one=await f.person(f.primary,'One permission actor',[]);
  const role=(await f.ok(f.admin,'/api/hr/organisation/roles',{name:'Platform Admin Owner - read only'})).role;
  one.roleId=role.id;await keys(one,['assets.view']);
  const assignment=(await f.ok(f.admin,`/api/hr/organisation/employees/${one.id}/roles`,{roleId:role.id,scopeType:'company'})).assignment;
  const asset=(await f.ok(f.admin,'/api/hr/assets',{assetTag:'PERM-'+f.tag,name:'Owned permission asset',category:'laptop'})).asset;
  assert((await f.ok(one,'/api/hr/assets')).assets.some((a:any)=>a.id===asset.id));
  const leave=(await f.ok(f.employee,'/api/me/leave-requests',{leaveType:'annual',startDate:'2034-05-02',endDate:'2034-05-02',reason:'Owned audit'})).request;
  const grievance=(await f.ok(f.employee,'/api/grievances',{title:'Owned permission case',description:'Disposable privacy fixture',confidentiality:'confidential'})).grievance;
  const ticket=(await f.ok(f.employee,'/api/support',{issueType:'it_help',urgency:'normal',summary:'Owned audit ticket',description:'Disposable request'})).ticket;
  const candidate=(await f.ok(f.admin,'/api/hiring/applicants',{fullName:'Owned audit candidate',positionTitle:'Fixture'})).applicant;
  const post=(await f.ok(f.admin,'/api/company-feed/posts',{title:'Permission audit publication',contentText:'Owned fixture',visibility:[{type:'all'}]})).post;
  for(const [url,data,method] of [
   [`/api/employees/${f.employee.id}/title`,{jobTitle:'Unauthorized'},'PATCH'],
   [`/api/hr/organisation/employees/${f.employee.id}/reporting-line`,{managerId:one.id},'PATCH'],
   [`/api/hr/organisation/employees/${one.id}/roles`,{roleId:f.admin.roleId,scopeType:'company'},'POST'],
   ['/api/hr/organisation/roles',{name:'Escalated'},'POST'],
   [`/api/hr/leave-requests/${leave.requestId}/approve`,{expectedVersion:leave.version},'POST'],
   [`/api/grievances/${grievance.id}/status`,{version:grievance.version,status:'triaged'},'PATCH'],
   [`/api/support/${ticket.id}/comments`,{note:'Unauthorized internal',visibility:'internal'},'POST'],
   [`/api/hr/assets/${asset.id}/assign`,{employeeId:one.id},'POST'],
   [`/api/hiring/applicants/${candidate.id}/hire`,{confirmed:true},'POST'],
   [`/api/company-feed/posts/${post.id}/status`,{status:'archived'},'PATCH'],
   ['/api/semantic-intelligence/platform/corpus',undefined,'GET']
  ] as const)await denied(one,url,data,method);
  const privilege={permissions:f.permissions,role:'hr_admin',is_admin:true,platform_admin:true,can_review:true,can_publish:true};
  await denied(one,`/api/employees/${f.employee.id}/title`,{jobTitle:'Unauthorized',...privilege},'PATCH');
  const strict=await f.api(f.admin,`/api/hr/organisation/employees/${one.id}/roles`,{roleId:role.id,scopeType:'company',...privilege});assert.equal(strict.status,400);
  const platform=await f.api(f.admin,`/api/hr/organisation/roles/${role.id}/permissions`,{permissionKeys:['platform.semantic.view_all']},'PUT');assert.equal(platform.status,403);
  await denied(f.admin,'/api/semantic-intelligence/platform/corpus');
  // Three independent actions, then remove only the write action.
  const multi=await f.person(f.primary,'Explicit multi permission actor',['assets.view','assets.manage','feed.read','feed.publish']);
  await f.ok(multi,'/api/hr/assets');await f.ok(multi,`/api/hr/assets/${asset.id}`,{name:'Granted asset edit'},'PATCH');await f.ok(multi,`/api/company-feed/posts/${post.id}/status`,{status:'published'},'PATCH');
  const session=await multi.context.cookies();await keys(multi,['assets.view','feed.read','feed.publish']);
  await f.ok(multi,'/api/hr/assets');await denied(multi,`/api/hr/assets/${asset.id}`,{name:'Revoked edit'},'PATCH');await f.ok(multi,`/api/company-feed/posts/${post.id}/status`,{status:'published'},'PATCH');assert.deepEqual(await multi.context.cookies(),session);
  // Role assignment revocation/switch uses normal administration, preserving the cookie.
  await f.ok(f.admin,`/api/hr/organisation/role-assignments/${assignment.assignmentId}/revoke`,{});assert.equal((await f.api(one,'/api/hr/assets')).status,401,'assignment revocation invalidates the session');
  await f.ok(f.admin,`/api/hr/organisation/employees/${one.id}/roles`,{roleId:role.id,scopeType:'company'});one.context=(await f.login(one.id,one.tenantId,one.email,one.roleId)).context;await f.ok(one,'/api/hr/assets');
  const before=(await f.db.query('SELECT role FROM employees WHERE tenant_id=$1 AND id=$2',[f.primary,one.id])).rows[0].role;assert.equal(before,'employee');
  // Auth methods are self scoped; forged actor input cannot choose another account.
  const options=await f.ok(one,'/api/auth/passkeys/register/options',{employeeId:f.employee.id,tenantId:f.primary});assert(options.options.challenge);
  assert.equal((await f.db.query("SELECT count(*)::int n FROM webauthn_challenges WHERE tenant_id=$1 AND employee_id=$2 AND challenge_type='registration'",[f.primary,one.id])).rows[0].n,1);
  assert.equal((await f.db.query('SELECT count(*)::int n FROM webauthn_challenges WHERE tenant_id=$1 AND employee_id=$2',[f.primary,f.employee.id])).rows[0].n,0);
  const foreignState=await snapshot();const foreignAssignment=await f.api(f.admin,`/api/hr/organisation/employees/${f.foreign.id}/roles`,{roleId:role.id,scopeType:'company'});assert.equal(foreignAssignment.status,400);assert.equal(await snapshot(),foreignState);
  await withTenant(f.primary,async c=>{const runtime=(await c.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];assert.equal(runtime.rolsuper,false);assert.equal(runtime.rolbypassrls,false);assert.equal((await c.query('SELECT count(*)::int n FROM employee_role_assignments WHERE tenant_id=$1',[f.foreignTenant])).rows[0].n,0);assert((await c.query('SELECT count(*)::int n FROM employee_role_assignments WHERE tenant_id=$1',[f.primary])).rows[0].n>0);});
  const changeAudits=(await f.db.query("SELECT actor_employee_id FROM audit_logs WHERE tenant_id=$1 AND action IN('organisation.role.created','organisation.role.permissions_updated','organisation.role.assigned','organisation.role.revoked')",[f.primary])).rows;assert(changeAudits.length>0);assert(changeAudits.every(r=>r.actor_employee_id===f.admin.id),'role audit actor must be authoritative');
  await denied(one,'/api/hr/audit-events');await f.audit(['organisation.role.created','organisation.role.permissions_updated','organisation.role.assigned','organisation.role.revoked']);
  console.log('PASS narrow custom role, explicit A/B/C permissions, remove only B, same-cookie role revoke/restore, forged privileges, platform names, People/roles and self-scoped auth methods');
  // Keep the actual publication control mounted while a separate admin request revokes it.
  const page=await f.page(multi);await f.navigate(page,'Company Feed');const management=page.locator('.company-feed-management');await management.locator('summary').click();
  const select=management.locator('div').filter({has:page.getByText(post.title,{exact:true})}).filter({has:page.getByRole('combobox',{name:'Publication status',exact:true})}).last().getByRole('combobox',{name:'Publication status',exact:true});await select.waitFor();
  await keys(multi,['assets.view','feed.read']);const response=page.waitForResponse((r:any)=>new URL(r.url()).pathname===`/api/company-feed/posts/${post.id}/status`&&r.request().method()==='PATCH');await select.selectOption('archived');assert.equal((await response).status(),403);
  assert.equal((await f.db.query('SELECT status FROM company_feed_posts WHERE tenant_id=$1 AND id=$2',[f.primary,post.id])).rows[0].status,'published');
  await denied(multi,`/api/company-feed/posts/${post.id}/status`,{status:'archived'},'PATCH');await f.ok(multi,'/api/company-feed');
  const ownWrite=await f.ok(f.admin,`/api/hr/assets/${asset.id}`,{name:'Admin tenant authority'},'PATCH');assert(ownWrite.success);
  // The inventory widget calls the same protected API; persisted widget layout is not authority.
  await keys(multi,['feed.read']);await denied(multi,'/api/hr/assets');
  console.log('PASS stale live publication control receives403 after revocation, reader remains valid, inventory-widget data API denied after read revocation');
 }
 if(phase==='services'){
  const reviewKeys=['grievances.review','grievances.confidential','grievances.triage','grievances.internal_notes'];
  const reviewer=await f.person(f.primary,'Scoped case handler',reviewKeys);
  let g=(await f.ok(f.employee,'/api/grievances',{title:'Disposable confidential case',description:'Permission audit only',confidentiality:'confidential'})).grievance;
  await denied(f.employee,`/api/grievances/${g.id}/status`,{version:g.version,status:'triaged'},'PATCH');
  await denied(f.employee,`/api/grievances/${g.id}/messages`,{version:g.version,kind:'internal',body:'Unauthorized internal'});
  await denied(f.limited,`/api/grievances/${g.id}`);
  g=(await f.ok(reviewer,`/api/grievances/${g.id}/status`,{version:g.version,status:'triaged'},'PATCH')).grievance;
  await f.ok(reviewer,`/api/grievances/${g.id}/messages`,{version:g.version,kind:'internal',body:'OWNED-PRIVATE-INTERNAL'});g=(await f.ok(reviewer,`/api/grievances/${g.id}`)).grievance;
  assert(!JSON.stringify(await f.ok(f.employee,`/api/grievances/${g.id}`)).includes('OWNED-PRIVATE-INTERNAL'));
  await keys(reviewer,reviewKeys.filter(k=>k!=='grievances.review'));
  await denied(reviewer,`/api/grievances/${g.id}`);await denied(reviewer,`/api/grievances/${g.id}/messages`,{version:g.version,kind:'internal',body:'Revoked internal'});await denied(reviewer,`/api/grievances/${g.id}/status`,{version:g.version,status:'in_progress'},'PATCH');
  await keys(reviewer,reviewKeys.filter(k=>k!=='grievances.internal_notes'));await f.ok(reviewer,`/api/grievances/${g.id}`);await denied(reviewer,`/api/grievances/${g.id}/messages`,{version:g.version,kind:'internal',body:'Write grant removed'});
  console.log('PASS confidential review/access revocation, separate internal-note write permission, reporter privacy and no false business/audit/outbox writes');
  const tech=await f.person(f.primary,'Disposable technician',['support.view','support.manage']);
  const ticket=(await f.ok(f.employee,'/api/support',{issueType:'it_help',urgency:'normal',summary:'Disposable support audit',description:'Owned requester'})).ticket;
  await f.ok(tech,`/api/support/${ticket.id}/update`,{status:'in_progress',assignedTo:tech.id});await f.ok(tech,`/api/support/${ticket.id}/comments`,{note:'OWNED-PRIVATE-SUPPORT',visibility:'internal'});
  await denied(f.employee,`/api/support/${ticket.id}/comments`,{note:'Not a technician',visibility:'internal'});assert(!JSON.stringify(await f.ok(f.employee,`/api/support/${ticket.id}`)).includes('OWNED-PRIVATE-SUPPORT'));
  await keys(tech,['support.view']);const detail=await f.ok(tech,`/api/support/${ticket.id}`);assert.equal(detail.canInternal,false);assert(!JSON.stringify(detail).includes('OWNED-PRIVATE-SUPPORT'));
  await denied(tech,`/api/support/${ticket.id}/comments`,{note:'Revoked technician',visibility:'internal'});await denied(tech,`/api/support/${ticket.id}/update`,{status:'resolved',note:'Revoked resolution'});
  assert.equal((await f.api(f.admin,`/api/hr/organisation/roles/${tech.roleId}/permissions`,{permissionKeys:['support.view','support.manage']},'PUT')).status,403,'protected provisioning must not become public custom-role grant');await f.db.query('INSERT INTO tenant_role_permissions(tenant_id,role_id,permission_key) VALUES($1,$2,$3)',[f.primary,tech.roleId,'support.manage']);await f.ok(tech,`/api/support/${ticket.id}/update`,{status:'resolved',note:'Authorized resolution'});await f.ok(tech,`/api/support/${ticket.id}/update`,{status:'in_progress',note:'Authorized reopen'});
  await keys(tech,[]);await denied(tech,'/api/support?queue=true');await f.ok(f.employee,`/api/support/${ticket.id}/comments`,{note:'Requester reply remains valid',visibility:'requester'});
  console.log('PASS technician assignment/internal/status/resolution/reopen revocation; requester reply remains separate from internal history');
  const assetKeys=['assets.view','assets.manage','assets.assign','assets.return','qr.asset_label.manage','qr.tokens.revoke'];
  const equipment=await f.person(f.primary,'Disposable equipment administrator',assetKeys);
  const asset=(await f.ok(equipment,'/api/hr/assets',{assetTag:'REV-'+f.tag,name:'Disposable equipment',category:'laptop'})).asset;
  await f.ok(equipment,`/api/hr/assets/${asset.id}`,{name:'Authorized edit'},'PATCH');await f.ok(equipment,`/api/hr/assets/${asset.id}/assign`,{employeeId:f.employee.id});await f.ok(equipment,`/api/hr/assets/${asset.id}/report-condition`,{condition:'damaged',notes:'Owned report'});
  await f.ok(equipment,'/api/qr/tokens',{purpose:'asset_lookup',subjectId:asset.id});
  const query='what laptop is Scenario Employee using?';const recognized=(await f.ok(equipment,'/api/command-router/resolve',{query,allowReasoning:false})).result;assert.equal(recognized.outcome,'matched');assert.equal(recognized.fallbackUsed,false);
  await keys(equipment,['assets.view']);await f.ok(equipment,`/api/hr/assets/${asset.id}`);
  for(const [suffix,data,method] of [['',{name:'Revoked write'},'PATCH'],['/assign',{employeeId:f.limited.id},'POST'],['/return',{},'POST'],['/report-condition',{condition:'good'},'POST']] as const)await denied(equipment,`/api/hr/assets/${asset.id}${suffix}`,data,method);
  await denied(equipment,'/api/qr/tokens',{purpose:'asset_lookup',subjectId:asset.id});
  await keys(equipment,[]);await denied(equipment,'/api/hr/assets');const revoked=(await f.ok(equipment,'/api/command-router/resolve',{query,allowReasoning:false})).result;assert.notEqual(revoked.outcome,'matched');assert.equal(revoked.fallbackUsed,false);assert(!JSON.stringify(revoked).includes(asset.id));
  console.log('PASS asset create/edit/assignment/return/condition/QR separation and revoked inventory-widget API; same frozen recognized router query loses authorization immediately');
 }
 if(phase==='hiring'){
  const grants=['hiring.view','hiring.view_notes','hiring.add_notes','hiring.advance_stage','hiring.make_final_decision','hiring.archive','hiring.evaluate','hiring.manage_offers','hiring.hire','compensation.manage'];
  const actor=await f.person(f.primary,'Explicit Hiring operator',grants);
  // These provisioned fine-grained grants include nondelegatable keys. Public custom-role
  // provisioning remains protected; the fixture administrator can REMOVE existing rows only.
  const revoke=async(next:string[])=>{const current=(await f.db.query('SELECT permission_key FROM tenant_role_permissions WHERE tenant_id=$1 AND role_id=$2',[f.primary,actor.roleId])).rows.map(r=>r.permission_key);assert(next.every(k=>current.includes(k)),'revocation cannot add authority');await f.db.query('DELETE FROM tenant_role_permissions WHERE tenant_id=$1 AND role_id=$2 AND NOT(permission_key=ANY($3::text[]))',[f.primary,actor.roleId,next]);};
  const create=async(name:string)=>(await f.ok(f.admin,'/api/hiring/applicants',{fullName:name,positionTitle:'Disposable security fixture',email:`${name.replaceAll(' ','-')}-${f.tag}@example.invalid`})).applicant;
  const a=await create('Owned candidate');
  await f.ok(actor,`/api/hiring/applicants/${a.id}/notes`,{noteText:'OWNED-TEAM-NOTE',visibility:'hiring_team'});
  await f.ok(f.admin,`/api/hiring/applicants/${a.id}/notes`,{noteText:'OWNED-HR-NOTE',visibility:'hr_only'});
  const detail=JSON.stringify(await f.ok(actor,`/api/hiring/applicants/${a.id}`));assert(detail.includes('OWNED-TEAM-NOTE'));assert(!detail.includes('OWNED-HR-NOTE'));
  await revoke(grants.filter(k=>!['hiring.view_notes','hiring.add_notes'].includes(k)));
  assert(!JSON.stringify(await f.ok(actor,`/api/hiring/applicants/${a.id}`)).includes('OWNED-TEAM-NOTE'));
  await denied(actor,`/api/hiring/applicants/${a.id}/notes`,{noteText:'Revoked note'});
  const interview=(await f.ok(f.admin,`/api/hiring/applicants/${a.id}/interviews`,{startsAt:new Date(Date.now()+3600000).toISOString(),endsAt:new Date(Date.now()+7200000).toISOString(),timezone:'Africa/Cairo',location:'Owned fixture',attendeeIds:[actor.id],interviewType:'Technical'})).interview;
  const feedback={recommendation:'yes',score:'4',notes:'Owned evaluation'};
  await denied(f.employee,`/api/hiring/interviews/${interview.id}/evaluations`,feedback);
  await f.ok(actor,`/api/hiring/interviews/${interview.id}/evaluations`,feedback);
  const remaining=grants.filter(k=>!['hiring.view_notes','hiring.add_notes','hiring.evaluate'].includes(k));await revoke(remaining);
  await denied(actor,`/api/hiring/interviews/${interview.id}/evaluations`,feedback);
  for(const targetStage of ['screening','hr_review','hiring_manager_review','interview','final_review'])await f.ok(f.admin,`/api/hiring/applicants/${a.id}/stage`,{targetStage});
  await f.ok(actor,`/api/hiring/applicants/${a.id}/stage`,{targetStage:'offer'});
  const b=await create('Owned second candidate');
  for(const targetStage of ['screening','hr_review','hiring_manager_review','interview','final_review'])await f.ok(f.admin,`/api/hiring/applicants/${b.id}/stage`,{targetStage});
  await revoke(remaining.filter(k=>k!=='hiring.make_final_decision'));await denied(actor,`/api/hiring/applicants/${b.id}/stage`,{targetStage:'offer'});
  const dates={startDate:'2033-06-01',expiresOn:'2033-05-01'},terms={salary:'5000',currency:'EGP',...dates};
  const offer=(await f.ok(actor,`/api/hiring/applicants/${a.id}/offers`,terms)).offer;
  const revised=(await f.ok(actor,`/api/hiring/offers/${offer.id}/revise`,{version:1,...terms,salary:'5500'})).offer;
  const document=await actor.context.request.get(f.base+`/api/hiring/offers/${offer.id}/document`);assert.equal(document.status(),200);assert.match(document.headers()["content-type"],/application\/pdf/);
  await revoke(remaining.filter(k=>!['hiring.make_final_decision','hiring.manage_offers'].includes(k)));
  await denied(actor,`/api/hiring/applicants/${a.id}/offers`,terms);await denied(actor,`/api/hiring/offers/${offer.id}/revise`,{version:revised.version,...terms});await denied(actor,`/api/hiring/offers/${offer.id}/document`);await denied(actor,`/api/hiring/offers/${offer.id}/status`,{status:'withdrawn'});
  // Owned preconditions only: no candidate email is sent, and no public acceptance is fabricated as an API success.
  const job=(await f.ok(f.admin,'/api/hiring/jobs',{title:'Owned hire fixture',description:'Disposable',managerId:f.admin.id,ownerId:f.admin.id,employmentType:'full_time',headcount:'2'})).job;
  await f.ok(f.admin,`/api/hiring/jobs/${job.id}/status`,{status:'open'});
  await f.db.query('UPDATE hiring_applicants SET job_id=$3 WHERE tenant_id=$1 AND id=$2',[f.primary,a.id,job.id]);await f.db.query("UPDATE hiring_offers SET status='accepted' WHERE tenant_id=$1 AND id=$2",[f.primary,revised.id]);
  const hired=await f.ok(actor,`/api/hiring/applicants/${a.id}/hire`,{confirmed:true});assert(hired.employeeId);
  // The same successful, idempotent endpoint must still enforce permission on a subsequent request.
  await revoke(['hiring.view','hiring.archive','hiring.advance_stage','compensation.manage']);await denied(actor,`/api/hiring/applicants/${a.id}/hire`,{confirmed:true});
  await f.ok(actor,`/api/hiring/applicants/${b.id}/archive`,{});await revoke(['hiring.view','hiring.advance_stage','compensation.manage']);await denied(actor,`/api/hiring/applicants/${b.id}/archive`,{});
  await f.ok(actor,'/api/hiring/summary');await revoke(['hiring.advance_stage','compensation.manage']);await denied(actor,'/api/hiring/summary');await denied(actor,`/api/hiring/applicants/${a.id}`);
  console.log('PASS active-session Hiring notes/evaluation/final-decision/offer/revision/document/hire/archive/read revocation with authorized controls and unchanged denied business/audit/outbox state');
 }
 if(phase==='auth-baseline'){
  await f.db.query("UPDATE employees SET role='hr_admin' WHERE tenant_id=$1 AND id=$2",[f.primary,f.admin.id]);
  await denied(f.admin,'/api/semantic-intelligence/platform/corpus');
  await f.ok(f.admin,'/api/hr/organisation/roles',{name:'Owned audit evidence'});await f.ok(f.foreign,'/api/hr/organisation/roles',{name:'Foreign owned audit evidence'});
  for(const [script,prefix] of [['scripts/audit-test.ts','AUDIT'],['scripts/sessions-test.ts','SESSIONS']]){
   const env={...process.env,DEMO_PASSWORD:f.password,[prefix+'_TEST_BASE_URL']:f.base,[prefix+'_TEST_ADMIN_EMAIL']:f.admin.email,[prefix+'_TEST_MANAGER_EMAIL']:f.limited.email,[prefix+'_TEST_EMPLOYEE_EMAIL']:f.employee.email};
   const result=spawnSync(process.execPath,['--import','tsx',script],{env,stdio:'inherit',windowsHide:true});assert.equal(result.status,0,script+' with disposable actors');
  }
 }
 if(phase==='hiring-baseline'){
  await f.db.query("UPDATE employees SET role='hr_admin' WHERE tenant_id=$1 AND id=$2",[f.primary,f.admin.id]);
  const manager=await f.person(f.primary,'Owned Hiring manager',['hiring.view','hiring.assign','hiring.add_notes','hiring.view_notes','hiring.advance_stage']);await f.db.query("UPDATE employees SET role='manager' WHERE tenant_id=$1 AND id=$2",[f.primary,manager.id]);
  const r=spawnSync(process.execPath,['--import','tsx','scripts/hiring-integration-test.ts'],{env:{...process.env,HIRING_TEST_BASE_URL:f.base,HIRING_TEST_PASSWORD:f.password,HIRING_TEST_ADMIN_EMAIL:f.admin.email,HIRING_TEST_MANAGER_EMAIL:manager.email,HIRING_TEST_EMPLOYEE_EMAIL:f.employee.email},stdio:'inherit',windowsHide:true});assert.equal(r.status,0,'existing Hiring authorization with disposable login actors');
 }
 if(phase==='leave'){
  const reviewer=await f.person(f.primary,'Disposable leave reviewer',['leave.approve']);
  await f.ok(f.admin,`/api/hr/organisation/employees/${f.employee.id}/reporting-line`,{managerId:reviewer.id},'PATCH');
  const submit=async(day:string)=>(await f.ok(f.employee,'/api/me/leave-requests',{leaveType:'annual',startDate:day,endDate:day,reason:'Disposable permission audit'})).request;
  const first=await submit('2033-05-02');assert.equal((await f.db.query('SELECT approver_employee_id FROM leave_requests WHERE tenant_id=$1 AND id=$2',[f.primary,first.requestId])).rows[0].approver_employee_id,reviewer.id);
  await denied(f.employee,`/api/hr/leave-requests/${first.requestId}/approve`,{expectedVersion:first.version});
  await f.ok(reviewer,`/api/hr/leave-requests/${first.requestId}/approve`,{expectedVersion:first.version,note:'Authorized fixture decision'});
  const pending=await submit('2033-05-04');assert.equal((await f.db.query('SELECT approver_employee_id FROM leave_requests WHERE tenant_id=$1 AND id=$2',[f.primary,pending.requestId])).rows[0].approver_employee_id,reviewer.id);
  assert.equal((await f.ok(reviewer,`/api/hr/leave-requests/${pending.requestId}`)).request.canDecide,true);
  const cookieBefore=await reviewer.context.cookies();await keys(reviewer,[]);
  const deniedState=await snapshot();const response=await f.api(reviewer,`/api/hr/leave-requests/${pending.requestId}/approve`,{expectedVersion:pending.version,note:'Must not be authorized after revocation'});
  const state=(await f.db.query('SELECT status,approval_source FROM leave_requests WHERE tenant_id=$1 AND id=$2',[f.primary,pending.requestId])).rows[0];
  console.log('Active-session leave revocation:',JSON.stringify({status:response.status,persistedState:state}));
  assert([403,404].includes(response.status),'Revoked assigned approver must not retain decision authority');assert.equal(state.status,'pending');assert.equal(await snapshot(),deniedState);await denied(reviewer,`/api/hr/leave-requests/${pending.requestId}`);await denied(reviewer,`/api/hr/leave-requests/${pending.requestId}/reject`,{expectedVersion:pending.version});await keys(reviewer,['leave.approve']);await f.ok(reviewer,`/api/hr/leave-requests/${pending.requestId}/reject`,{expectedVersion:pending.version,note:'Authority restored'});assert.deepEqual(await reviewer.context.cookies(),cookieBefore);
  console.log('PASS leave own submission, self-review denial, authorized decision and active-session revocation');
 }
}finally{
 await f.cleanup();const db=getMigrationPool();try{for(const t of tables)assert.equal((await db.query(`SELECT count(*)::int n FROM ${t} WHERE tenant_id=ANY($1::uuid[])`,[f.tenants])).rows[0].n,0,t+' fixture cleanup');const ownedTables=(await db.query("SELECT c.table_name FROM information_schema.columns c JOIN information_schema.tables t USING(table_schema,table_name) WHERE c.table_schema='public' AND c.column_name='tenant_id' AND t.table_type='BASE TABLE'")).rows;for(const row of ownedTables){const name='"'+row.table_name.replaceAll('"','""')+'"';assert.equal((await db.query(`SELECT count(*)::int n FROM ${name} WHERE tenant_id=ANY($1::uuid[])`,[f.tenants])).rows[0].n,0,row.table_name+' owned cleanup');}
}finally{await db.end();}console.log('PASS owned permission fixtures/roles/assignments/sessions/all tenant records removed');
}