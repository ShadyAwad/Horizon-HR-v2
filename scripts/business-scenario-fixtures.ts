import './router-env';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import bcrypt from 'bcryptjs';
import {getMigrationPool} from './migration-pool';
import {assertDatabaseMutationSafety,assertHttpMutationSafety} from './mutation-safety';
import {getDbPool,getHrQueue,closeHrResources} from '../src/lib/hr-background';
import {PrivateExtractionStorage} from '../src/server/document-extraction/extraction-storage';
import path from 'node:path';

export type ScenarioActor={id:string;tenantId:string;email:string;context:any;roleId:string};
/** Real preview, cookie sessions and restricted runtime paths. Admin connection is fixture setup/assertion/cleanup only. */
export class BusinessFixtures {
 readonly tag=randomUUID(); readonly password=randomBytes(24).toString('base64url');
 readonly db=getMigrationPool(); readonly tenants:string[]=[]; readonly actors:ScenarioActor[]=[];
 readonly base=assertHttpMutationSafety(process.env.BROWSER_BASE_URL||'http://localhost:3001','Business scenarios');
 browser:any; publicContext:any; permissions:string[]=[]; primary!:string; foreignTenant!:string;
 admin!:ScenarioActor; employee!:ScenarioActor; limited!:ScenarioActor; foreign!:ScenarioActor;
 async setup(label:string) {
  assertDatabaseMutationSafety(process.env.DATABASE_URL,'Business scenarios');
  const {chromium}=createRequire(import.meta.url)(process.env.BROWSER_PLAYWRIGHT_MODULE||'playwright');
  this.browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-gpu','--renderer-process-limit=2']});
  this.publicContext=await this.browser.newContext({serviceWorkers:'block'});
  await this.publicContext.addInitScript(()=>{localStorage.setItem('stanza-demo-notice-seen','true');localStorage.setItem('stanza.preferences.v1',JSON.stringify({tutorialsAutoStart:false,lanyardEnabled:false}));});
  for(const suffix of ['own','foreign'])this.tenants.push((await this.db.query('INSERT INTO tenants(slug,company_name) VALUES($1,$2) RETURNING id',[`business-${label}-${suffix}-${this.tag}`,'Disposable business scenario'])).rows[0].id);
  [this.primary,this.foreignTenant]=this.tenants;
  this.permissions=(await this.db.query('SELECT permission_key FROM tenant_permissions')).rows.map(r=>r.permission_key);
  this.admin=await this.person(this.primary,'Scenario Reviewer',this.permissions);
  const self=this.permissions.filter(k=>['attendance.clock','break_requests.create','break_requests.view_own','leave.create','leave.request.self','leave.view.self','leave.cancel.self','grievances.create','grievances.view_own','feed.read','organisation.view','communications.view'].includes(k));
  this.employee=await this.person(this.primary,'Scenario Employee',self,this.admin.id);
  this.limited=await this.person(this.primary,'Scenario Unrelated',['feed.read','organisation.view']);
  this.foreign=await this.person(this.foreignTenant,'Scenario Foreign',this.permissions);
  // Hiring's normal conversion assigns this existing system role; no new role semantics.
  const role=(await this.db.query("INSERT INTO tenant_roles(tenant_id,name,system_key,is_system) VALUES($1,'Employee','employee',true) RETURNING id",[this.primary])).rows[0].id;
  for(const key of self)await this.db.query('INSERT INTO tenant_role_permissions(tenant_id,role_id,permission_key) VALUES($1,$2,$3)',[this.primary,role,key]);
  const runtime=await getDbPool().query('SELECT current_user AS name');assert.equal(runtime.rows[0].name,'stanza_runtime');
 }
 async person(tenantId:string,name:string,keys:string[],managerId?:string):Promise<ScenarioActor> {
  const email=`business-${randomUUID()}@example.invalid`;
  const id=(await this.db.query("INSERT INTO employees(tenant_id,full_name,email,password_hash,role,manager_id) VALUES($1,$2,$3,$4,'employee',$5) RETURNING id",[tenantId,name,email,await bcrypt.hash(this.password,10),managerId??null])).rows[0].id;
  const roleId=(await this.db.query('INSERT INTO tenant_roles(tenant_id,name) VALUES($1,$2) RETURNING id',[tenantId,name])).rows[0].id;
  for(const key of keys)await this.db.query('INSERT INTO tenant_role_permissions(tenant_id,role_id,permission_key) VALUES($1,$2,$3)',[tenantId,roleId,key]);
  await this.db.query("INSERT INTO employee_role_assignments(tenant_id,employee_id,role_id,scope_type) VALUES($1,$2,$3,'company')",[tenantId,id,roleId]);
  return this.login(id,tenantId,email,roleId);
 }
 async login(id:string,tenantId:string,email:string,roleId=''):Promise<ScenarioActor> {
  const context=await this.browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
  await context.addInitScript(()=>{localStorage.setItem('stanza.preferences.v1',JSON.stringify({tutorialsAutoStart:false,lanyardEnabled:false}));localStorage.setItem('horizon-language','en');localStorage.setItem('stanza-demo-notice-seen','true');});
  const r=await context.request.post(this.base+'/api/auth/login',{headers:{Origin:this.base},data:{email,password:this.password}});
  assert.equal(r.status(),200,'normal fixture login');const user=(await r.json()).user;assert.equal(user.id,id);assert.equal(user.tenantId,tenantId);
  const actor={id,tenantId,email,context,roleId};this.actors.push(actor);return actor;
 }
 async api(actor:ScenarioActor|null,url:string,data?:unknown,method=data===undefined?'GET':'POST') {
  const context=actor?.context??this.publicContext;
  const r=await context.request.fetch(this.base+url,{method,headers:{Origin:this.base},...(data!==undefined?{data}:{} )});
  assert.match(r.headers()['content-type']??'',/application\/json/,'API must not fall through to SPA');
  return {status:r.status(),body:await r.json(),headers:r.headers()};
 }
 async ok(actor:ScenarioActor|null,url:string,data?:unknown,method?:string) {
  const r=await this.api(actor,url,data,method);assert(r.status>=200&&r.status<300,`${url}: ${r.status} ${JSON.stringify(r.body)}`);return r.body;
 }
 async page(actor:ScenarioActor,url='/') {
  const p=await actor.context.newPage();p.setDefaultTimeout(20000);await p.goto(this.base+url);return p;
 }
 async navigate(p:any,name:string) {
  await p.locator('[data-tutorial-target=stanza-launcher]').waitFor();
  await p.locator('[data-tutorial-target=stanza-launcher]').click();
  await p.locator('#stanza-navigation-panel .stanza-navigation-item').filter({hasText:name}).last().click();
 }
 async shot(p:any,label:string){await p.screenshot({path:path.join(process.env.TEMP!,`stanza-business-${label}.png`),fullPage:true});}
 async audit(actions:string[]) {
  const actual=(await this.db.query('SELECT DISTINCT action FROM audit_logs WHERE tenant_id=$1',[this.primary])).rows.map(r=>r.action);
  for(const action of actions)assert(actual.includes(action),'missing consequential audit '+action);
 }
 async cleanup() {
  await this.browser?.close();
  const queue=getHrQueue();
  for(const job of await queue.getJobs(['wait','delayed','completed','failed'],0,-1))if(this.tenants.includes(job.data?.tenantId))await job.remove();
  const store=new PrivateExtractionStorage(path.join(process.env.GRIEVANCE_ATTACHMENT_DIRECTORY||'uploads/private-grievances','hiring'),Infinity);
  for(const r of (await this.db.query('SELECT resume_key FROM hiring_applicants WHERE tenant_id=ANY($1::uuid[]) AND resume_key IS NOT NULL',[this.tenants])).rows)await store.remove(r.resume_key);
  for(const table of ['hiring_application_reviews','hiring_onboarding_template_applications','hiring_evaluations','hiring_interviews','hiring_offers','hiring_onboarding_tasks','hiring_onboarding_templates','support_tickets','asset_condition_reports','asset_assignments','assets','communication_messages','hiring_applicants','hiring_jobs','router_operational_metrics'])await this.db.query(`DELETE FROM ${table} WHERE tenant_id=ANY($1::uuid[])`,[this.tenants]);
  for(const id of this.tenants)await this.db.query('DELETE FROM tenants WHERE id=$1',[id]);
  assert.equal((await this.db.query('SELECT count(*)::int n FROM tenants WHERE id=ANY($1::uuid[])',[this.tenants])).rows[0].n,0);
  console.log('PASS owned business fixture tenants/records cleaned: zero');await this.db.end();await closeHrResources();
 }
}
