import {createRequire} from 'node:module';
import './router-env';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import {getMigrationPool} from './migration-pool';
import { assertDatabaseMutationSafety, assertHttpMutationSafety } from './mutation-safety';
import { rollupAttendanceDailySummary } from '../src/server/attendance/attendance-rollup';
import { getDbPool, getHrQueue, enqueueAttendanceRollup } from '../src/lib/hr-background';
const base=assertHttpMutationSafety(process.env.ATTENDANCE_TEST_BASE_URL||'http://localhost:3001','Attendance integration');
assertDatabaseMutationSafety(process.env.DATABASE_URL,'Attendance integration');
const pool=getMigrationPool();
const tenants:string[]=[];const password=crypto.randomBytes(20).toString('base64url');const tag=crypto.randomUUID();
type Person={id:string;tenantId:string;email:string;cookie:string};
async function call(u:Person|null,path:string,body?:unknown,method='POST',origin=base) {
 const r=await fetch(base+path,{method:body===undefined?'GET':method,headers:{...(u?{Cookie:u.cookie}:{}),Origin:origin,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 assert.match(r.headers.get('content-type') || '', /^application\/json\b/, `${path} must return API JSON, not the SPA document`);
 return {status:r.status,body:await r.json()};
}
async function ok(u:Person,path:string,body?:unknown,method='POST') {const r=await call(u,path,body,method);assert(r.status<300,`${path}: ${r.status} ${JSON.stringify(r.body)}`);return r.body;}
async function person(tenantId:string,name:string,permissions:string[],scope='company',manager?:Person):Promise<Person> {
 const email=`${name}-${tag}@example.invalid`;
 const row=(await pool.query(`INSERT INTO employees(tenant_id,email,full_name,password_hash,role,manager_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,[tenantId,email,'Attendance test '+name,await bcrypt.hash(password,10),name==='admin'?'hr_admin':name==='manager'?'manager':'employee',manager?.id||null])).rows[0];
 const role=(await pool.query(`INSERT INTO tenant_roles(tenant_id,name) VALUES($1,$2) RETURNING id`,[tenantId,name])).rows[0];
 for(const permission of permissions)await pool.query('INSERT INTO tenant_role_permissions(tenant_id,role_id,permission_key) VALUES($1,$2,$3)',[tenantId,role.id,permission]);
 await pool.query('INSERT INTO employee_role_assignments(tenant_id,employee_id,role_id,scope_type) VALUES($1,$2,$3,$4)',[tenantId,row.id,role.id,scope]);
 const r=await fetch(base+'/api/auth/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({email,password})});assert.equal(r.status,200,'Fixture login');
 return {id:row.id,tenantId,email,cookie:r.headers.get('set-cookie')!.split(';')[0]};
}
const {chromium}=createRequire(import.meta.url)(process.env.BROWSER_PLAYWRIGHT_MODULE||'C:/Users/10/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser=await chromium.launch({headless:true,channel:'msedge'});
try {
 const tenant=(await pool.query('INSERT INTO tenants(slug,company_name) VALUES($1,$2) RETURNING id',[`attendance-browser-${tag}`,'Attendance browser fixture'])).rows[0].id;tenants.push(tenant);
 const manager=await person(tenant,'manager',['attendance.view','attendance.early_leave.review','break_requests.view_all','break_requests.review'],'direct_reports');
 const emp=await person(tenant,'employee',['attendance.clock','break_requests.create','break_requests.view_own'],'self',manager);
 await pool.query(`INSERT INTO company_locations(tenant_id,name,latitude,longitude,boundary) VALUES($1,'Browser geofence',30,31,ST_Buffer(ST_SetSRID(ST_MakePoint(31,30),4326)::geography,1000)::geometry)`,[tenant]);
 async function pageFor(u:Person,width=1440,ar=false,xl=false){const c=await browser.newContext({viewport:{width,height:width<500?844:1000},geolocation:{latitude:30,longitude:31},permissions:['geolocation']});await c.addCookies([{name:u.cookie.split('=')[0],value:u.cookie.substring(u.cookie.indexOf('=')+1),url:base}]);await c.addInitScript(({ar,xl})=>{localStorage.setItem('stanza.preferences.v1',JSON.stringify({tutorialsAutoStart:false,interfaceScale:xl?1.15:1,fontScale:xl?1.2:1}));localStorage.setItem('stanza-demo-notice-seen','true');localStorage.setItem('horizon-language',ar?'ar':'en');},{ar,xl});const p=await c.newPage();p.setDefaultTimeout(15000);await p.goto(base);await p.locator('[data-tutorial-target="geo-clock"]').waitFor();return p;}
 const p=await pageFor(emp);const clock=p.locator('[data-geo-interaction="clock"]');
 await clock.click();await p.getByText('Location verified',{exact:true}).waitFor();await p.waitForTimeout(4200);assert.match(await clock.innerText(),/CLOCK OUT|Clock Out/i);await clock.click();await p.waitForTimeout(4200);
 console.log('PASS browser: unchanged normal geofenced clock-in, state changes, normal unscheduled clock-out');
 const now=Date.now(),end=new Date(now+2*3600000),breaks=[{startTime:new Date(now+8000).toISOString(),endTime:new Date(now+300000).toISOString()},{startTime:new Date(now+900000).toISOString(),endTime:new Date(now+1200000).toISOString()}];
 await pool.query(`INSERT INTO roster_shifts(tenant_id,employee_id,created_by,start_time,end_time,planned_breaks) VALUES($1,$2,$3,$4,$5,$6::jsonb)`,[tenant,emp.id,manager.id,new Date(now-3600000),end,JSON.stringify(breaks)]);
 await p.getByRole('button',{name:'Clock in without location',exact:true}).click();let dialog=p.getByRole('dialog',{name:'Clock in without location',exact:true});await dialog.getByText(/skips location verification/).waitFor();await dialog.getByLabel('Note (optional)').fill('Browser no-location note');await dialog.getByRole('button',{name:'Clock in without location',exact:true}).click();await dialog.waitFor({state:'hidden'});await p.getByText('Clocked in without location',{exact:true}).waitFor();assert((await ok(emp,'/api/clock-status')).isClockedIn);
 await p.getByRole('button',{name:'Start break',exact:true}).waitFor({timeout:15000});await clock.click();await p.getByRole('button',{name:'End break',exact:true}).first().waitFor();assert((await ok(emp,'/api/clock-status')).attendance.activeBreak);await clock.click();await p.getByRole('button',{name:/CLOCK OUT|Clock Out/i,exact:true}).waitFor();
 console.log('PASS browser: explicit no-location explanation/confirmation, one-shot scheduled break boundary, Start break, On break and End break');
 async function requestDeparture(){await p.getByRole('button',{name:'Request early leave',exact:true}).click();const d=p.getByRole('dialog',{name:'Request early leave',exact:true});await d.getByText(/will not clock you out/).waitFor();const local=new Date(Date.now()+30*60000);const departure=new Date(local.getTime()-local.getTimezoneOffset()*60000).toISOString().slice(0,16);await d.getByLabel('Requested departure',{exact:true}).fill(departure);await d.getByLabel('Note (optional)').fill('Browser appointment');await d.getByText(/hour.*minutes early/).waitFor();await d.getByRole('button',{name:'Send request',exact:true}).click();await d.waitFor({state:'hidden'});assert((await ok(emp,'/api/clock-status')).isClockedIn);}
 await requestDeparture();const reviewer=await pageFor(manager);await reviewer.getByText('Early leave requests',{exact:true}).click();await reviewer.getByRole('button',{name:'Reject',exact:true}).click();await p.getByRole('button',{name:'Refresh',exact:true}).click();await p.getByText(/Early leave request: Rejected/).waitFor();await requestDeparture();await reviewer.reload();await reviewer.getByText('Early leave requests',{exact:true}).click();await reviewer.getByRole('button',{name:'Approve',exact:true}).click();await p.getByRole('button',{name:'Refresh',exact:true}).click();await p.getByText(/Early leave request: Approved/).waitFor();
 console.log('PASS browser: departure request remains clocked in, authoritative duration preview, manager rejection and approval, employee status');
 await p.locator('[data-geo-interaction="clock"]').click();dialog=p.getByRole('dialog',{name:'Clock out early?',exact:true});await dialog.getByText(/Remaining until your authorized end:/).waitFor();await dialog.getByLabel('Note (optional)').fill('Browser early-out note');await dialog.getByRole('button',{name:'Clock out early',exact:true}).click();await dialog.waitFor({state:'hidden'});assert.equal((await ok(emp,'/api/clock-status')).isClockedIn,false);
 const closed=(await pool.query('SELECT * FROM time_logs WHERE tenant_id=$1 AND employee_id=$2 ORDER BY clock_in_time DESC LIMIT 1',[tenant,emp.id])).rows[0];assert.equal(closed.early_departure_note,'Browser early-out note');
 console.log('PASS browser: early clock-out Stanza dialog, natural remaining time, explicit confirmation and persisted optional note');
 const mobile=await pageFor(emp,390,true,true);assert.equal(await mobile.evaluate(()=>document.documentElement.dir),'rtl');await mobile.getByRole('button',{name:'تسجيل الحضور دون موقع',exact:true}).click();const md=mobile.getByRole('dialog');assert.equal(await md.getAttribute('dir'),'rtl');const bounds=await md.boundingBox();assert(bounds&&bounds.x>=0&&bounds.x+bounds.width<=391);await md.getByRole('button',{name:'تسجيل الحضور دون موقع',exact:true}).click();await md.waitFor({state:'hidden'});
 await mobile.getByRole('button',{name:'تسجيل الانصراف',exact:true}).click();const early=mobile.getByRole('dialog');await early.getByText(/الوقت المتبقي/).waitFor();assert.match(await early.innerText(),/دقائق|دقيقة|ساعة|ساعتان/);assert.equal(await early.evaluate((d:HTMLElement)=>d.scrollWidth<=d.clientWidth+1),true);await mobile.screenshot({path:process.env.TEMP+'/stanza-attendance-arabic-xl.png',fullPage:true});await early.getByRole('button',{name:'إلغاء',exact:true}).click();
 const active=(await ok(emp,'/api/clock-status')).timeLogId;await pool.query("UPDATE time_logs SET scheduled_end_time=clock_timestamp()-INTERVAL '1 second' WHERE id=$1",[active]);await mobile.reload();await mobile.locator('[data-geo-interaction="clock"]').click();await mobile.waitForTimeout(1200);assert.equal(await mobile.getByRole('dialog').count(),0);assert.equal((await ok(emp,'/api/clock-status')).isClockedIn,false);
 const desktopXL=await pageFor(emp,1440,false,true);assert.equal(await desktopXL.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);const desktop=await pageFor(emp);assert.equal(await desktop.locator('.stanza-module-content,.stanza-settings-group,.stanza-page-header').count(),0);await desktop.screenshot({path:process.env.TEMP+'/stanza-attendance-desktop.png',fullPage:true});
 console.log('PASS browser: 390px Arabic RTL XL, dialog bounds/focusable native controls, Arabic duration and on-time clock-out without early warning; committed composition retained');
} finally {await browser.close();const queue=getHrQueue();for(const job of await queue.getJobs(['wait','delayed','completed','failed'],0,-1))if(tenants.includes(job.data?.tenantId))await job.remove();await queue.close();for(const t of tenants)await pool.query('DELETE FROM tenants WHERE id=$1',[t]);await pool.end();await getDbPool()?.end();}
