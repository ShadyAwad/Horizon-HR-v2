import {createRequire} from 'node:module';
import './router-env';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import {getMigrationPool} from './migration-pool';
import { assertDatabaseMutationSafety, assertHttpMutationSafety } from './mutation-safety';
import { getDbPool, getHrQueue } from '../src/lib/hr-background';
const base=assertHttpMutationSafety(process.env.CONTROL_TEST_BASE_URL||'http://localhost:3001','Control browser');
assertDatabaseMutationSafety(process.env.DATABASE_URL,'Control browser');
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
 const row=(await pool.query(`INSERT INTO employees(tenant_id,email,full_name,password_hash,role,manager_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,[tenantId,email,'Control test '+name,await bcrypt.hash(password,10),name==='admin'?'hr_admin':name==='manager'?'manager':'employee',manager?.id||null])).rows[0];
 const role=(await pool.query(`INSERT INTO tenant_roles(tenant_id,name) VALUES($1,$2) RETURNING id`,[tenantId,name])).rows[0];
 for(const permission of permissions)await pool.query('INSERT INTO tenant_role_permissions(tenant_id,role_id,permission_key) VALUES($1,$2,$3)',[tenantId,role.id,permission]);
 await pool.query('INSERT INTO employee_role_assignments(tenant_id,employee_id,role_id,scope_type) VALUES($1,$2,$3,$4)',[tenantId,row.id,role.id,scope]);
 const r=await fetch(base+'/api/auth/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({email,password})});assert.equal(r.status,200,'Fixture login');const signedIn=(await r.json()).user;assert.equal(signedIn.tenantId,tenantId,'Fixture cookie must belong to the intended tenant');assert.equal(signedIn.id,row.id,'Fixture cookie must belong to the intended employee');
 return {id:row.id,tenantId,email,cookie:r.headers.get('set-cookie')!.split(';')[0]};
}
const {chromium}=createRequire(import.meta.url)(process.env.BROWSER_PLAYWRIGHT_MODULE||'C:/Users/10/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser=await chromium.launch({headless:true,channel:'msedge'});
try {
 const tenant=(await pool.query('INSERT INTO tenants(slug,company_name) VALUES($1,$2) RETURNING id',['control-browser-'+tag,'Control browser fixture'])).rows[0].id;tenants.push(tenant);
 const emp=await person(tenant,'employee',['attendance.clock']);
 async function pageFor(width=1440,ar=false,xl=false,preset='emerald',light=false,reduce=false) {
  const c=await browser.newContext({viewport:{width,height:width<500?844:1000},serviceWorkers:'block',reducedMotion:reduce?'reduce':'no-preference'});
  await c.addCookies([{name:emp.cookie.split('=')[0],value:emp.cookie.substring(emp.cookie.indexOf('=')+1),url:base}]);
  await c.addInitScript(({ar,xl,preset,light})=>{localStorage.setItem('stanza.preferences.v1',JSON.stringify({tutorialsAutoStart:false,lanyardEnabled:false,desktopNavigationMode:'rail',backgroundPreset:preset,customTheme:{accent:'#398bfa'},interfaceScale:xl?1.15:1,fontScale:xl?1.2:1}));localStorage.setItem('stanza-demo-notice-seen','true');localStorage.setItem('horizon-theme',light?'light':'dark');localStorage.setItem('horizon-language',ar?'ar':'en');},{ar,xl,preset,light});
  const p=await c.newPage();p.setDefaultTimeout(15000);await p.goto(base);await p.locator('[data-geo-interaction=clock]').waitFor();await p.waitForTimeout(600);return p;
 }
 async function capture(p:any,name:string,control?:any){await (control||p).screenshot({path:process.env.TEMP+'/stanza-control-'+name+'.png'});}
 async function park(p:any,b:any,name:string) {
  await b.scrollIntoViewIfNeeded();await p.mouse.move(1,1);await p.waitForTimeout(200);const rect=await b.boundingBox();assert(rect);await b.evaluate((e:any)=>{e.events={enter:0,leave:0};e.addEventListener('pointerenter',()=>e.events.enter++);e.addEventListener('pointerleave',()=>e.events.leave++);});
  await capture(p,name+'-idle',b);await p.mouse.move(rect.x+rect.width/2,rect.y+rect.height-2);
  for(let i=0;i<55;i++){await p.waitForTimeout(100);assert.deepEqual(await b.boundingBox(),rect,name+' outer rect');const state=await b.evaluate((e:any)=>({hover:e.matches(':hover'),events:e.events,transform:getComputedStyle(e).transform,border:getComputedStyle(e).borderWidth,bg:getComputedStyle(e).backgroundColor}));assert.equal(state.hover,true);assert.deepEqual(state.events,{enter:1,leave:0});assert(['none','matrix(1, 0, 0, 1, 0, 0)'].includes(state.transform));if(name==='passkey')assert(!state.bg.includes('rgba'),'Opaque throughout hover');if(i===0||i===54)await capture(p,name+'-hover-'+i,b);}
  await p.mouse.down();await p.waitForTimeout(150);assert.deepEqual(await b.boundingBox(),rect,name+' press rect');await capture(p,name+'-press',b);await b.evaluate((e:HTMLElement)=>e.addEventListener('click',event=>{event.preventDefault();event.stopImmediatePropagation();},{capture:true,once:true}));await p.mouse.up();await p.mouse.move(120,40);await b.focus();await p.keyboard.press('Tab');await p.keyboard.press('Shift+Tab');assert.equal(await b.evaluate((e:HTMLElement)=>e.matches(':focus-visible')),true);await capture(p,name+'-focus',b);
  assert.equal(await b.evaluate((e:HTMLElement)=>e.getAnimations({subtree:true}).filter(a=>a.effect?.getComputedTiming().iterations===Infinity).length),0);
  console.log('PASS '+name+' 5.5-second parked edge, 55 identical rectangles, 1 enter/0 leave, press/focus');
 }
 const p=await pageFor();const clock=p.locator('.attendance-terminal');await park(p,clock,'clock');
 let attendanceRequests=0;const count=(r:any)=>{if(/\/api\/(attendance|clock-status|clock-in|clock-out|break-requests)/.test(r.url()))attendanceRequests++;};p.on('request',count);await p.waitForTimeout(35000);p.off('request',count);assert.equal(attendanceRequests,0,'Idle attendance has no polling');
 async function settings(q:any,ar=false){const open=q.getByRole('button',{name:ar?'الإعدادات':'Settings',exact:true});if(!await open.count())await q.locator('[data-tutorial-target=stanza-launcher]').click();await open.click();const disclosure=q.getByRole('button',{name:ar?/مفاتيح المرور/:/Passkeys/});assert.equal(await disclosure.getAttribute('aria-expanded'),'false');await disclosure.focus();await q.keyboard.press('Enter');assert.equal(await disclosure.getAttribute('aria-expanded'),'true');await q.locator('.passkey-action').waitFor();return disclosure;}
 const disclosure=await settings(p);await p.getByText('No passkeys registered yet.',{exact:true}).waitFor();const passkey=p.locator('.passkey-action');await park(p,passkey,'passkey');
 const session=await p.context().newCDPSession(p);await session.send('WebAuthn.enable');await session.send('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',transport:'internal',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true}});
 let release!:()=>void;const held=new Promise<void>(r=>release=r);await p.route('**/api/auth/passkeys/register/options',async(route:any)=>{await held;await route.continue();});
 const before=await passkey.boundingBox();await passkey.click();await p.locator('.passkey-action[aria-busy=true]').waitFor();assert.equal(await passkey.isDisabled(),true);assert.deepEqual(await passkey.boundingBox(),before,'Loading preserves label geometry');await capture(p,'passkey-loading',passkey);release();await p.getByText('Passkey added. You can now sign in with this device.',{exact:true}).waitFor();await p.getByText('Platform passkey',{exact:true}).waitFor();await p.unroute('**/api/auth/passkeys/register/options');assert.equal((await pool.query('SELECT count(*)::int n FROM user_webauthn_credentials WHERE tenant_id=$1 AND employee_id=$2',[tenant,emp.id])).rows[0].n,1);await capture(p,'passkey-registered');console.log('PASS real WebAuthn registration/options/verification/storage with Chromium virtual authenticator');
 await disclosure.click();assert.equal(await disclosure.getAttribute('aria-expanded'),'false');assert.equal(await disclosure.evaluate((e:HTMLElement)=>document.activeElement===e),true);await disclosure.click();await p.getByText('Platform passkey',{exact:true}).waitFor();
 // A failed options response exercises the preserved error UI without changing auth semantics.
 await p.route('**/api/auth/passkeys/register/options',(route:any)=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({success:false,error:'Fixture registration unavailable'})}));await passkey.click();await p.getByText('Fixture registration unavailable',{exact:true}).waitFor();await p.unroute('**/api/auth/passkeys/register/options');await capture(p,'passkey-error');
 await session.send('Performance.enable');await p.waitForTimeout(1000);const beforeMetrics=(await session.send('Performance.getMetrics')).metrics;await p.waitForTimeout(10000);const afterMetrics=(await session.send('Performance.getMetrics')).metrics;const metric=(n:string)=>(afterMetrics.find((m:any)=>m.name===n)?.value||0)-(beforeMetrics.find((m:any)=>m.name===n)?.value||0);console.log('Settings idle 10s',{scriptMs:metric('ScriptDuration')*1000,layouts:metric('LayoutCount')});assert(metric('ScriptDuration')<.1,'No new scripting loop in idle Settings');
 // Exercise the existing draft picker at its real input cadence, with bounded test instrumentation.
 await p.bringToFront();await p.getByRole('button',{name:/Appearance/i}).click();
 const custom=p.getByRole('radio',{name:'Custom',exact:true});if(await custom.count())await custom.click();await p.locator('.stanza-custom-editor').waitFor();const picker=p.locator('.stanza-studio-fields').first().locator('input[type=color]').first();await picker.scrollIntoViewIfNeeded();await p.waitForTimeout(500);
 await p.evaluate(()=>{(window as any).writes=0;const set=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='stanza.preferences.v1')(window as any).writes++;return set.call(this,k,v);};});const scrubBefore=(await session.send('Performance.getMetrics')).metrics;
 await picker.evaluate(async(e:HTMLInputElement)=>{const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!;for(let i=0;i<240;i++){set.call(e,'#'+((i*7919+123456)%0xffffff).toString(16).padStart(6,'0'));e.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,8));}e.dispatchEvent(new Event('change',{bubbles:true}));});await p.waitForTimeout(650);const scrubAfter=(await session.send('Performance.getMetrics')).metrics;const scriptMs=1000*((scrubAfter.find((m:any)=>m.name==='ScriptDuration')?.value||0)-(scrubBefore.find((m:any)=>m.name==='ScriptDuration')?.value||0));const writes=await p.evaluate(()=>(window as any).writes);assert(writes<=2,'Picker remains a draft until commit');console.log('PASS Custom Theme 240 inputs',{scriptMs,writes});
 let combinations=0;for(const width of [1920,1440,820,390])for(const xl of [false,true])for(const ar of [false,true]) {
  const preset=['emerald','amethyst','custom','emerald'][combinations%4];const light=combinations%4===3;const reduce=xl&&ar;const q=await pageFor(width,ar,xl,preset,light,reduce);
  const terminal=q.locator('.attendance-terminal');const region=q.locator('.attendance-primary');const status=q.locator('.attendance-status-context');const r=await region.boundingBox(),t=await terminal.boundingBox(),s=await status.boundingBox();assert(r&&t&&s);assert(r.width<=34*16*1.15+2);assert(t.width<160&&t.height<160);if(width===390)assert(t.y>=s.y+s.height,'Mobile stacks state/action');else assert(Math.abs(t.y-s.y)<150,'Desktop action beside state');assert.equal(await q.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.equal(await region.evaluate((e:HTMLElement)=>e.scrollWidth<=e.clientWidth+1),true);assert.equal(await q.evaluate(()=>document.documentElement.dir),ar?'rtl':'ltr');await capture(q,`geo-${width}-${xl}-${ar}-${preset}-${light}`);
  await settings(q,ar);const b=q.locator('.passkey-action');await b.scrollIntoViewIfNeeded();const box=await b.boundingBox();await b.hover();await q.waitForTimeout(200);assert.deepEqual(await b.boundingBox(),box);await b.focus();await q.keyboard.press('Tab');await q.keyboard.press('Shift+Tab');assert(await b.evaluate((e:HTMLElement)=>e.matches(':focus-visible')));assert.equal(await q.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);if(reduce){assert.equal(await b.evaluate((e:HTMLElement)=>getComputedStyle(e).transitionDuration),'0s');assert.equal(await terminal.evaluate((e:HTMLElement)=>getComputedStyle(e.querySelector('.attendance-terminal-core')!).transitionDuration),'0s');}await capture(q,`passkey-${width}-${xl}-${ar}-${preset}-${light}`);await q.context().close();combinations++;
 }
 console.log('PASS '+combinations+' real pages across 1920/1440/820/390, normal/XL, English/Arabic, green/purple/custom blue/light, reduced motion, collapsed/expanded/existing credential');

} catch(error){for(const c of browser.contexts())for(const p of c.pages())await p.screenshot({path:process.env.TEMP+'/stanza-control-failure-'+browser.contexts().indexOf(c)+'.png',fullPage:true}).catch(()=>{});throw error;}
finally {await browser.close();const queue=getHrQueue();for(const job of await queue.getJobs(['wait','delayed','completed','failed'],0,-1))if(tenants.includes(job.data?.tenantId))await job.remove();await queue.close();for(const t of tenants)await pool.query('DELETE FROM tenants WHERE id=$1',[t]);await pool.end();await getDbPool()?.end();}
