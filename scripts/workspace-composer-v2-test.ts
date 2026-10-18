import assert from 'node:assert/strict';
import os from 'node:os';import path from 'node:path';import {rm} from 'node:fs/promises';
import {BusinessFixtures} from './business-scenario-fixtures';
import {storageKey} from '../src/components/workspace-composer/workspace-model';
const f=new BusinessFixtures(),shots:string[]=[];
try {
 await f.setup('composer-v2');
 const actor=f.admin,p=await f.page(actor),key=storageKey(f.primary,actor.id),errors:string[]=[];
 p.on('pageerror',(e:Error)=>errors.push(e.message));
 const c=p.locator('.composer'),saved=()=>p.evaluate((key:string)=>JSON.parse(localStorage.getItem(key)!),key);
 const open=()=>f.navigate(p,'Workspace Composer');
 const customize=async()=>{await c.waitFor();if(await c.getAttribute('data-editing')!=='true')await c.getByRole('button',{name:'Customize',exact:true}).click();};
 const card=()=>c.getByRole('article',{name:'Attendance Status',exact:true});
 await open();await c.locator('.composer-empty').waitFor();
 let widgetRequests=0;const count=(r:any)=>{if(['/api/clock-status','/api/communications/meetings','/api/hiring/applicants'].includes(new URL(r.url()).pathname))widgetRequests++;};p.on('request',count);
 await c.locator('.composer-empty button').focus();await p.keyboard.press('Enter');const before=widgetRequests;await p.waitForTimeout(500);assert.equal(widgetRequests,before,'Gallery previews do not fetch live widget data');
 assert(await p.locator('.composer-gallery-card').count()>10);assert.equal(await p.locator('.composer-gallery-card svg').count(),42);
 shots.push(path.join(os.tmpdir(),'stanza-composer-v2-gallery.png'));await p.screenshot({path:shots.at(-1)});
 await p.getByRole('button',{name:'Add Attendance Status',exact:true}).focus();await p.keyboard.press('Enter');await p.waitForFunction(()=>document.activeElement?.matches('.composer-drag'));
 await c.getByRole('button',{name:'Add widgets',exact:true}).click();await p.getByRole('button',{name:'Add Upcoming Meetings',exact:true}).click();
 assert.equal((await saved()).workspaces[0].widgets.length,2);
 // Count only end-of-gesture authoritative preference writes, never individual pixels.
 await p.evaluate((key:string)=>{const original=Storage.prototype.setItem;(window as any).__composerWrites=0;Storage.prototype.setItem=function(k,v){if(k===key)(window as any).__composerWrites++;return original.call(this,k,v);};},key);
 const timings:number[]=[];
 async function gesture(selector:string,dx:number,dy:number){
  const h=card().locator(selector);await h.scrollIntoViewIfNeeded();const b=await h.boundingBox();assert(b);const writes=await p.evaluate(()=>(window as any).__composerWrites);
  const start=Date.now();await p.mouse.move(b.x+b.width/2,b.y+b.height/2);await p.mouse.down();await p.mouse.move(b.x+b.width/2+dx,b.y+b.height/2+dy,{steps:18});
  assert.equal(await p.evaluate(()=>(window as any).__composerWrites),writes,'No per-pixel persistence');assert(await c.locator('.composer-placement:not([hidden])').count());
  await p.mouse.up();timings.push(Date.now()-start);assert.equal(await p.evaluate(()=>(window as any).__composerWrites),writes+1,'One write on commit');
 }
 const initial=(await saved()).workspaces[0].widgets.find((w:any)=>w.widgetId==='attendance');
 await gesture('.composer-drag',0,64);await gesture('.composer-resize',0,64);
 let changed=(await saved()).workspaces[0].widgets.find((w:any)=>w.widgetId==='attendance');assert(changed.y!==initial.y);assert(changed.height>initial.height);
 // Exact complaint: existing card, module navigation, return, resize without an add/workaround.
 for(const destination of ['Geo-Operations','Company Feed','Profile','Settings']){
  const count=(await saved()).workspaces[0].widgets.length;if(destination==='Settings'){await p.locator('[data-tutorial-target=stanza-launcher]').click();await p.locator('[data-tutorial-target=settings-button]').click();await p.locator('#stanza-control-center').getByRole('button',{name:'Close',exact:true}).click();}else await f.navigate(p,destination);await open();
  assert.equal(await c.getAttribute('data-editing'),'true');assert(await card().locator('.composer-resize').isVisible());
  const previous=(await saved()).workspaces[0].widgets.find((w:any)=>w.widgetId==='attendance').height;
  await gesture('.composer-resize',0,previous>=9?-64:64);
  assert.notEqual((await saved()).workspaces[0].widgets.find((w:any)=>w.widgetId==='attendance').height,previous);
  assert.equal((await saved()).workspaces[0].widgets.length,count);
 }
 await card().locator('.composer-widget-menu summary').click();await card().getByRole('button',{name:'Configure',exact:true}).focus();await p.keyboard.press('Enter');
 await p.getByLabel('Widget size',{exact:true}).selectOption('0');await p.getByLabel('Compact status',{exact:true}).check();await p.keyboard.press('Escape');
 assert.equal((await saved()).workspaces[0].widgets.find((w:any)=>w.widgetId==='attendance').width,4);
 assert.equal((await saved()).workspaces[0].widgets.find((w:any)=>w.widgetId==='attendance').config.compact,true);
 // Keyboard equivalents are real native selects; cancellation does not persist.
 await card().getByLabel('Move or resize Attendance Status',{exact:true}).selectOption('wider');
 const cancellation=JSON.stringify(await saved());const h=card().locator('.composer-drag');await h.scrollIntoViewIfNeeded();const b=await h.boundingBox();await p.mouse.move(b!.x+15,b!.y+15);await p.mouse.down();await p.mouse.move(b!.x+80,b!.y+80);await p.keyboard.press('Escape');await p.mouse.up();assert.equal(JSON.stringify(await saved()),cancellation);
 await c.getByRole('article',{name:'Upcoming Meetings',exact:true}).locator('summary').click();await c.getByRole('article',{name:'Upcoming Meetings',exact:true}).getByRole('button',{name:'Remove',exact:true}).click();
 await c.getByRole('button',{name:'Done',exact:true}).focus();await p.keyboard.press('Enter');assert.equal(await c.locator('.composer-drag').count(),0);assert.equal(await c.locator('.composer-resize').count(),0);
 const persisted=JSON.stringify(await saved());await p.reload();await open();assert.equal(JSON.stringify(await saved()),persisted);assert.equal(await c.locator('.composer-resize').count(),0,'Reload starts locked');
 await f.api(actor,'/api/auth/logout',{});const r=await actor.context.request.post(f.base+'/api/auth/login',{headers:{Origin:f.base},data:{email:actor.email,password:f.password}});assert.equal(r.status(),200);await p.reload();await open();assert.equal(JSON.stringify(await saved()),persisted,'Layout survives logout/login');
 // Cross-module add uses the same catalog and placement.
 await f.navigate(p,'Geo-Operations');await p.getByRole('button',{name:'Add to workspace',exact:true}).first().click();await p.locator('.composer-dialog').getByRole('button',{name:'Add widget',exact:true}).click();await open();assert.equal((await saved()).workspaces[0].widgets.length,2);
 await customize();
 await p.addInitScript(()=>{const language=localStorage.getItem('__composer_test_language');if(language)localStorage.setItem('horizon-language',language);});
 let matrix=0;
 for(const ar of [false,true])for(const width of [390,820,1440,1920]){
  await p.evaluate((ar:boolean)=>localStorage.setItem('__composer_test_language',ar?'ar':'en'),ar);await p.reload();await f.navigate(p,ar?'منشئ مساحات العمل':'Workspace Composer');await c.getByRole('button',{name:ar?'تخصيص المساحة':'Customize',exact:true}).click();await p.setViewportSize({width,height:1000});
  await p.evaluate(({ar,width})=>{localStorage.setItem('horizon-language',ar?'ar':'en');dispatchEvent(new StorageEvent('storage',{key:'horizon-language',newValue:ar?'ar':'en'}));const s=JSON.parse(localStorage.getItem('stanza.preferences.v1')!);s.fontScale=width===390?1.2:1;s.interfaceScale=width===390?1.2:1;const value=JSON.stringify(s);localStorage.setItem('stanza.preferences.v1',value);dispatchEvent(new StorageEvent('storage',{key:'stanza.preferences.v1',newValue:value}));},{ar,width});
  await c.getByRole('button',{name:ar?'إضافة لوحات':'Add widgets',exact:true}).click();
  for(const [theme,style,light] of [['emerald','plain',false],['amethyst','topographic',false],['warm_sand','plain',false],['emerald','topographic',true]] as const){
   await p.evaluate(({theme,style,light})=>{localStorage.setItem('horizon-theme',light?'light':'dark');dispatchEvent(new StorageEvent('storage',{key:'horizon-theme',newValue:light?'light':'dark'}));const s=JSON.parse(localStorage.getItem('stanza.preferences.v1')!);s.backgroundPreset=theme;s.backgroundStyle=style;const value=JSON.stringify(s);localStorage.setItem('stanza.preferences.v1',value);dispatchEvent(new StorageEvent('storage',{key:'stanza.preferences.v1',newValue:value}));},{theme,style,light});
   assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert(await p.locator('.composer-dialog').evaluate((e:HTMLElement)=>e.scrollWidth<=e.clientWidth+1));matrix++;
  }
  if(ar&&width===390){shots.push(path.join(os.tmpdir(),'stanza-composer-v2-ar-mobile.png'));await p.screenshot({path:shots.at(-1)});}
  await p.keyboard.press('Escape');assert.equal(await c.getAttribute('dir'),ar?'rtl':'ltr');
 }
 await p.emulateMedia({reducedMotion:'reduce'});assert.equal(await c.locator('.composer-widget').first().evaluate((e:HTMLElement)=>getComputedStyle(e).animationName),'none');
 // Persist a protected shell, revoke permission, reload, and verify both server denial and no widget mount/fetch.
 await p.evaluate(()=>localStorage.setItem('__composer_test_language','en'));await p.reload();await open();await customize();await p.setViewportSize({width:1440,height:1000});
 await c.getByRole('button',{name:'Add widgets',exact:true}).click();await p.getByRole('button',{name:'Add Hiring Pipeline Summary',exact:true}).click();
 await f.db.query('DELETE FROM tenant_role_permissions WHERE tenant_id=$1 AND role_id=$2 AND permission_key=$3',[f.primary,actor.roleId,'hiring.view']);
 await p.reload();await open();await c.getByText('This widget is unavailable with your current permissions.',{exact:true}).waitFor();assert.equal((await f.api(actor,'/api/hiring/applicants')).status,403);
 const pwa=await f.browser.newContext({serviceWorkers:'allow'});await pwa.addCookies(await actor.context.cookies());const pp=await pwa.newPage();await pp.goto(f.base);await pp.waitForFunction(()=>Boolean(navigator.serviceWorker.controller),undefined,{timeout:15000});await pp.waitForTimeout(1000);await pp.reload();assert(await pp.evaluate(()=>Boolean(navigator.serviceWorker.controller)));const cached=await pp.evaluate(async()=>{const urls:string[]=[];for(const k of await caches.keys())for(const r of await (await caches.open(k)).keys())urls.push(r.url);return urls;});assert(!cached.some((u:string)=>new URL(u).pathname.startsWith('/api/')));await pwa.close();
 const foreign=await f.page(f.foreign);assert.equal(await foreign.evaluate((key:string)=>localStorage.getItem(key),key),null);
 const client=await actor.context.newCDPSession(p);await client.send('Performance.enable');const m1=(await client.send('Performance.getMetrics')).metrics;await p.waitForTimeout(1000);const m2=(await client.send('Performance.getMetrics')).metrics;
 console.log('Composer settled 1s:',Object.fromEntries(['LayoutCount','RecalcStyleCount','ScriptDuration'].map(n=>[n,m2.find((m:any)=>m.name===n).value-m1.find((m:any)=>m.name===n).value])));
 console.log('Gesture completion ms (18 real pointer steps; includes automation):',timings);
 assert.deepEqual(errors,[]);console.log(`PASS exact resize lifecycle, add/move/resize/configure/remove, mode, cancellation, persistence/logout, cross-module add, revocation/foreign scope, keyboard, reduced motion and ${matrix} RTL/responsive/theme checks`);
} finally {
 if(process.env.COMPOSER_KEEP_SHOTS!=='true')for(const shot of shots)await rm(shot,{force:true});
 await f.cleanup();
}
