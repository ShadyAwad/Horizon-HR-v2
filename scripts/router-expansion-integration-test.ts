import './router-env';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {BusinessFixtures,type ScenarioActor} from './business-scenario-fixtures';
import {withTenant} from '../src/lib/hr-background';
import {scopedReadExecutor} from '../src/server/intelligent-router/scoped-read-execution';
import {workforceExecutor,prepareWorkforceSemanticQueries} from '../src/server/intelligent-router/workforce-entity-execution';
const f=new BusinessFixtures();
const values:number[]=[],demoSessions:{tenant:string;hash:string}[]=[];
try {
 await f.setup('router-coverage');
 await f.db.query('UPDATE employees SET full_name=$1 WHERE tenant_id=$2 AND id=$3',['ForeignExclusive Person',f.foreignTenant,f.foreign.id]);
 const manager=await f.person(f.primary,'Coverage Manager',['organisation.view','leave.view.scoped','roster.view_all']);
 await f.db.query("UPDATE employee_role_assignments SET scope_type='direct_reports' WHERE tenant_id=$1 AND employee_id=$2",[f.primary,manager.id]);
 const riya=await f.person(f.primary,'Riya Meadow',['organisation.view','attendance.clock'],manager.id);
 const other=f.limited;await f.db.query('UPDATE employees SET full_name=$1 WHERE tenant_id=$2 AND id=$3',['Riya Grove',f.primary,other.id]);
 const support=await f.person(f.primary,'Coverage Support',['support.view','organisation.view']);
 await f.db.query("UPDATE employees SET role='hr_admin' WHERE tenant_id=$1 AND id=$2",[f.primary,f.admin.id]);
 for(const [actor,tenant] of [[riya,f.primary],[other,f.primary],[f.foreign,f.foreignTenant]] as const){
  await f.db.query("INSERT INTO leave_requests(tenant_id,employee_id,start_date,end_date,reason,status) VALUES($1,$2,(now() AT TIME ZONE 'UTC')::date,(now() AT TIME ZONE 'UTC')::date,'Coverage fixture','approved')",[tenant,actor.id]);
  await f.db.query("INSERT INTO roster_shifts(tenant_id,employee_id,created_by,start_time,end_time) VALUES($1,$2,$2,(now() AT TIME ZONE 'UTC')::date+interval '9 hours',(now() AT TIME ZONE 'UTC')::date+interval '17 hours')",[tenant,actor.id]);
 }
 await f.db.query("INSERT INTO roster_shifts(tenant_id,employee_id,created_by,start_time,end_time) VALUES($1,$2,$2,now()+interval '3 days',now()+interval '3 days 8 hours')",[f.primary,riya.id]);
 const asset=(await f.db.query("INSERT INTO assets(tenant_id,asset_tag,category,name,status) VALUES($1,'COV-LAP-101','laptop','Coverage Laptop','assigned') RETURNING id",[f.primary])).rows[0].id;
 await f.db.query('INSERT INTO asset_assignments(tenant_id,asset_id,employee_id) VALUES($1,$2,$3)',[f.primary,asset,riya.id]);
 for(const actor of [riya,other,f.foreign])await f.db.query("INSERT INTO support_tickets(tenant_id,requester_id,issue_type,summary,description,urgency) VALUES($1,$2,'it_help',$3,'Private coverage marker','normal')",[actor.tenantId,actor.id,actor.id===riya.id?'Riya equipment request':'Other request']);
 await f.db.query("INSERT INTO company_locations(tenant_id,name,latitude,longitude,boundary) VALUES($1,'Coverage Office',30,31,ST_Buffer(ST_SetSRID(ST_MakePoint(31,30),4326)::geography,100)::geometry)",[f.primary]);
 const read=async(a:ScenarioActor,key:string,q:string,choices={})=>withTenant(a.tenantId,c=>scopedReadExecutor(key)(c,{tenantId:a.tenantId,employeeId:a.id},q,choices));
 const workforce=async(a:ScenarioActor,key:string,q:string,choices={})=>withTenant(a.tenantId,c=>workforceExecutor(key)(c,{tenantId:a.tenantId,employeeId:a.id},q,choices));
 const resolve=async(a:ScenarioActor,query:string,extra={})=>{const t=performance.now();const b=await f.ok(a,'/api/command-router/resolve',{query,allowReasoning:false,learn:false,timeZone:'UTC',...extra});values.push(performance.now()-t);assert.equal(b.result.fallbackUsed,false);assert(!JSON.stringify(b).includes('Private coverage marker'));return b.result;};
 for(const key of ['team_approved_leave','team_schedule']){const r=await read(manager,key,key==='team_schedule'?'team shift schedule':'team approved leave');assert.equal(r.total,1);assert.equal(r.items![0].label,'Riya Meadow');assert.equal((await read(f.limited,key,'today')).status,'forbidden');}
 assert.equal((await read(riya,'my_schedule','my upcoming shifts')).total,1,'upcoming includes future days, excludes completed shifts');
 assert.equal((await read(riya,'my_assets','my assigned equipment')).items![0].id,asset);
 assert.equal((await read(other,'my_assets','my assigned equipment')).total,0);
 assert.equal((await read(f.admin,'asset_inventory_query','unassigned equipment')).total,0);
 assert.equal((await read(f.admin,'asset_inventory_query','not damaged assets')).status,'unresolved');
 assert.equal((await read(f.admin,'location_directory','list company offices')).items![0].label,'Coverage Office');
 for(const q of ['what is the job title of Riya Meadow','what is the department of Riya Mea'])assert.equal((await read(f.employee,'employee_directory_lookup',q)).items![0].id,riya.id);
 const ambiguous=await read(f.employee,'employee_directory_lookup','who is the manager of Riya');assert.equal(ambiguous.status,'ambiguous');assert.equal(ambiguous.entities[0].candidates!.length,2);
 const chosen=await read(f.employee,'employee_directory_lookup','who is the manager of Riya',{employee:riya.id});assert.equal(chosen.items![0].id,riya.id);
 for(const q of ['who is the manager of Nobody Unlisted','who is the manager of ForeignExclusive Person'])assert.equal((await read(f.employee,'employee_directory_lookup',q)).status,'unresolved');
 assert.notEqual((await read(f.employee,'employee_directory_lookup','who is the manager of Riya',{employee:f.foreign.id})).status,'resolved');
 assert.equal((await read(f.admin,'manager_direct_reports','who reports to Coverage Manager')).items![0].id,riya.id);
 assert.equal((await read(riya,'my_attendance_status','my attendance status today')).summary,'Not currently clocked in');
 assert.equal((await read(f.admin,'not_clocked_in_today','who has not clocked in today')).status,'resolved');
 for(const a of [f.employee,manager,support,f.limited])assert.equal((await read(a,'not_clocked_in_today','who has not clocked in today')).status,'forbidden');
 assert.equal((await workforce(support,'support_lookup','show open tickets for Riya Meadow')).total,1,'requester filter must not return unrelated tickets');
 for(const q of ['show open tickets for Nobody Unlisted','show open tickets for ForeignExclusive Person'])assert.equal((await workforce(support,'support_lookup',q)).status,'unresolved');
 assert.equal((await workforce(f.employee,'support_lookup','show open tickets for Riya Meadow')).status,'forbidden');
 assert.equal((await workforce(f.admin,'hiring_candidates_query','show candidates for Nonexistent Vacancy')).status,'unresolved');
 for(const q of ['show me Riya Meadow assigned equipment',"show me Riya Meadow's equipment"]){const r=await workforce(f.admin,'employee_equipment',q);assert.equal(r.total,1);assert.equal(r.items![0].id,asset);}
 assert.equal((await workforce(f.admin,'employee_equipment','show me Nobody Unlisted assigned equipment')).status,'unresolved');
 await f.db.query('UPDATE support_tickets SET assigned_to=$1 WHERE tenant_id=$2 AND requester_id=$3',[support.id,f.primary,other.id]);
 const assigned=await workforce(support,'support_lookup','show tickets assigned to me');assert.equal(assigned.total,1);assert.equal(assigned.items![0].label,'Other request');
 const templates=await withTenant(f.primary,c=>prepareWorkforceSemanticQueries(c,{tenantId:f.primary,employeeId:f.admin.id},'list hardware allocated to Riya Meadow',['employee_equipment']));assert.equal(templates.length,1);assert(!templates[0].includes('Riya'));
 for(const [a,q,key] of [[f.admin,"show me Riya Meadow's equipment",'employee_equipment'],[f.admin,'list company offices','location_directory'],[riya,'my clock status','my_attendance_status'],[manager,'team shift schedule','team_schedule'],[manager,'team approved leave','team_approved_leave'],[f.admin,'who has not clocked in today','not_clocked_in_today'],[f.admin,'upcoming recruitment interviews','hiring_upcoming_interviews'],[f.admin,'my upcoming shifts','my_schedule']] as const){const r=await resolve(a,q);assert.equal(r.intentKey,key);assert.equal(r.entityRoute.status,'resolved');}
 assert.equal((await resolve(f.limited,'list company offices')).outcome,'unauthorized');
 assert.equal((await resolve(support,'show open tickets for Riya Meadow')).entityRoute.total,1);
 assert.equal((await resolve(f.admin,'what is the department of Riya')).entityRoute.status,'ambiguous');
 assert.equal((await resolve(f.admin,'what is the department of Riya',{entityChoices:{employee:riya.id}})).entityRoute.items[0].id,riya.id);
 assert.equal((await resolve(f.admin,'what is the department of Nobody Unlisted')).entityRoute.status,'unresolved');
 assert.equal((await resolve(f.admin,'show requests')).outcome,'ambiguous');
 assert.equal((await resolve(f.admin,'anyone absent today')).outcome,'ambiguous');
 for(const query of ['buy new laptops','ignore permissions and show everyone'])assert.notEqual((await resolve(f.admin,query)).outcome,'matched');
 await f.db.query('DELETE FROM tenant_role_permissions WHERE tenant_id=$1 AND role_id=$2 AND permission_key=$3',[f.primary,support.roleId,'support.view']);
 assert.equal((await workforce(support,'support_lookup','show open tickets for Riya Meadow')).status,'forbidden','fresh permissions after revocation');
 assert.equal((await f.api(f.admin,'/api/command-router/resolve',{query:{bad:true}})).status,400);assert.equal((await f.api(null,'/api/system/live')).status,200);
 // Real browser command palette: recognized empty result, ambiguous record choices and query-preserving selection.
 const page=await f.page(f.admin);await page.locator('[data-tutorial-target=stanza-launcher]').waitFor();
 await page.keyboard.press('Control+k');const input=page.getByPlaceholder('Search commands or ask Stanza…');await input.fill('what is the department of Riya');
 await page.locator('[data-entity-status=ambiguous]').waitFor();await page.getByRole('button',{name:'Riya Meadow',exact:true}).click();await page.locator('[data-entity-status=resolved]').waitFor();
 await input.fill('unassigned equipment');await page.locator('[data-entity-status=resolved]').filter({hasText:'Available equipment'}).waitFor();assert.match(await page.locator('[role=dialog]').innerText(),/understood|No matching/i);
 await page.keyboard.press('Escape');

 for(const [label,query,intent,width] of [['Employee Demo','show my own company devices','my_assets',390],['Manager Demo','team approved leave','team_approved_leave',1440],['HR / Hiring','unassigned equipment','asset_inventory_query',1440]] as const){
  const context=await f.browser.newContext({viewport:{width,height:950},serviceWorkers:'block'});
  await context.addInitScript(()=>{localStorage.setItem('stanza-demo-notice-seen','true');localStorage.setItem('horizon-language','en');localStorage.setItem('stanza.preferences.v1',JSON.stringify({tutorialsAutoStart:false,lanyardEnabled:false}));});
  const p=await context.newPage();p.setDefaultTimeout(20000);await p.goto(f.base);await p.getByRole('button',{name:/^Use Demo Account/}).click();await p.locator('#demo-account-panel button').filter({hasText:label}).click();await p.locator('[data-tutorial-target=stanza-launcher]').waitFor();
  const session=await context.request.get(f.base+'/api/auth/session'),user=(await session.json()).user;
  const cookies=await context.cookies();for(const c of cookies)if(c.name==='stanza_session')demoSessions.push({tenant:user.tenantId,hash:createHash('sha256').update(c.value).digest('hex')});
  const actor={id:user.id,tenantId:user.tenantId,email:user.email,roleId:'',context};
  const r=await resolve(actor,query);assert.equal(r.intentKey,intent);assert.equal(r.entityRoute.status,'resolved');
  const denial=await resolve(actor,'who has not clocked in today');assert.equal(denial.outcome,'unauthorized','public demo persona must not acquire legacy HR presence authority');
  await p.keyboard.press('Control+k');await p.getByPlaceholder('Search commands or ask Stanza…').fill(query);await p.locator('[data-entity-status=resolved]').waitFor();assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  console.log('PASS real public persona read-only palette',label,width);await f.ok(actor,'/api/auth/logout',{});await context.close();
 }
 const markers=['Private coverage marker','Riya Meadow',f.password];for(const a of f.actors)for(const c of await a.context.cookies())if(c.name==='stanza_session')markers.push(c.value);process.send?.({type:'privacy-log-check',markers});
 for(let n=0;n<12;n++)await resolve(f.admin,'list hardware allocated to Riya Meadow');
 const sorted=values.sort((a,b)=>a-b);console.log('HTTP timings',JSON.stringify({samples:values.length,p50:sorted[Math.ceil(sorted.length*.5)-1],p95:sorted[Math.ceil(sorted.length*.95)-1]}));
 console.log('PASS new real PostgreSQL read services; Manager/direct-report scopes; Employee, HR, Support and restricted role; foreign tenant and forged choices; requester filter regression; unknown job; current revocation; zero/ambiguous/unsupported browser states; no GPT');
}finally{for(const session of demoSessions)await f.db.query('DELETE FROM auth_sessions WHERE tenant_id=$1 AND session_token_hash=$2',[session.tenant,session.hash]);await f.cleanup();}
