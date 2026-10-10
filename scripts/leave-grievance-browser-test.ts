import './router-env';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import bcrypt from 'bcryptjs';
import { getMigrationPool } from './migration-pool';
import { assertDatabaseMutationSafety, assertHttpMutationSafety } from './mutation-safety';
const base = assertHttpMutationSafety(process.env.BROWSER_BASE_URL || 'http://localhost:3001', 'Leave/grievance browser');
assertDatabaseMutationSafety(process.env.DATABASE_URL, 'Leave/grievance browser');
const { chromium } = createRequire(import.meta.url)(process.env.BROWSER_PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless:true, channel:'msedge', args:process.env.BROWSER_RESOURCE_LIMIT === 'true' ? ['--disable-gpu', '--renderer-process-limit=2', '--js-flags=--max-old-space-size=256'] : [] }), db = getMigrationPool();
const tag = randomUUID(), password = randomBytes(24).toString('base64url'), tenants:string[] = [];
try {
 async function tenant(label:string) { const id=(await db.query('INSERT INTO tenants(slug,company_name) VALUES($1,$2) RETURNING id',['workflow-polish-'+label+'-'+tag,'Workflow fixture'])).rows[0].id; tenants.push(id); return id; }
 const own=await tenant('own'), foreign=await tenant('foreign');
 const all=(await db.query('SELECT permission_key FROM tenant_permissions')).rows.map(r=>r.permission_key);
 async function actor(tenantId:string,name:string,keys:string[]) {
  const email='workflow-'+name+'-'+tag+'@example.invalid';
  const id=(await db.query("INSERT INTO employees(tenant_id,full_name,email,password_hash,role) VALUES($1,$2,$3,$4,'employee') RETURNING id",[tenantId,'Workflow '+name+' العربية',email,await bcrypt.hash(password,10)])).rows[0].id;
  const role=(await db.query('INSERT INTO tenant_roles(tenant_id,name) VALUES($1,$2) RETURNING id',[tenantId,name])).rows[0].id;
  for(const key of keys) await db.query('INSERT INTO tenant_role_permissions(tenant_id,role_id,permission_key) VALUES($1,$2,$3)',[tenantId,role,key]);
  await db.query("INSERT INTO employee_role_assignments(tenant_id,employee_id,role_id,scope_type) VALUES($1,$2,$3,'company')",[tenantId,id,role]);
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  await context.addInitScript(()=>{localStorage.setItem('stanza.preferences.v1',JSON.stringify({tutorialsAutoStart:false,lanyardEnabled:false}));localStorage.setItem('horizon-language','en');localStorage.setItem('stanza-demo-notice-seen','true');});
  const login=await context.request.post(base+'/api/auth/login',{headers:{Origin:base},data:{email,password}});assert.equal(login.status(),200);return {id,tenantId,context};
 }
 const reviewer=await actor(own,'reviewer',all);
 const reporter=await actor(own,'reporter',all.filter(k=>!['leave.approve','leave.manage','leave.view.scoped'].includes(k)&&(!k.startsWith('grievances.')||['grievances.create','grievances.view_own'].includes(k))));
 const denied=await actor(own,'limited',[]), outsider=await actor(foreign,'foreign',all);
 await db.query('UPDATE employees SET manager_id=$1 WHERE id=$2 AND tenant_id=$3',[reviewer.id,reporter.id,own]);
 async function api(actor:any,path:string,data?:unknown,method=data?'POST':'GET') {const r=await actor.context.request.fetch(base+path,{method,headers:{Origin:base},...(data?{data}:{})});return {status:r.status(),...await r.json()};}
 assert.equal((await api(reporter,'/api/me/leave-requests')).total,0);assert.equal((await api(reporter,'/api/grievances/me')).total,0);
 async function leave(startDate:string,endDate:string,reason='Optional reason') {const r=await api(reporter,'/api/me/leave-requests',{leaveType:'annual',startDate,endDate,reason});assert.equal(r.status,201,JSON.stringify(r));if(!process.argv.includes('--audit-only'))assert.equal(r.request.startDate,startDate,'date-only start survives server timezone');if(!process.argv.includes('--audit-only'))assert.equal(r.request.endDate,endDate,'date-only end survives server timezone');return r.request;}
 const long='Long reason العربية. '.repeat(40);
 const approved=await leave('2030-01-01','2030-01-03',long), rejected=await leave('2030-02-01','2030-02-02'),pending=await leave('2030-03-01','2030-03-04');
 for(const [row,action] of [[approved,'approve'],[rejected,'reject']] as const)assert.equal((await api(reviewer,`/api/hr/leave-requests/${row.requestId}/${action}`,{expectedVersion:row.version,note:'Reviewer-only decision context'})).status,200);
 const payload={title:'Private workplace grievance',description:'Employee statement paragraph one.\n\n'+('Detailed confidential statement العربية. '.repeat(80)),category:'workplace',priority:'normal',confidentiality:'confidential',destinationDepartmentId:null};
 const created=await api(reporter,'/api/grievances',payload);assert.equal(created.status,201,JSON.stringify(created));let grievance=created.grievance;
 const internal='PRIVATE REVIEW NOTE '+tag;
 assert.equal((await api(reviewer,`/api/grievances/${grievance.id}/messages`,{version:grievance.version,kind:'internal',body:internal})).status,200);
 grievance=(await api(reviewer,'/api/grievances/'+grievance.id)).grievance;
 async function navigate(page:any,module:string) {await page.evaluate(()=>history.replaceState({},'', '/'));await page.locator('[data-tutorial-target=stanza-launcher]').click();await page.locator('#stanza-navigation-panel .stanza-navigation-item').filter({hasText:module}).last().click();}
 const p=await reporter.context.newPage();p.setDefaultTimeout(30000);p.on('pageerror',(e:Error)=>console.log('Browser page error',e.message));p.on('response',(r:any)=>{if(r.status()>=500)console.log('Browser failed response',new URL(r.url()).pathname,r.status());});
 await p.goto(base+'/?section=roster&view=leave');try{await p.locator('[data-leave-workspace]').waitFor();}catch(e){await p.screenshot({path:process.env.TEMP+'/stanza-workflow-browser-failure.png'});console.log('Browser state',(await p.locator('body').innerText()).slice(0,1500));throw e;}await p.getByRole('button',{name:'View details',exact:true}).first().waitFor();
 await p.screenshot({path:process.env.TEMP+'/stanza-leave-'+(process.argv.includes('--audit-only')?'before':'after')+'.png',fullPage:true});
 await navigate(p,'Grievances');await p.locator('.grievance-workspace').waitFor();await p.getByRole('button',{name:new RegExp('Private workplace grievance')}).click();await p.getByText(payload.description,{exact:true}).waitFor();
 assert(!await p.getByText(internal,{exact:true}).count());await p.screenshot({path:process.env.TEMP+'/stanza-grievance-'+(process.argv.includes('--audit-only')?'before':'after')+'.png',fullPage:true});
 const rp=await reviewer.context.newPage();await rp.goto(base+'/?section=roster&view=leave&leaveView=approvals');await rp.locator('[data-leave-workspace]').getByRole('button',{name:'Review',exact:true}).first().waitFor();await rp.screenshot({path:process.env.TEMP+'/stanza-leave-review-'+(process.argv.includes('--audit-only')?'before':'after')+'.png',fullPage:true});
 if(process.argv.includes('--audit-only')) {console.log('PASS initial real browser audit: employee leave, reviewer queue, confidential own grievance and hidden internal note');}
 else if(!process.argv.includes('--extras-only')) {
  assert.equal((await api(reporter,'/api/me/leave-requests',{leaveType:'annual',startDate:'2030-04-03',endDate:'2030-04-01'})).status,400);
  assert.equal((await api(reporter,'/api/me/leave-requests',{leaveType:'annual',endDate:'2030-04-01'})).status,400);
  assert.equal((await api(reporter,'/api/me/leave-requests',{leaveType:'annual',startDate:'2030-03-02',endDate:'2030-03-05'})).status,409);
  assert.equal((await api(denied,`/api/hr/leave-requests/${pending.requestId}/approve`,{expectedVersion:pending.version})).status,404);
  assert.equal((await api(reporter,`/api/hr/leave-requests/${pending.requestId}/approve`,{expectedVersion:pending.version})).status,404);
  assert.equal((await api(outsider,'/api/hr/leave-requests/'+pending.requestId)).status,404);
  assert.equal((await api(denied,'/api/me/leave-requests')).status,403);
  assert.equal((await api(reviewer,`/api/hr/leave-requests/${approved.requestId}/reject`,{expectedVersion:approved.version})).status,409);
  const ownDetail=await api(reporter,'/api/grievances/'+grievance.id);assert(!JSON.stringify(ownDetail).includes(internal));assert(!('assigned_to' in ownDetail.grievance));assert(!ownDetail.events.some((e:any)=>e.kind==='internal_note_added'));
  for(const actor of [denied,outsider]) {assert.equal((await api(actor,'/api/grievances/'+grievance.id)).status,404);assert(!(await api(actor,'/api/grievances?q=Private')).grievances?.length);}
  assert.equal((await api(denied,'/api/grievances')).status,403);
  assert.equal((await api(reporter,`/api/grievances/${grievance.id}/status`,{version:grievance.version,status:'triaged'},'PATCH')).status,403);
  assert.equal((await api(reviewer,`/api/grievances/${grievance.id}/status`,{version:1,status:'triaged'},'PATCH')).status,409);
  await p.goto(base+'/?section=roster&view=leave'); const panel=p.locator('[data-leave-workspace]');
  await panel.getByRole('button',{name:'Request leave',exact:true}).click();let d=p.getByRole('dialog');
  await d.getByLabel('Start date',{exact:true}).fill('2030-05-01');await d.getByLabel('End date',{exact:true}).fill('2030-05-03');await d.getByRole('button',{name:'Review request',exact:true}).click();await d.getByRole('button',{name:'Submit request',exact:true}).click();await d.getByText('Leave request submitted',{exact:true}).waitFor();await d.getByRole('button',{name:'Close',exact:true}).click();
  await rp.goto(base+'/?section=roster&view=leave&leaveView=approvals');await rp.locator('[data-leave-workspace]').getByRole('button',{name:'Review',exact:true}).first().click();d=rp.getByRole('dialog');await d.getByRole('button',{name:'Approve',exact:true}).click();d=rp.getByRole('dialog');await d.getByText('Workflow reporter العربية',{exact:true}).waitFor();await d.getByRole('button',{name:'Approve',exact:true}).click();await rp.getByText('Leave decision saved.',{exact:true}).waitFor();
  await rp.getByRole('dialog').getByText('Approved',{exact:true}).first().waitFor();await rp.keyboard.press('Escape');await rp.getByRole('dialog').waitFor({state:'detached'});await rp.locator('[data-leave-workspace]').getByRole('button',{name:'Review',exact:true}).first().click();await rp.getByRole('dialog').getByRole('button',{name:'Reject',exact:true}).click();await rp.getByRole('dialog').getByRole('button',{name:'Reject',exact:true}).click();await rp.getByText('Leave decision saved.',{exact:true}).waitFor();
  await rp.getByRole('dialog').getByText('Rejected',{exact:true}).first().waitFor();await rp.keyboard.press('Escape');await rp.getByRole('dialog').waitFor({state:'detached'});
  await navigate(p,'Grievances');await p.getByRole('button',{name:'Submit grievance',exact:true}).click();
  await p.getByLabel('Subject',{exact:true}).fill('Browser-submitted grievance');await p.getByLabel('Detailed description',{exact:true}).fill('Browser submission body.\n\nSecond paragraph.');const submission=p.waitForResponse((r:any)=>r.url()===base+'/api/grievances'&&r.request().method()==='POST');await p.getByRole('button',{name:'Submit case',exact:true}).click();assert.equal((await submission).status(),201);await p.locator('.grievance-identity').getByText('Browser-submitted grievance',{exact:true}).waitFor();await p.getByText('Browser submission body.\n\nSecond paragraph.',{exact:true}).waitFor();
  const rows=(await api(reporter,'/api/grievances/me')).grievances;assert.equal(rows.length,2);
  const browserCase=rows.find((r:any)=>r.title==='Browser-submitted grievance');
  await navigate(rp,'Grievances');await rp.getByRole('button',{name:'Case Inbox',exact:true}).click();await rp.getByRole('button',{name:new RegExp('Browser-submitted grievance')}).click();
  await rp.getByLabel('Lifecycle action').selectOption('triaged');await rp.getByRole('button',{name:'Apply action',exact:true}).click();await rp.getByText('Case updated.',{exact:true}).waitFor();
  let state=(await api(reviewer,'/api/grievances/'+browserCase.id)).grievance;
  assert.equal((await api(reviewer,`/api/grievances/${browserCase.id}/status`,{version:state.version,status:'in_progress'},'PATCH')).status,200);
  state=(await api(reviewer,'/api/grievances/'+browserCase.id)).grievance;
  assert.equal((await api(reviewer,`/api/grievances/${browserCase.id}/status`,{version:state.version,status:'resolved',resolutionSummary:'Employee-visible resolution'},'PATCH')).status,200);
  await rp.getByRole('button',{name:'Refresh',exact:true}).click();await rp.getByText('Employee-visible resolution',{exact:true}).first().waitFor();
  const configs=[{width:1440,ar:false,theme:'dark',xl:false},{width:1920,ar:true,theme:'custom',xl:false},{width:820,ar:false,theme:'light',xl:false},{width:820,ar:true,theme:'dark',xl:true},{width:390,ar:false,theme:'custom',xl:true},{width:390,ar:true,theme:'light',xl:true}];
  for(const c of configs) {
   const context=await browser.newContext({viewport:{width:c.width,height:1000},reducedMotion:c.xl?'reduce':'no-preference'});await context.addCookies(await reporter.context.cookies());
   await context.addInitScript(c=>{localStorage.setItem('horizon-language',c.ar?'ar':'en');localStorage.setItem('horizon-theme',c.theme==='light'?'light':'dark');localStorage.setItem('stanza.preferences.v1',JSON.stringify({tutorialsAutoStart:false,lanyardEnabled:false,backgroundPreset:c.theme==='custom'?'custom':'emerald',customTheme:{accent:'#bf52e5'},interfaceScale:c.xl?1.2:1,fontScale:c.xl?1.2:1}));localStorage.setItem('stanza-demo-notice-seen','true');},c);
   const page=await context.newPage();page.setDefaultTimeout(15000);await page.goto(base+'/?section=roster&view=leave');await page.locator('[data-leave-workspace]').getByRole('button',{name:c.ar?'عرض التفاصيل':'View details',exact:true}).first().waitFor();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:process.env.TEMP+`/stanza-leave-${c.width}-${c.ar?'ar':'en'}.png`,fullPage:true});
   await page.locator('[data-leave-workspace]').getByRole('button',{name:c.ar?'طلب إجازة':'Request leave',exact:true}).click();for(let i=0;i<8;i++){await page.keyboard.press('Tab');assert(await page.getByRole('dialog').evaluate((el:HTMLElement)=>el.contains(document.activeElement)));}await page.keyboard.press('Escape');
   await navigate(page,c.ar?'الشكاوى':'Grievances');await page.getByRole('button',{name:new RegExp('Private workplace grievance')}).click();await page.getByText(payload.description,{exact:true}).waitFor();assert(!await page.getByText(internal,{exact:true}).count());assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:process.env.TEMP+`/stanza-grievance-${c.width}-${c.ar?'ar':'en'}.png`,fullPage:true});await context.close();console.log('PASS responsive',JSON.stringify(c));
  }
  await p.goto(base+'/?section=roster&view=leave');await p.locator('[data-leave-workspace]').getByRole('button',{name:'View details',exact:true}).first().waitFor();await p.waitForTimeout(2000);let requests:string[]=[];p.on('request',(r:any)=>{if(r.url().includes('/api/'))requests.push(new URL(r.url()).pathname);});await p.waitForTimeout(35000);assert.equal(requests.filter(u=>u.includes('leave-requests')).length,0);
  await navigate(p,'Grievances');await p.getByRole('button',{name:new RegExp('Private workplace grievance')}).click();await p.getByText(payload.description,{exact:true}).waitFor();await p.waitForTimeout(2000);requests=[];await p.waitForTimeout(35000);assert.equal(requests.filter(u=>u.includes('/grievances')).length,0);
  assert((await db.query("SELECT action FROM audit_logs WHERE tenant_id=$1 AND action LIKE 'leave.%'",[own])).rowCount!>0);assert((await db.query("SELECT action FROM audit_logs WHERE tenant_id=$1 AND action LIKE 'grievance.%'",[own])).rowCount!>0);
  console.log('PASS real submission/approve/reject/stale/range/overlap/own/foreign/internal privacy/audit and 35-second idle per module');
 }

 if(!process.argv.includes('--audit-only')) {
  const emptyPage=await outsider.context.newPage();await emptyPage.goto(base+'/?section=roster&view=leave');await emptyPage.getByText('No leave requests match this view.',{exact:true}).waitFor();await navigate(emptyPage,'Grievances');await emptyPage.getByText('No grievances submitted.',{exact:true}).waitFor();await emptyPage.close();
  await leave('2030-06-01','2030-06-02');await p.goto(base+'/?section=roster&view=leave');await p.getByRole('button',{name:'View details',exact:true}).first().click();await p.getByRole('dialog').getByRole('button',{name:'Cancel request',exact:true}).click();const cancellation=p.waitForResponse((r:any)=>r.url().endsWith('/cancel')&&r.request().method()==='POST');await p.getByRole('dialog').last().getByRole('button',{name:'Cancel request',exact:true}).click();assert.equal((await cancellation).status(),200);await p.getByRole('dialog').getByText('Cancelled',{exact:true}).first().waitFor();await p.keyboard.press('Escape');await p.getByRole('dialog').waitFor({state:'detached'});await p.getByRole('tab',{name:'History',exact:true}).click();await p.getByLabel('Status').selectOption('cancelled');await p.getByRole('button',{name:'Apply filters',exact:true}).click();await p.locator('.leave-record[data-status=cancelled]').waitFor();assert.equal(await p.locator('.leave-record:not([data-status=cancelled])').count(),0);
  await leave('2030-07-01','2030-07-02');
  for(const c of [{width:820,ar:false},{width:390,ar:true}]) {
   const context=await browser.newContext({viewport:{width:c.width,height:1000},reducedMotion:'reduce'});await context.addCookies(await reviewer.context.cookies());await context.addInitScript(c=>{localStorage.setItem('horizon-language',c.ar?'ar':'en');localStorage.setItem('horizon-theme',c.ar?'light':'dark');localStorage.setItem('stanza.preferences.v1',JSON.stringify({tutorialsAutoStart:false,lanyardEnabled:false,interfaceScale:1.2,fontScale:1.2}));localStorage.setItem('stanza-demo-notice-seen','true');},c);const page=await context.newPage();await page.goto(base+'/?section=roster&view=leave&leaveView=approvals');await page.locator('.leave-record').first().waitFor();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.locator('.leave-record').first().getByRole('button',{name:c.ar?'مراجعة':'Review',exact:true}).click();await page.getByRole('dialog').getByText('Workflow reporter العربية',{exact:true}).waitFor();assert.notEqual(await page.getByRole('dialog').evaluate((el:HTMLElement)=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)');assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:process.env.TEMP+`/stanza-leave-review-${c.width}.png`,fullPage:true});await page.keyboard.press('Escape');await navigate(page,c.ar?'الشكاوى':'Grievances');await page.getByRole('button',{name:c.ar?'صندوق القضايا':'Case Inbox',exact:true}).click();await page.getByRole('button',{name:new RegExp('Private workplace grievance')}).click();await page.getByText(internal,{exact:true}).waitFor();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:process.env.TEMP+`/stanza-grievance-review-${c.width}.png`,fullPage:true});await context.close();
  }
  await navigate(rp,'Organisation');await rp.getByRole('button',{name:'People & Hierarchy',exact:true}).click();await rp.getByRole('button',{name:'Open employee: Workflow reporter العربية',exact:true}).click();await rp.getByRole('dialog').getByText('Workflow reporter العربية',{exact:true}).waitFor();const profile=await rp.getByRole('dialog').innerText();assert(!profile.includes(payload.title));assert(!profile.includes(payload.description));assert(!profile.includes(internal));await rp.keyboard.press('Escape');console.log('PASS People profile excludes grievance content and internal notes');
  const composerKey=`stanza.composer.v1:${encodeURIComponent(own)}:${encodeURIComponent(reviewer.id)}`;
  await rp.evaluate(key=>localStorage.setItem(key,JSON.stringify({version:1,activeId:'workflow-second',surface:'auto',workspaces:[{id:'my-workspace',name:'Primary',widgets:[]},{id:'workflow-second',name:'Secondary',widgets:[]}]})),composerKey);
  await rp.goto(base+'/?section=roster&view=leave&leaveView=approvals');await rp.locator('[data-leave-workspace]').waitFor();await rp.getByRole('button',{name:'Add to Workspace',exact:true}).first().click();assert.equal(await rp.locator('.composer-dialog').getByLabel('Workspace',{exact:true}).inputValue(),'workflow-second');await rp.locator('.composer-dialog').getByRole('button',{name:'Add widget',exact:true}).click();
  await navigate(rp,'Grievances');await rp.getByRole('button',{name:'Add to Workspace',exact:true}).first().click();await rp.locator('.composer-dialog').getByLabel('Workspace',{exact:true}).selectOption('my-workspace');await rp.locator('.composer-dialog').getByRole('button',{name:'Add widget',exact:true}).click();
  const saved=()=>rp.evaluate(key=>JSON.parse(localStorage.getItem(key)!),composerKey);let workspace=await saved();assert.equal(workspace.activeId,'workflow-second');assert.equal(workspace.workspaces[0].widgets[0].widgetId,'grievances');assert.equal(workspace.workspaces[1].widgets[0].widgetId,'leave');
  await navigate(rp,'Workspace Composer');await rp.locator('.composer-records').getByText('Workflow reporter العربية',{exact:true}).first().waitFor();await rp.getByRole('tab',{name:'Primary',exact:true}).click();await rp.locator('.composer-records').getByText(new RegExp('Private workplace grievance')).waitFor();assert(!await rp.locator('.composer').getByText(internal,{exact:true}).count());assert(!await rp.locator('.composer').getByText(payload.description,{exact:true}).count());await rp.reload();await navigate(rp,'Workspace Composer');workspace=await saved();assert.equal(workspace.activeId,'my-workspace');assert.equal(workspace.workspaces.length,2);assert.equal(workspace.workspaces[0].widgets[0].widgetId,'grievances');
  console.log('PASS Leave/Grievance Workspace active and alternate destinations, persistence, employee label and private body/note exclusion');
  const events=await api(reviewer,'/api/hr/audit-events');assert.equal(events.status,200);assert(events.events.length);assert(!JSON.stringify(events).includes(internal));assert(!JSON.stringify(events).includes(payload.description));const foreignEvents=await api(outsider,'/api/hr/audit-events?targetId='+grievance.id);assert.equal(foreignEvents.status,200);assert.equal(foreignEvents.total,0);
  console.log('PASS empty states, real cancellation/history filter, mobile/tablet reviewer XL/RTL, and private tenant-filtered audit projection');
 }

} catch(error) {
 for(const context of browser.contexts()) for(const page of context.pages()) {console.log('Failure page',new URL(page.url()).pathname,(await page.locator('body').innerText()).slice(-3500));await page.screenshot({path:process.env.TEMP+'/stanza-workflow-failure-'+randomUUID()+'.png',fullPage:true}).catch(()=>{});}
 throw error;
} finally {
 await browser.close();
 for(const id of tenants) {assert.equal((await db.query("SELECT id FROM tenants WHERE id=$1 AND slug LIKE 'workflow-polish-%'",[id])).rowCount,1);await db.query('DELETE FROM tenants WHERE id=$1',[id]);}
 assert.equal((await db.query('SELECT count(*)::int AS n FROM tenants WHERE slug LIKE $1',['workflow-polish-%'+tag])).rows[0].n,0);await db.end();console.log('PASS owned fixture cleanup');
}
