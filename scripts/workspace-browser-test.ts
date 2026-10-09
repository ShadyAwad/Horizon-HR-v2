import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const base=process.env.BROWSER_BASE_URL||'http://localhost:3001';
assert(['localhost','127.0.0.1'].includes(new URL(base).hostname),'Use a local preview');
assert(process.env.BROWSER_ADMIN_PASSWORD,'BROWSER_ADMIN_PASSWORD required');
const {chromium}=createRequire(import.meta.url)(process.env.BROWSER_PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({channel:'msedge',headless:true});
const timings:Record<string,number[]>={};let matrix=0;
try{
 const auth=await browser.newContext();
 const login=await auth.request.post(base+'/api/auth/login',{headers:{Origin:base},data:{email:process.env.BROWSER_ADMIN_EMAIL||'admin@stanza-demo.com',password:process.env.BROWSER_ADMIN_PASSWORD}});
 assert.equal(login.status(),200,'Normal cookie authentication');const user=(await login.json()).user,cookies=await auth.cookies();
 const key=`stanza.composer.v1:${encodeURIComponent(user.tenantId)}:${encodeURIComponent(user.id)}`;
 for(const ar of [false,true]){
  const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});await context.addCookies(cookies);
  await context.addInitScript(({ar,key})=>{
   if(!localStorage.getItem('stanza.preferences.v1')){localStorage.setItem('stanza.preferences.v1',JSON.stringify({tutorialsAutoStart:false,lanyardEnabled:false}));localStorage.setItem('horizon-language',ar?'ar':'en');localStorage.setItem('stanza-demo-notice-seen','true');}
   if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify({version:1,activeId:'my-workspace',surface:'auto',workspaces:[{id:'my-workspace',name:'Workspace 1',widgets:[]}]}));
  },{ar,key});
  const page=await context.newPage();page.setDefaultTimeout(15000);
  const errors:string[]=[],apiErrors:string[]=[];page.on('pageerror',(e:Error)=>errors.push(e.message));page.on('response',(r:any)=>{if(new URL(r.url()).pathname.startsWith('/api/')&&r.status()>=400)apiErrors.push(`${r.status()} ${new URL(r.url()).pathname}`);});
  const text=(en:string,arabic:string)=>ar?arabic:en;
  const composer=page.locator('.composer');
  const saved=()=>page.evaluate((key:string)=>JSON.parse(localStorage.getItem(key)!),key);
  const measure=async(name:string,fn:()=>Promise<void>)=>{const start=Date.now();await fn();(timings[name]??=[]).push(Date.now()-start);};
  async function navigate(name:string){await page.locator('[data-tutorial-target="stanza-launcher"]').click();await page.locator('#stanza-navigation-panel .stanza-navigation-item').filter({hasText:name}).last().click();}
  const openComposer=async()=>{await navigate(text('Workspace Composer','منشئ مساحات العمل'));await composer.getByRole('tablist').waitFor();};
  async function manage(name:string){await composer.getByLabel(text('Manage workspace','إدارة مساحة العمل'),{exact:true}).click();await composer.locator('.composer-workspace-menu-content').getByRole('button',{name,exact:true}).click();}
  async function add(widget:string){await composer.getByRole('button',{name:text('+ Add Widget','+ إضافة لوحة'),exact:true}).first().click();await page.locator('.composer-library button').filter({has:page.getByText(widget,{exact:true})}).click();await composer.locator('.composer-widget').last().waitFor();}
  async function customize(){const button=composer.getByRole('button',{name:text('Customize Workspace','تخصيص المساحة'),exact:true});if(await button.count())await button.click();}
  await page.goto(base);await page.locator('[data-tutorial-target="stanza-launcher"]').waitFor();await openComposer();await composer.locator('.composer-empty').waitFor();
  await measure('create',()=>composer.getByRole('button',{name:text('New workspace','مساحة جديدة'),exact:true}).click());
  let state=await saved(),second=state.activeId;assert.equal(state.workspaces.length,2);assert.equal(state.workspaces[1].widgets.length,0);assert.equal(await composer.getByRole('tab',{selected:true}).textContent(),text('Workspace 2','مساحة العمل 2'));
  await composer.getByRole('tab',{name:'Workspace 1',exact:true}).click();
  await measure('switch',async()=>{await composer.getByRole('tab',{name:text('Workspace 2','مساحة العمل 2'),exact:true}).click();await page.waitForFunction(({key,second})=>JSON.parse(localStorage.getItem(key)!).activeId===second,{key,second});});
  await page.reload();await page.locator('[data-tutorial-target="stanza-launcher"]').waitFor();await openComposer();assert.equal(await composer.getByRole('tab').count(),2);assert.equal((await saved()).activeId,second);
  // Native tab arrows, Home/End, focus-visible, disclosure Escape and rename cancellation.
  await composer.getByRole('tab',{selected:true}).focus();await page.keyboard.press('Home');assert.equal((await saved()).activeId,'my-workspace');await page.keyboard.press('End');assert.equal((await saved()).activeId,second);
  await page.keyboard.press(ar?'ArrowRight':'ArrowLeft');assert.equal((await saved()).activeId,'my-workspace');await page.keyboard.press(ar?'ArrowLeft':'ArrowRight');assert.equal((await saved()).activeId,second);
  assert(await composer.getByRole('tab',{selected:true}).evaluate((e:HTMLElement)=>e.matches(':focus-visible')&&getComputedStyle(e).outlineStyle!=='none'));
  await composer.getByLabel(text('Manage workspace','إدارة مساحة العمل'),{exact:true}).click();await page.keyboard.press('Escape');assert.equal(await composer.locator('.composer-workspace-menu').getAttribute('open'),null);
  await manage(text('Rename','إعادة تسمية'));await page.getByLabel(text('Name','الاسم'),{exact:true}).fill('Canceled');await page.keyboard.press('Escape');assert.notEqual((await saved()).workspaces[1].name,'Canceled');
  await manage(text('Rename','إعادة تسمية'));const input=page.getByLabel(text('Name','الاسم'),{exact:true});await input.fill('   ');assert(await page.getByRole('button',{name:text('Save','حفظ'),exact:true}).isDisabled());await input.fill('  الفريق اليومي  ');await input.press('Enter');assert.equal((await saved()).workspaces[1].name,'الفريق اليومي');
  await measure('create',()=>composer.getByRole('button',{name:text('New workspace','مساحة جديدة'),exact:true}).click());
  const third=(await saved()).activeId;assert.equal((await saved()).workspaces.length,3);assert.equal((await saved()).workspaces.find((w:any)=>w.id===third).widgets.length,0);
  await composer.getByRole('tab',{name:'الفريق اليومي',exact:true}).click();
  await manage(text('Move earlier','نقل إلى البداية'));assert.equal((await saved()).workspaces[0].id,second);await page.reload();await page.locator('[data-tutorial-target="stanza-launcher"]').waitFor();await openComposer();assert.equal((await saved()).workspaces[0].id,second);
  await measure('add',()=>add(text('Attendance Status','حالة الحضور')));
  await composer.getByRole('tab',{name:'Workspace 1',exact:true}).click();await add(text('Company Feed','أخبار الشركة'));
  for(let i=0;i<5;i++){
   await measure('switch',async()=>{await composer.getByRole('tab',{name:'الفريق اليومي',exact:true}).click();await composer.locator('.composer-widget').waitFor();});assert.equal(await composer.locator('.composer-widget').count(),1);assert.equal((await saved()).workspaces.find((w:any)=>w.id===second).widgets[0].widgetId,'attendance');
   await composer.getByRole('tab',{name:'Workspace 1',exact:true}).click();assert.equal(await composer.locator('.composer-widget').count(),1);
  }
  await composer.getByRole('tab',{name:'الفريق اليومي',exact:true}).click();await customize();await composer.locator('.composer-widget-menu summary').click();
  await measure('remove',async()=>{await composer.locator('.composer-widget-menu').getByRole('button',{name:text('Remove','إزالة'),exact:true}).click();await composer.locator('.composer-empty').waitFor();});assert.equal(await composer.getByRole('tab').count(),3);assert.equal((await saved()).activeId,second);
  await page.reload();await page.locator('[data-tutorial-target="stanza-launcher"]').waitFor();await openComposer();await composer.locator('.composer-empty').waitFor();
  assert.equal((await saved()).activeId,second);assert.equal((await saved()).workspaces.find((w:any)=>w.id===second).widgets.length,0);
  // Picker search/domain state must not make a newly empty workspace look unavailable.
  await composer.getByRole('button',{name:text('+ Add Widget','+ إضافة لوحة'),exact:true}).first().click();
  await page.locator('.composer-dialog input').fill('no such widget');await page.locator('.composer-dialog select').selectOption('Hiring');await page.keyboard.press('Escape');
  await composer.locator('.composer-empty').getByRole('button').click();assert.equal(await page.locator('.composer-dialog input').inputValue(),'');assert.equal(await page.locator('.composer-dialog select').inputValue(),'');assert(await page.locator('.composer-library button').count());await page.keyboard.press('Escape');
  // Cross-module defaults and explicit destination are verified with real modules.
  const modules=ar?['عمليات الموقع','التوظيف','الدعم التقني والمعدات','التواصل','الأصول والمعدات']:['Geo-Operations','Hiring','IT & equipment support','Communications','Assets & Equipment'];
  for(const name of modules){await navigate(name);await page.getByRole('button',{name:text('Add to Workspace','إضافة إلى مساحة مخصصة'),exact:true}).first().click();const select=page.locator('.composer-dialog').getByLabel(text('Workspace','مساحة العمل'),{exact:true});assert.equal(await select.inputValue(),second);await page.locator('.composer-dialog').getByRole('button',{name:text('Add widget','إضافة لوحة'),exact:true}).click();assert.equal((await saved()).activeId,second);}
  await openComposer();assert.equal(await composer.locator('.composer-widget').count(),5);assert.equal((await saved()).workspaces.find((w:any)=>w.id==='my-workspace').widgets.length,1);
  await navigate(text('Assets & Equipment','الأصول والمعدات'));await page.getByRole('button',{name:text('Add to Workspace','إضافة إلى مساحة مخصصة'),exact:true}).first().click();
  await page.locator('.composer-dialog').getByLabel(text('Workspace','مساحة العمل'),{exact:true}).selectOption('my-workspace');await page.locator('.composer-dialog').getByRole('button',{name:text('Add widget','إضافة لوحة'),exact:true}).click();
  assert.equal((await saved()).activeId,second);assert.equal((await saved()).workspaces.find((w:any)=>w.id==='my-workspace').widgets.length,2);await openComposer();
  await customize();let card=composer.locator('.composer-widget').first();const original=(await saved()).workspaces.find((w:any)=>w.id===second).widgets[0];
  await measure('minimize',async()=>{await card.getByRole('button',{name:new RegExp('^'+text('Minimize','تصغير'))}).click();await card.locator('[hidden]').first().waitFor({state:'attached'});});assert.equal((await saved()).workspaces.find((w:any)=>w.id===second).widgets[0].collapsed,true);assert.equal((await saved()).workspaces.find((w:any)=>w.id===second).widgets[0].height,original.height);
  assert(await card.locator('.composer-widget-menu').count(),'Collapsed widgets retain management');
  await card.locator('.composer-widget-menu summary').click();await card.getByRole('button',{name:text('Configure','إعداد'),exact:true}).click();
  for(const [mode,en,arabic] of [['auto','Auto','تلقائي'],['solid','Solid','مصمت'],['transparent','Transparent','شفاف'],['glass','Glass','زجاجي']]){
   await page.locator('.composer-dialog').getByLabel(text('Panel surface','سطح اللوحات'),{exact:true}).click();
   assert(await page.locator('.composer-dialog [role=menu]').evaluate((e:HTMLElement)=>{const b=e.getBoundingClientRect();return b.left>=0&&b.right<=innerWidth;}));
   await page.getByRole('menuitemradio',{name:text(en,arabic),exact:true}).click();assert.equal((await saved()).workspaces.find((w:any)=>w.id===second).widgets[0].surfaceOverride,mode);
  }
  await page.locator('.composer-dialog').getByLabel(text('Workflow color','لون سير العمل'),{exact:true}).selectOption('purple');await page.keyboard.press('Escape');
  assert.equal((await saved()).workspaces.find((w:any)=>w.id===second).widgets[0].surfaceOverride,'glass');assert.equal((await saved()).workspaces.find((w:any)=>w.id===second).widgets[0].accent,'purple');
  await card.locator('.composer-widget-menu summary').click();
  await measure('restore',async()=>{await card.getByRole('button',{name:new RegExp('^'+text('Restore','استعادة'))}).click();await card.locator('.composer-widget-body').waitFor();});
  // Real pointer capture, layout commit and dimensions; no synthetic pointer events.
  const handle=card.locator('.composer-drag');await handle.scrollIntoViewIfNeeded();let box=await handle.boundingBox();assert(box);
  await measure('drag',async()=>{await page.mouse.move(box!.x+20,box!.y+20);await page.mouse.down();await page.mouse.move(box!.x+110,box!.y+100,{steps:12});await page.mouse.up();});
  let after=(await saved()).workspaces.find((w:any)=>w.id===second).widgets[0];assert(after.x!==original.x||after.y!==original.y,'Drag commits geometry');
  const resize=card.locator('.composer-resize');await resize.scrollIntoViewIfNeeded();box=await resize.boundingBox();assert(box);const beforeResize=after;
  await measure('resize',async()=>{await page.mouse.move(box!.x+10,box!.y+10);await page.mouse.down();await page.mouse.move(box!.x+95,box!.y+90,{steps:12});await page.mouse.up();});
  after=(await saved()).workspaces.find((w:any)=>w.id===second).widgets[0];assert(after.width!==beforeResize.width||after.height!==beforeResize.height,'Resize commits dimensions');
  await page.waitForTimeout(350);const filledSession=await context.newCDPSession(page);await filledSession.send('Performance.enable');const filledBefore=(await filledSession.send('Performance.getMetrics')).metrics;await page.waitForTimeout(1000);const filledAfter=(await filledSession.send('Performance.getMetrics')).metrics;
  console.log(ar?'Arabic filled normal-motion idle 1s':'English filled normal-motion idle 1s',Object.fromEntries(['TaskDuration','ScriptDuration','LayoutCount','RecalcStyleCount'].map(n=>[n,filledAfter.find((m:any)=>m.name===n).value-filledBefore.find((m:any)=>m.name===n).value])));
  // Duplicate creates independent identities, and switching preserves all saved layouts.
  await manage(text('Duplicate','نسخ'));state=await saved();assert.equal(state.workspaces.length,4);const duplicate=state.workspaces.find((w:any)=>w.id===state.activeId);assert.notEqual(duplicate.widgets[0].instanceId,state.workspaces.find((w:any)=>w.id===second).widgets[0].instanceId);await manage(text('Delete workspace','حذف المساحة'));await page.locator('.composer-dialog').getByRole('button',{name:text('Confirm','تأكيد'),exact:true}).click();
  await composer.getByRole('tab',{name:'الفريق اليومي',exact:true}).click();await customize();
  for(const theme of ['emerald','light','amethyst','custom'])for(const xl of [false,true])for(const width of [1440,820,390]){
   await page.setViewportSize({width,height:width===390?844:1000});
   await page.evaluate(({theme,xl})=>{localStorage.setItem('horizon-theme',theme==='light'?'light':'dark');dispatchEvent(new StorageEvent('storage',{key:'horizon-theme',newValue:theme==='light'?'light':'dark'}));const p=JSON.parse(localStorage.getItem('stanza.preferences.v1')!);p.backgroundPreset=theme==='light'?'emerald':theme;p.fontScale=xl?1.2:1;p.interfaceScale=xl?1.2:1;const value=JSON.stringify(p);localStorage.setItem('stanza.preferences.v1',value);dispatchEvent(new StorageEvent('storage',{key:'stanza.preferences.v1',newValue:value}));},{theme,xl});
   await page.evaluate(()=>document.fonts.ready);assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),theme==='light'?'light':'dark');assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),JSON.stringify({ar,theme,xl,width}));
   assert(await composer.locator('.composer-tabs').evaluate((e:HTMLElement)=>e.scrollWidth>=e.clientWidth&&e.clientWidth>0));
   await composer.getByLabel(text('Manage workspace','إدارة مساحة العمل'),{exact:true}).click();assert(await composer.locator('.composer-workspace-menu-content').evaluate((e:HTMLElement)=>{const b=e.getBoundingClientRect();return b.left>=-1&&b.right<=innerWidth+1;}));await page.keyboard.press('Escape');
   if(width<900)assert(!(await card.locator('.composer-resize').isVisible()),'Mobile uses saved stack and keyboard controls');
   if(theme==='emerald'&&!xl&&width===1440||theme==='light'&&xl&&width===390)await page.screenshot({path:process.env.TEMP+`/stanza-composer-after-${ar?'ar':'en'}-${width}.png`,fullPage:true});matrix++;
  }
  await page.setViewportSize({width:1440,height:1000});await card.scrollIntoViewIfNeeded();await card.screenshot({path:process.env.TEMP+`/stanza-composer-widget-${ar?'ar':'en'}.png`});
  // Many and long names fit the bounded strip; active tab stays within view.
  for(let i=0;i<7;i++)await composer.getByRole('button',{name:text('New workspace','مساحة جديدة'),exact:true}).click();
  await manage(text('Rename','إعادة تسمية'));await page.getByLabel(text('Name','الاسم'),{exact:true}).fill('مساحة عمل طويلة للفريق ومتابعة الأعمال اليومية المشتركة');await page.keyboard.press('Enter');
  assert.equal((await saved()).workspaces.length,10);assert(await composer.getByRole('button',{name:text('New workspace','مساحة جديدة'),exact:true}).isDisabled());assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.waitForFunction(()=>{const e=document.querySelector('.composer [role=tab][aria-selected=true]');if(!e)return false;const a=e.getBoundingClientRect(),b=e.parentElement!.getBoundingClientRect();return a.left>=b.left-1&&a.right<=b.right+1;});
  await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await composer.locator('.composer-panel').evaluate((e:HTMLElement)=>getComputedStyle(e).animationName),'none');
  // Delete all: last deletion resets a usable default rather than leaving no workspace.
  while((await saved()).workspaces.length>1){await manage(text('Delete workspace','حذف المساحة'));await page.locator('.composer-dialog').getByRole('button',{name:text('Confirm','تأكيد'),exact:true}).click();}
  await manage(text('Delete workspace','حذف المساحة'));await page.locator('.composer-dialog').getByRole('button',{name:text('Confirm','تأكيد'),exact:true}).click();assert.equal((await saved()).workspaces.length,1);await composer.locator('.composer-empty').waitFor();assert.equal(await composer.getByRole('tab').count(),1);
  const session=await context.newCDPSession(page);await session.send('Performance.enable');const before=(await session.send('Performance.getMetrics')).metrics;await page.waitForTimeout(1000);const afterMetrics=(await session.send('Performance.getMetrics')).metrics;console.log(ar?'Arabic settled idle 1s':'English settled idle 1s',Object.fromEntries(['TaskDuration','ScriptDuration','LayoutCount','RecalcStyleCount'].map(n=>[n,afterMetrics.find((m:any)=>m.name===n).value-before.find((m:any)=>m.name===n).value])));
  assert.deepEqual(errors,[],'No browser exceptions');assert.deepEqual(apiErrors,[],'Real widget/API requests succeed');await context.close();
 }
 console.log(`PASS real workspace flow, cross-module additions, tab keyboard/focus, gestures, persistence, empty and last-workspace behavior; ${matrix} responsive/RTL/theme/scale combinations`);
 console.log('Measured action completion latency (Playwright interaction + DOM/storage commit; not FPS)',Object.fromEntries(Object.entries(timings).map(([name,times])=>{const sorted=[...times].sort((a,b)=>a-b);return [name,{samples:times.length,p50:sorted[Math.floor(sorted.length*.5)],p95:sorted[Math.min(sorted.length-1,Math.floor(sorted.length*.95))]}];})));
}finally{await browser.close();}