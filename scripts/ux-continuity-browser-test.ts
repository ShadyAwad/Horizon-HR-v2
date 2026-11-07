import assert from 'node:assert/strict';
import path from 'node:path';
import {BusinessFixtures} from './business-scenario-fixtures';
import {moduleContinuityKey} from '../src/components/navigation/useModuleContinuity';
const f=new BusinessFixtures();
try {
 await f.setup('ux-continuity');
 const p=await f.page(f.admin),key=moduleContinuityKey(f.primary,f.admin.id);
 assert.equal(await p.locator('[data-module-resume]').count(),0,'first use has no prompt');
 await p.addInitScript(()=>{(window as any).__moduleFrames=[];let n=0;const sample=()=>{const root=document.querySelector('.stanza-dashboard'),main=root?.querySelector('main');if(main&&getComputedStyle(root!).visibility==='visible')(window as any).__moduleFrames.push(main.getAttribute('data-tutorial-target'));if(++n<90)requestAnimationFrame(sample);};requestAnimationFrame(sample);});
 for(const name of ['Hiring','Locations']) {
  await f.navigate(p,name);const target=await p.locator('main').getAttribute('data-tutorial-target');
  const id=name.toLowerCase();await p.waitForFunction(({key,id})=>localStorage.getItem(key)===id,{key,id});
  await p.reload();await p.locator('.stanza-dashboard:visible').waitFor();await p.waitForTimeout(200);
  assert.equal(await p.locator('main').getAttribute('data-tutorial-target'),target);
  assert((await p.evaluate(()=>(window as any).__moduleFrames)).every((v:string)=>v===target),'no default module paint before restored destination');
 }
 async function signIn(actor:any,page=p) {
  await page.locator('input[type=email]').fill(actor.email);await page.locator('input[type=password]').fill(f.password);
  await page.locator('button[type=submit]').first().click();await page.locator('[data-tutorial-target=stanza-launcher]').waitFor();
 }
 async function logout() {assert.equal((await p.request.post(f.base+'/api/auth/logout',{headers:{Origin:f.base},data:{}})).status(),200);await p.reload();await p.locator('input[type=email]').waitFor();}
 await logout();await signIn(f.admin);const resume=p.locator('[data-module-resume]');await resume.waitFor();assert.match(await resume.innerText(),/Locations/);
 await resume.getByRole('button',{name:'Continue',exact:true}).click();assert.equal(await resume.count(),0);assert.equal(await p.evaluate(key=>localStorage.getItem(key),key),'locations');
 await logout();await signIn(f.admin);await resume.waitFor();await resume.getByRole('button',{name:'Dashboard / Start here',exact:true}).click();
 await f.navigate(p,'Hiring');await f.navigate(p,'Geo-Operations');assert.equal(await resume.count(),0,'handled prompt does not nag after navigation');
 await f.navigate(p,'Hiring');await logout();await signIn(f.employee);assert.equal(await resume.count(),0,'different persona has no inherited destination');
 assert.equal(await p.locator('.hiring-panel').count(),0);await logout();await signIn(f.admin);await resume.waitFor();await resume.getByRole('button',{name:'Continue',exact:true}).click();
 await f.db.query("DELETE FROM tenant_role_permissions WHERE tenant_id=$1 AND role_id=$2 AND permission_key='hiring.view'",[f.primary,f.admin.roleId]);
 await p.reload();await p.locator('[data-tutorial-target=stanza-launcher]').waitFor();assert.equal(await p.locator('.hiring-panel').count(),0);assert.equal(await resume.count(),0);
 assert.notEqual(await p.evaluate(key=>localStorage.getItem(key),key),'hiring');assert.equal((await f.api(f.admin,'/api/hiring/applicants')).status,403);
 for(const bad of ['unknown','hiring?candidate=private','{"module":"hiring"}']) {await p.evaluate(({key,bad})=>localStorage.setItem(key,bad),{key,bad});await p.reload();await p.locator('[data-tutorial-target=stanza-launcher]').waitFor();assert.equal(await resume.count(),0);assert.equal(await p.locator('.hiring-panel').count(),0);}
 await f.navigate(p,'Semantic Intelligence');const semanticTarget=await p.locator('main').getAttribute('data-tutorial-target');
 await p.waitForFunction(key=>localStorage.getItem(key)==='semanticIntelligence',key);
 await p.route('**/api/semantic-intelligence/capabilities',async route=>{await new Promise(resolve=>setTimeout(resolve,250));await route.continue();});
 await p.reload();await p.locator('.stanza-dashboard:visible').waitFor();assert.equal(await p.locator('main').getAttribute('data-tutorial-target'),semanticTarget);assert((await p.evaluate(()=>(window as any).__moduleFrames)).every((v:string)=>v===semanticTarget),'asynchronous capabilities validated before restore paints');
 const arabic=await f.browser.newContext({viewport:{width:390,height:1000},serviceWorkers:'block',reducedMotion:'reduce'});
 await arabic.addInitScript(({key})=>{localStorage.setItem(key,'locations');localStorage.setItem('horizon-language','ar');localStorage.setItem('stanza-demo-notice-seen','true');localStorage.setItem('stanza.preferences.v1',JSON.stringify({tutorialsAutoStart:false,lanyardEnabled:false}));},{key});
 const ap=await arabic.newPage();await ap.goto(f.base);await signIn(f.admin,ap);const arResume=ap.locator('[data-module-resume]');await arResume.waitFor();assert.equal(await arResume.getAttribute('dir'),'rtl');assert.match(await arResume.innerText(),/هل تريد المتابعة/);assert(await ap.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));if(process.env.UX_ARTIFACT_DIR)await ap.screenshot({path:path.join(process.env.UX_ARTIFACT_DIR,'resume-ar-390.png')});await arResume.getByRole('button',{name:'ابدأ هنا',exact:true}).click();await arabic.close();
 console.log('PASS account/tenant scoped module-only persistence; Hiring/Locations reload without default paint; fresh login resume/start once; persona separation; revoked/corrupt destination and API denial; Arabic/mobile resume');
 await p.close();
 for(const preset of ['warm_sand','amethyst','emerald','graphite','custom','light']) for(const width of [390,820,1440]) {
  const c=await f.browser.newContext({viewport:{width,height:1000},serviceWorkers:'block',reducedMotion:width===390?'reduce':'no-preference'});
  await c.addInitScript(({preset})=>{localStorage.setItem('stanza-demo-notice-seen','true');localStorage.setItem('horizon-language','en');localStorage.setItem('horizon-theme',preset==='light'?'light':'dark');localStorage.setItem('stanza.preferences.v1',JSON.stringify({backgroundPreset:preset==='light'?'emerald':preset,customTheme:{accent:'#c56828'},tutorialsAutoStart:false,lanyardEnabled:false}));},{preset});
  const page=await c.newPage();page.setDefaultTimeout(15000);await page.goto(f.base);await page.getByRole('button',{name:/^Use Demo Account/}).click();const rows=page.locator('#demo-account-panel button');assert.equal(await rows.count(),4);
  for(const row of await rows.all()) {
   await row.scrollIntoViewIfNeeded();await page.mouse.move(1,1);await page.waitForTimeout(190);const rect=await row.boundingBox(),idle=await row.evaluate(e=>({bg:getComputedStyle(e).backgroundColor,border:getComputedStyle(e).borderColor}));
   await row.hover();await page.waitForTimeout(190);const hover=await row.evaluate(e=>({bg:getComputedStyle(e).backgroundColor,border:getComputedStyle(e).borderColor}));assert.notDeepEqual(hover,idle,'visible tonal/border hover');assert.deepEqual(await row.boundingBox(),rect,'hover preserves geometry');
   if(process.env.UX_ARTIFACT_DIR&&preset==='warm_sand'&&width===390)await page.screenshot({path:path.join(process.env.UX_ARTIFACT_DIR,'login-hover-390.png')});
   await page.mouse.move(1,1);await page.keyboard.press('Tab');await row.focus();assert(await row.evaluate(e=>e.matches(':focus-visible')&&getComputedStyle(e).outlineStyle!=='none'),'visible keyboard focus');
   await row.evaluate((e:HTMLElement)=>e.blur());await page.waitForTimeout(190);assert.deepEqual(await row.evaluate(e=>({bg:getComputedStyle(e).backgroundColor,border:getComputedStyle(e).borderColor})),idle,'mouse leave returns cleanly');
   if(width===390)assert.equal(await row.evaluate(e=>getComputedStyle(e).transitionDuration),'0s');
  }
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await c.close();
 }
 console.log('PASS all four demo row hover/focus/reduced motion/no geometry shift: six themes × 390/820/1440');
 for(const ar of [false,true]) for(const width of [390,820,1440,1920]) {
  const c=await f.browser.newContext({viewport:{width,height:1000},serviceWorkers:'block',reducedMotion:ar?'reduce':'no-preference'});await c.addCookies(await f.admin.context.cookies());
  await c.addInitScript(({ar})=>{localStorage.setItem('horizon-language',ar?'ar':'en');localStorage.setItem('stanza-demo-notice-seen','true');localStorage.setItem('stanza.preferences.v1',JSON.stringify({backgroundPreset:'amethyst',fontScale:1.2,interfaceScale:1.2,tutorialsAutoStart:false,lanyardEnabled:false}));},{ar});
  const page=await c.newPage();page.setDefaultTimeout(15000);await page.goto(f.base);await page.locator('[data-tutorial-target=stanza-launcher]').waitFor();
  const trigger=page.locator('.stanza-surface-trigger').first(),docWidth=await page.evaluate(()=>document.documentElement.scrollWidth);await trigger.click();const menu=page.locator('.stanza-surface-menu');await menu.waitFor();await page.waitForTimeout(350);
  const bounds=await menu.boundingBox();assert(bounds!.x>=11&&bounds!.x+bounds!.width<=width-11,'safe viewport margins');
  if(!ar&&width===390){const legacy=await page.addStyleTag({content:'.stanza-surface-options{display:flex;overflow-x:auto}.stanza-surface-options>button{flex:1 0 auto;padding-inline:10px;gap:7px;font-size:var(--text-sm)}'});assert(await page.locator('.stanza-surface-options').evaluate(e=>e.scrollWidth>e.clientWidth),'positive control reproduces original non-shrinking scroll rail');await legacy.evaluate(e=>e.remove());}
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),docWidth);
  for(const el of [menu,page.locator('.stanza-surface-options')])assert(await el.evaluate(e=>e.scrollWidth<=e.clientWidth+1),'no remaining content overflow or scroll rail');
  for(const button of await menu.getByRole('menuitemradio').all()) {assert(await button.locator('span').first().evaluate(e=>e.scrollWidth<=e.clientWidth+1),'label fits');await button.click();assert(await menu.isVisible());assert.deepEqual(await menu.boundingBox(),bounds,'selection has no width jump');assert.equal(await button.getAttribute('aria-checked'),'true');}
  const x=menu.locator('.stanza-surface-close');assert.equal(await x.locator('svg').evaluate(e=>getComputedStyle(e).width),'14px');const hit=await x.boundingBox();assert(hit!.width>=32&&hit!.height>=40);
  assert.equal(await x.evaluate(e=>getComputedStyle(e).borderTopColor),'rgba(0, 0, 0, 0)','quiet idle close has no framed square');
  const glyph=await x.locator('svg').boundingBox();assert(glyph!.x>=hit!.x&&glyph!.x+glyph!.width<=hit!.x+hit!.width,'close glyph fits accessible target');
  if(process.env.UX_ARTIFACT_DIR&&(width===390||width===1440))await page.screenshot({path:path.join(process.env.UX_ARTIFACT_DIR,`surface-${ar?'ar':'en'}-${width}.png`)});
  await x.click();await menu.waitFor({state:'hidden'});assert(await trigger.evaluate(e=>e===document.activeElement));
  await trigger.click();await page.keyboard.press('Escape');await menu.waitFor({state:'hidden'});assert(await trigger.evaluate(e=>e===document.activeElement));
  await trigger.click();await page.waitForTimeout(350);await page.mouse.click(width-2,950);await menu.waitFor({state:'hidden'});assert(await trigger.evaluate(e=>e===document.activeElement));
  await c.close();
 }
 console.log('PASS surface tray content fits; four choices stay open; stable geometry; compact accessible X; Escape/outside/X focus return; eight RTL/XL120%/viewport combinations');
} finally {await f.cleanup();}
