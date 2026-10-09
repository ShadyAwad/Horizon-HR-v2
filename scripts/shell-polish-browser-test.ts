import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const base=process.env.BROWSER_BASE_URL||'http://localhost:3001';
assert(['localhost','127.0.0.1'].includes(new URL(base).hostname));assert(process.env.BROWSER_ADMIN_PASSWORD);
const {chromium}=createRequire(import.meta.url)(process.env.BROWSER_PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,channel:'msedge'});let combinations=0;
const paints=new Map<string,string>();
try{
 const auth=await browser.newContext();const login=await auth.request.post(base+'/api/auth/login',{data:{email:'admin@stanza-demo.com',password:process.env.BROWSER_ADMIN_PASSWORD}});assert.equal(login.status(),200);const cookies=await auth.cookies();
 for(const ar of [false,true])for(const mode of ['launcher','rail']){
  const c=await browser.newContext({viewport:{width:1440,height:900}});await c.addCookies(cookies);
  await c.addInitScript(({ar,mode})=>{localStorage.setItem('stanza.preferences.v1',JSON.stringify({tutorialsAutoStart:false,lanyardEnabled:false,desktopNavigationMode:mode}));localStorage.setItem('horizon-language',ar?'ar':'en');localStorage.setItem('stanza-demo-notice-seen','true');},{ar,mode});
  const p=await c.newPage();p.setDefaultTimeout(15000);const errors:string[]=[];p.on('pageerror',(e:Error)=>errors.push(e.message));await p.goto(base);await p.locator('[data-dashboard-context-header]').waitFor();
  for(const [width,height] of [[1440,900],[820,700],[390,844],[1024,360]])for(const theme of ['emerald','light','amethyst']){
   await p.setViewportSize({width,height});await p.evaluate(({theme,width})=>{const value=JSON.stringify({...JSON.parse(localStorage.getItem('stanza.preferences.v1')!),backgroundPreset:theme==='light'?'emerald':theme,fontScale:width===390?1.2:1});localStorage.setItem('stanza.preferences.v1',value);dispatchEvent(new StorageEvent('storage',{key:'stanza.preferences.v1',newValue:value}));localStorage.setItem('horizon-theme',theme==='light'?'light':'dark');dispatchEvent(new StorageEvent('storage',{key:'horizon-theme',newValue:theme==='light'?'light':'dark'}));},{theme,width});await p.evaluate(()=>document.fonts.ready);await p.waitForTimeout(350);
   assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   const launch=p.locator('[data-tutorial-target="stanza-launcher"]');const before=await launch.boundingBox();assert(before);
   const paint=await launch.evaluate((e:HTMLElement)=>getComputedStyle(e).backgroundColor),key=JSON.stringify({ar,theme,width});if(mode==='launcher')paints.set(key,paint);else assert.equal(paint,paints.get(key),'launcher color is independent of rail mode');
   const actions=p.locator('[data-dashboard-context-header] .stanza-page-header-actions');assert(await actions.isVisible());assert(await actions.evaluate((e:HTMLElement)=>{const b=e.getBoundingClientRect();return b.left>=-1&&b.right<=innerWidth+1;}));
   const mark=p.locator('[data-dashboard-context-header] .stanza-brand-neon');assert(await mark.evaluate((e:HTMLElement)=>{const style=getComputedStyle(e);const actual=style.color;const previous=e.style.color;e.style.color='var(--stanza-accent-hover)';const expected=getComputedStyle(e).color;e.style.color=previous;return actual===expected&&style.textShadow!=='none';}),'brand S follows the same theme source as Login');
   if(width>=768){const wordmark=await mark.locator('..').boundingBox();assert(wordmark);assert(wordmark.x+wordmark.width<=before.x||before.x+before.width<=wordmark.x,'portal launcher cannot overlap the wordmark');}
   assert.equal(await mark.locator('..').evaluate((e:HTMLElement)=>getComputedStyle(e).direction),'ltr','Latin wordmark preserves letter order in RTL');const rect=await mark.boundingBox();await mark.evaluate((e:HTMLElement)=>e.setAttribute('data-neon-power','dip'));assert.equal(await mark.evaluate((e:HTMLElement)=>getComputedStyle(e).animationName),'none');assert.deepEqual(await mark.boundingBox(),rect,'flicker never changes layout');await mark.evaluate((e:HTMLElement)=>e.removeAttribute('data-neon-power'));
   if(mode==='rail'&&width>=768){const rail=p.locator('.stanza-rail-scroll');assert(await rail.evaluate((e:HTMLElement)=>getComputedStyle(e).overflowY==='auto'));const last=rail.getByRole('button').last();await p.keyboard.press('Tab');await last.focus();assert(await last.evaluate((e:HTMLElement)=>e.matches(':focus-visible')&&getComputedStyle(e).outlineStyle!=='none'));
    assert(await rail.evaluate((e:HTMLElement)=>{const last=e.lastElementChild!.getBoundingClientRect(),box=e.getBoundingClientRect();return last.top>=box.top-1&&last.bottom<=box.bottom+1;}));
    assert(await p.locator('.stanza-desktop-rail').getByRole('button',{name:ar?'الإعدادات':'Settings',exact:true}).isVisible());
    const after=await launch.boundingBox();assert.equal(after!.y,before.y);assert.equal(after!.x,before.x);
    if(height===360){assert(await rail.evaluate((e:HTMLElement)=>e.scrollHeight>e.clientHeight));await rail.getByRole('button').first().focus();assert(await rail.evaluate((e:HTMLElement)=>e.scrollTop<10));}
   }
   combinations++;
  }
  await p.setViewportSize({width:1440,height:900});
  await p.locator('[data-tutorial-target="stanza-launcher"]').click();await p.locator('#stanza-navigation-panel .stanza-navigation-item').filter({hasText:ar?'عمليات الموقع':'Geo-Operations'}).last().click();
  const add=p.getByRole('button',{name:ar?'إضافة إلى مساحة مخصصة':'Add to Workspace',exact:true}).first();await add.click();await p.locator('.composer-dialog').waitFor();await p.keyboard.press('Escape');assert(await add.evaluate((e:HTMLElement)=>document.activeElement===e));
  await p.locator('[data-tutorial-target="stanza-launcher"]').click();await p.locator('#stanza-navigation-panel .stanza-navigation-item').filter({hasText:ar?'طلبات الاستقالة':'Resignations'}).last().click();await p.locator('[data-dashboard-context-header] .stanza-page-header-actions').waitFor();
  const back=p.locator('.stanza-history-controls button[data-direction=back]');await back.hover();await p.waitForTimeout(180);assert.equal(await back.locator('svg').evaluate((e:SVGElement)=>new DOMMatrixReadOnly(getComputedStyle(e).transform).m41),ar?2:-2);
  await p.keyboard.press('Tab');await back.focus();assert.equal(await back.evaluate((e:HTMLElement)=>getComputedStyle(e).outlineStyle),'solid');
  await p.emulateMedia({reducedMotion:'reduce'});assert.equal(await back.locator('svg').evaluate((e:SVGElement)=>getComputedStyle(e).transform),'none');const mark=p.locator('[data-dashboard-context-header] .stanza-brand-neon');await mark.evaluate((e:HTMLElement)=>e.setAttribute('data-neon-power','dip'));assert.equal(await mark.evaluate((e:HTMLElement)=>getComputedStyle(e).animationName),'none');assert.equal(await mark.evaluate((e:HTMLElement)=>getComputedStyle(e).opacity),'1');assert.notEqual(await mark.evaluate((e:HTMLElement)=>getComputedStyle(e).textShadow),'none');await mark.evaluate((e:HTMLElement)=>e.removeAttribute('data-neon-power'));
  await p.screenshot({path:process.env.TEMP+`/stanza-shell-polish-${ar?'ar':'en'}-${mode}.png`});assert.deepEqual(errors,[]);await c.close();
 }
 // Screenshots at real device pixel ratios, with a DOM state hook used only by this test.
 for(const dpr of [1,2])for(const theme of ['emerald','light','custom'])for(const scale of [1,1.2]){
  const c=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:dpr});await c.addCookies(cookies);
  await c.addInitScript(({theme,scale})=>{localStorage.setItem('stanza.preferences.v1',JSON.stringify({tutorialsAutoStart:false,lanyardEnabled:false,desktopNavigationMode:'rail',interfaceScale:scale,backgroundPreset:theme==='light'?'emerald':theme,customAccent:'#a855f7',customTheme:{accent:'#a855f7'}}));localStorage.setItem('horizon-theme',theme==='light'?'light':'dark');localStorage.setItem('stanza-demo-notice-seen','true');},{theme,scale});
  const p=await c.newPage();await p.goto(base);const mark=p.locator('[data-dashboard-context-header] .stanza-brand-neon');await mark.waitFor();await p.evaluate(()=>document.fonts.ready);await p.waitForTimeout(350);
  const wordmark=mark.locator('..');const box=(await wordmark.boundingBox())!;const clip={x:Math.max(0,box.x-12),y:Math.max(0,box.y-12),width:box.width+24,height:box.height+24};
  const original=await mark.evaluate((e:HTMLElement)=>getComputedStyle(e).color);
  for(const state of ['stable','dip','recovered','reduced']){
   if(state==='reduced')await p.emulateMedia({reducedMotion:'reduce'});
   await mark.evaluate((e:HTMLElement)=>e.removeAttribute('data-neon-power'));
   if(['dip','reduced'].includes(state))await mark.evaluate((e:HTMLElement,state:string)=>e.setAttribute('data-neon-power',state==='reduced'?'dip':state),state);
   assert.deepEqual(await wordmark.boundingBox(),box);
   assert.equal(await mark.evaluate((e:HTMLElement)=>getComputedStyle(e).color),original);
   assert.equal(await mark.evaluate((e:HTMLElement)=>getComputedStyle(e).opacity),state==='dip'?'0.45':'1');
   assert.equal(await mark.evaluate((e:HTMLElement)=>getComputedStyle(e).animationName),'none');
   assert.equal(await mark.locator('svg').count(),0);
   await p.screenshot({path:process.env.TEMP+`/stanza-neon-${theme}-${scale}-${dpr}x-${state}.png`,clip});
  }
  await p.emulateMedia({reducedMotion:'no-preference'});await p.locator('[data-tutorial-target="stanza-launcher"]').click();const expanded=p.locator('#stanza-navigation-panel .stanza-brand-neon');await expanded.waitFor();assert.equal(await expanded.textContent(),'S');assert.notEqual(await expanded.evaluate((e:HTMLElement)=>getComputedStyle(e).textShadow),'none');await expanded.locator('..').screenshot({path:process.env.TEMP+`/stanza-neon-expanded-${theme}-${scale}-${dpr}x.png`});await expanded.evaluate((e:HTMLElement)=>e.setAttribute('data-neon-power','dip'));assert.equal(await expanded.evaluate((e:HTMLElement)=>getComputedStyle(e).opacity),'0.45');await expanded.locator('..').screenshot({path:process.env.TEMP+`/stanza-neon-expanded-${theme}-${scale}-${dpr}x-dip.png`});assert.equal(await wordmark.locator('span').last().evaluate((e:HTMLElement)=>getComputedStyle(e).textShadow),'none');await c.close();
 }
 console.log('PASS 1x/2x neon close-ups: dark/light/custom purple, normal/XL interface scale, stable/dip/recovered/reduced motion, compact and expanded navigation');
 console.log(`PASS ${combinations} shell combinations: desktop/tablet/mobile/short viewport, RTL/XL fonts, light/green/purple; anchored actions, stable launcher paint, rail scrolling/focus, bounded neon and reduced motion; Attendance/Resignations navigation`);
}finally{await browser.close();}
