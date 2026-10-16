import assert from 'node:assert/strict';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {BusinessFixtures,type ScenarioActor} from './business-scenario-fixtures';
const f=new BusinessFixtures(),t=process.env.DEMO_TENANT_ID!,sessions:string[]=[],owned:{table:string;id:string}[]=[],contexts:any[]=[];
assert(t,'DEMO_TENANT_ID required');
async function persona(label:string,email:string,width=1440,sw=false){
 const context=await f.browser.newContext({viewport:{width,height:950},serviceWorkers:sw?'allow':'block'});contexts.push(context);
 await context.addInitScript(()=>{localStorage.setItem('stanza-demo-notice-seen','true');localStorage.setItem('horizon-language','en');localStorage.setItem('stanza.preferences.v1',JSON.stringify({tutorialsAutoStart:false,lanyardEnabled:false}));});
 const p=await context.newPage();p.setDefaultTimeout(20000);await p.goto(f.base);await p.getByRole('button',{name:/^Use Demo Account/}).click();if(process.env.DEMO_REVIEW_ARTIFACT_DIR){await p.waitForTimeout(250);}if(process.env.DEMO_REVIEW_ARTIFACT_DIR)await p.screenshot({path:path.join(process.env.DEMO_REVIEW_ARTIFACT_DIR,'login-'+width+'.png'),fullPage:true});await p.locator('#demo-account-panel button').filter({hasText:label}).click();await p.locator('[data-tutorial-target=stanza-launcher]').waitFor();
 const session=await context.request.get(f.base+'/api/auth/session');assert.equal(session.status(),200);const user=(await session.json()).user;assert.equal(user.tenantId,t);assert.equal(user.email,email);
 for(const cookie of await context.cookies())if(cookie.name==='stanza_session')sessions.push(createHash('sha256').update(cookie.value).digest('hex'));
 assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'horizontal overflow');
 return {p,actor:{context,id:user.id,tenantId:t,email,roleId:''} as ScenarioActor};
}
try{
 await f.setup('demo-public');
 const rows=(await f.db.query("SELECT id,email FROM employees WHERE tenant_id=$1 AND email=ANY($2::text[])",[t,['admin@stanza-demo.com','manager@stanza-demo.com','employee@stanza-demo.com']])).rows;assert.equal(rows.length,3);
 const hr=await persona('HR / Hiring','admin@stanza-demo.com');
 for(const module of ['Workspace Composer','Organisation','Weekly Roster','Assets & Equipment','IT & equipment support','Hiring','Company Feed']){await f.navigate(hr.p,module);await hr.p.waitForTimeout(250);assert.equal(await hr.p.getByText('Internal Server Error',{exact:true}).count(),0);if(module==='Hiring'){await hr.p.getByLabel('Search candidates',{exact:true}).fill('Hana Nasser');await hr.p.getByText('Hana Nasser',{exact:true}).first().waitFor();}if(module==='IT & equipment support'){await hr.p.getByRole('button',{name:'Company support queue',exact:true}).click();await hr.p.getByText('Laptop docking station disconnects',{exact:true}).first().waitFor();}if(process.env.DEMO_REVIEW_ARTIFACT_DIR&&module==='Hiring')await hr.p.screenshot({path:path.join(process.env.DEMO_REVIEW_ARTIFACT_DIR,'hiring-1440.png'),fullPage:true});console.log('PASS HR module',module);}
 assert.equal((await f.api(hr.actor,'/api/hiring/applicants')).status,200);
 assert.equal((await f.api(hr.actor,'/api/hr/organisation/roles')).status,403);
 assert.equal((await f.api(hr.actor,'/api/semantic-intelligence/platform/overview')).status,403);
 assert.equal((await f.api(hr.actor,'/api/support?queue=true')).status,200);
 const candidate=await f.ok(hr.actor,'/api/hiring/applicants',{fullName:'Demo review '+f.tag,positionTitle:'Backend Engineer',email:'demo-review-'+f.tag+'@example.invalid',source:'Demo review'});owned.push({table:'hiring_applicants',id:candidate.applicant.id});
 const employee=await persona('Employee Demo','employee@stanza-demo.com',390,true);
 for(const module of ['Workspace Composer','Weekly Roster','Profile','Company Feed']){await f.navigate(employee.p,module);await employee.p.waitForTimeout(250);if(process.env.DEMO_REVIEW_ARTIFACT_DIR&&module==='Profile')await employee.p.screenshot({path:path.join(process.env.DEMO_REVIEW_ARTIFACT_DIR,'employee-390.png'),fullPage:true});console.log('PASS employee module at 390',module);}
 assert.equal((await f.api(employee.actor,'/api/hiring/applicants')).status,403);assert.equal((await f.api(employee.actor,'/api/support?queue=true')).status,403);
 await f.navigate(employee.p,'Profile');await employee.p.getByRole('button',{name:'Report damage / get IT help',exact:true}).first().click();const form=employee.p.getByRole('dialog');await form.getByRole('combobox').first().selectOption('it_help');await form.getByLabel('Short summary',{exact:true}).fill('Demo review '+f.tag);await form.getByLabel('Description',{exact:true}).fill('Fictional bounded review fixture');const saved=employee.p.waitForResponse((r:any)=>new URL(r.url()).pathname==='/api/support'&&r.request().method()==='POST');await form.getByRole('button',{name:'Submit request',exact:true}).click();const response=await saved;assert.equal(response.status(),201);const ticket=await response.json();owned.push({table:'support_tickets',id:ticket.ticket.id});
 const detail=await f.ok(employee.actor,'/api/support/'+ticket.ticket.id);assert(detail.history.every((r:any)=>r.visibility!=='internal'));
 assert.equal((await f.api(employee.actor,'/api/me/digital-badge')).status,200);const dock=(await f.db.query("SELECT id FROM support_tickets WHERE tenant_id=$1 AND summary='Laptop docking station disconnects'",[t])).rows[0];const ownDock=await f.ok(employee.actor,'/api/support/'+dock.id);assert(!JSON.stringify(ownDock).includes('Fictional technician checklist'));
 const manager=await persona('Manager Demo','manager@stanza-demo.com');
 for(const module of ['Workspace Composer','Weekly Roster','Company Feed']){await f.navigate(manager.p,module);await manager.p.waitForTimeout(250);console.log('PASS manager module',module);}
 assert.equal((await f.api(manager.actor,'/api/hiring/applicants')).status,403);
 const self=rows.find(r=>r.email==='employee@stanza-demo.com')!;const now=new Date(),monday=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()-((now.getUTCDay()+6)%7))).toISOString().slice(0,10);
 const goal=await f.ok(manager.actor,'/api/roster/goals',{employeeId:self.id,weekStart:monday,title:'Demo review '+f.tag,description:'Fictional review task',priority:'normal'});owned.push({table:'roster_goals',id:goal.goal.id});
 assert.equal((await f.api(manager.actor,'/api/roster/goals',{employeeId:f.foreign.id,weekStart:monday,title:'Foreign blocked',priority:'normal'})).status,404);
 assert.equal((await f.api(f.foreign,'/api/hiring/applicants/'+candidate.applicant.id)).status,404);
 const second=await persona('HR / Hiring','admin@stanza-demo.com');assert.equal((await f.api(second.actor,'/api/hiring/applicants/'+candidate.applicant.id)).status,200);
 const job=(await f.db.query("SELECT public_token FROM hiring_jobs WHERE tenant_id=$1 AND status='open' LIMIT 1",[t])).rows[0];assert(job);assert.equal((await f.api(null,'/api/public/jobs/'+job.public_token)).status,200);
 for(const [actor,query]of [[hr.actor,'open hiring'],[employee.actor,'where can I see what I got paid?']] as const){const r=await f.ok(actor,'/api/command-router/resolve',{query,allowReasoning:false,learn:false,timeZone:'Africa/Cairo'});assert(!JSON.stringify(r).includes('"method":"llm"'));console.log('PASS local command query',query,JSON.stringify(r).slice(0,450));}
 await employee.p.evaluate(()=>navigator.serviceWorker.ready);await employee.p.waitForFunction(()=>!!navigator.serviceWorker.controller);
 assert.equal(await employee.p.evaluate(async()=>{for(const name of await caches.keys())for(const req of await(await caches.open(name)).keys())if(new URL(req.url).pathname.startsWith('/api/'))return false;return true;}),true);
 for(const item of [hr,manager,second,employee]){await f.ok(item.actor,'/api/auth/logout',{});assert.equal((await f.ok(item.actor,'/api/auth/session')).authenticated,false);assert.equal((await f.api(item.actor,'/api/hiring/applicants')).status,401);}
 await employee.actor.context.setOffline(true);await employee.p.reload();await employee.p.getByRole('button',{name:'Log In',exact:true}).waitFor();await employee.actor.context.setOffline(false);
 console.log('PASS three real public personas, bounded mutations, second reviewer, tenant denials, public job, active PWA/private-cache/logout-offline');
}finally{
 for(const context of contexts)for(const cookie of await context.cookies())if(cookie.name==='stanza_session')sessions.push(createHash('sha256').update(cookie.value).digest('hex'));
 for(const entry of owned.reverse()){if(entry.table==='hiring_applicants')await f.db.query('DELETE FROM outbox_events WHERE tenant_id=$1 AND payload->>\'applicantId\'=$2',[t,entry.id]);await f.db.query(`DELETE FROM ${entry.table} WHERE tenant_id=$1 AND id=$2`,[t,entry.id]);}
 await f.db.query('DELETE FROM auth_sessions WHERE tenant_id=$1 AND session_token_hash=ANY($2::text[])',[t,sessions]);
 await f.db.query("DELETE FROM audit_logs WHERE tenant_id=$1 AND (entity_id=ANY($2::uuid[]) OR metadata::text LIKE $3)",[t,owned.map(r=>r.id),'%'+f.tag+'%']);
 await f.cleanup();console.log('PASS only task demo mutations/sessions and disposable foreign tenants removed');
}



