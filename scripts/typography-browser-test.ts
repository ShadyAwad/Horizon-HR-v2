import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {FONT_PROFILES} from '../src/lib/typography';
const base=process.env.BROWSER_BASE_URL||'http://localhost:3001';
assert(['localhost','127.0.0.1'].includes(new URL(base).hostname),'Use a local preview');
const password=process.env.BROWSER_ADMIN_PASSWORD;
if(!password)throw Error('BROWSER_ADMIN_PASSWORD required; no credentials are stored in this test');
const {chromium}=createRequire(import.meta.url)(process.env.BROWSER_PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({channel:'msedge',headless:true});
const fontTimes:number[]=[];const navigationTimes:number[]=[];
let matrix=0;
try {
 const auth=await browser.newContext();
 const login=await auth.request.post(base+'/api/auth/login',{headers:{Origin:base},data:{email:process.env.BROWSER_ADMIN_EMAIL||'admin@stanza-demo.com',password}});
 assert.equal(login.status(),200,'Normal cookie login');
 const cookies=await auth.cookies();
 for(const ar of [false,true]) {
  const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'allow'});
  await context.addCookies(cookies);
  await context.addInitScript(({ar})=>{if(!localStorage.getItem('stanza.preferences.v1')){localStorage.setItem('stanza.preferences.v1',JSON.stringify({tutorialsAutoStart:false,lanyardEnabled:false}));localStorage.setItem('horizon-language',ar?'ar':'en');localStorage.setItem('stanza-demo-notice-seen','true');}},{ar});
  const page=await context.newPage();page.setDefaultTimeout(15000);
  const apiErrors:string[]=[];
  page.on('response',(response:any)=>{const url=new URL(response.url());if(url.pathname.startsWith('/api/')&&response.status()>=400)apiErrors.push(response.status()+' '+url.pathname);});
  const errors:string[]=[];page.on('pageerror',(e:Error)=>errors.push(e.message));
  await page.goto(base);await page.locator('[data-tutorial-target="stanza-launcher"]').waitFor();
  async function appearance() {
   await page.keyboard.press('Control+k');
   await page.locator('.stanza-command-palette input').first().fill(ar?'فتح المظهر':'Open Appearance');
   await page.locator('.stanza-command-palette [role=option]').filter({hasText:ar?'فتح المظهر':'Open Appearance'}).click();
   await page.getByLabel(ar?'نوع الخط':'Font family',{exact:true}).waitFor();
  }
  const initial=await page.evaluate(()=>performance.getEntriesByType('resource').filter((r:any)=>/\.woff2/.test(r.name)).map((r:any)=>({file:r.name.split('/').pop(),bytes:r.encodedBodySize})));
  console.log(ar?'Arabic initial fonts':'English initial fonts',initial);
  if(!ar) assert(!initial.some((r:any)=>/plex|manrope|noto/.test(r.file)),'Unused font choices must not load on English startup');
  await appearance();
  for(const profile of FONT_PROFILES) {
   const start=Date.now();await page.getByLabel(ar?'نوع الخط':'Font family',{exact:true}).selectOption(profile.id);await page.evaluate(()=>document.fonts.ready);fontTimes.push(Date.now()-start);
   assert.equal(await page.evaluate(()=>document.documentElement.dataset.fontProfile),profile.id);
   assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('stanza.preferences.v1')!).fontProfile),profile.id);
   // A real theme switch must preserve family selection.
   for(const theme of ['emerald','light','amethyst','custom']) {
    const mode=await page.evaluate(()=>document.documentElement.dataset.theme);
    if((theme==='light')!==(mode==='light'))await page.getByRole('button',{name:ar?(mode==='light'?'التبديل إلى الوضع الداكن':'التبديل إلى الوضع الفاتح'):(mode==='light'?'Switch to Dark Mode':'Switch to Light Mode'),exact:true}).click();
    const preset=theme==='light'?'emerald':theme;
    // Existing cross-tab preference synchronization applies full custom-theme
    // derivation and React consumers, not just a manually painted root.
    await page.evaluate(({preset})=>{const p=JSON.parse(localStorage.getItem('stanza.preferences.v1')!);p.backgroundPreset=preset;const value=JSON.stringify(p);localStorage.setItem('stanza.preferences.v1',value);dispatchEvent(new StorageEvent('storage',{key:'stanza.preferences.v1',newValue:value}));},{preset});
    assert.equal(await page.evaluate(()=>document.documentElement.dataset.fontProfile),profile.id);
    for(const xl of [false,true]) {
     await page.evaluate(({xl})=>{const p=JSON.parse(localStorage.getItem('stanza.preferences.v1')!);p.fontScale=xl?1.2:1;p.interfaceScale=xl?1.2:1;const value=JSON.stringify(p);localStorage.setItem('stanza.preferences.v1',value);dispatchEvent(new StorageEvent('storage',{key:'stanza.preferences.v1',newValue:value}));},{xl});
     for(const width of [1440,820,390]) {
      await page.setViewportSize({width,height:width===390?844:1000});await page.evaluate(()=>document.fonts.ready);
      const result=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,panels:[...document.querySelectorAll('.stanza-control-center-panel,.stanza-font-settings')].map(e=>({client:e.clientWidth,scroll:e.scrollWidth}))}));
      assert(result.scroll<=result.width+1,JSON.stringify({ar,profile:profile.id,theme,xl,width,result}));
      assert(result.panels.every(p=>p.scroll<=p.client+1),'Appearance controls must fit');
      if(theme==='custom') {
       const clipped=await page.evaluate(()=>{const editor=document.querySelector('.stanza-custom-editor');if(!editor)return false;const bounds=editor.getBoundingClientRect();return [...editor.children].some(e=>{const r=e.getBoundingClientRect();return r.left<bounds.left-1||r.right>bounds.right+1;});});
       assert(!clipped,'Custom-theme grid children must fit without hidden clipping');
      }
      assert.equal(await page.evaluate(()=>document.documentElement.dir),ar?'rtl':'ltr');
      matrix++;
     }
    }
   }
  }
  // UI-selected family survives a real reload with independent scales/theme.
  await page.getByLabel(ar?'نوع الخط':'Font family',{exact:true}).selectOption('technical');
  await page.reload();await page.locator('[data-tutorial-target="stanza-launcher"]').waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.fontProfile),'technical');
  await page.setViewportSize({width:ar?390:1440,height:ar?844:1000});
  const names=ar?['الملف الشخصي','عمليات الموقع','الجدول الأسبوعي','منشورات الشركة','التوظيف','الدعم التقني والمعدات','الذكاء الدلالي','منشئ مساحات العمل']:['Profile','Geo-Operations','Weekly Roster','Company Feed','Hiring','IT & equipment support','Semantic Intelligence','Workspace Composer'];
  // Match localized module labels by index from the English/Arabic navigation
  // contract; use stable visible English terms only when language retains them.
  for(const family of FONT_PROFILES) {
   await page.evaluate(({id,ar})=>{const p=JSON.parse(localStorage.getItem('stanza.preferences.v1')!);p.fontProfile=id;p.fontScale=ar?1.2:1;p.interfaceScale=ar?1.2:1;const value=JSON.stringify(p);localStorage.setItem('stanza.preferences.v1',value);dispatchEvent(new StorageEvent('storage',{key:'stanza.preferences.v1',newValue:value}));},{id:family.id,ar});
  for(const name of names) {
   await page.locator('[data-tutorial-target="stanza-launcher"]').click();
   const items=page.locator('#stanza-navigation-panel .stanza-navigation-item');
   const target=items.filter({hasText:name}).last();
   if(!await target.count())throw Error('Missing localized navigation item: '+name+'; available '+await items.allTextContents());
   const start=Date.now();await target.click();await page.waitForTimeout(450);navigationTimes.push(Date.now()-start);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+' page overflow');
   await page.setViewportSize({width:820,height:1000});
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+' tablet overflow');
   await page.setViewportSize({width:ar?390:1440,height:ar?844:1000});
   if(!ar&&name==='IT & equipment support'&&family.id==='modern') {
    const control=page.getByRole('button',{name:'Refresh',exact:true});
    await page.mouse.move(0,0);const normal=await control.evaluate((e:HTMLElement)=>getComputedStyle(e).backgroundColor);
    await control.hover();await page.waitForTimeout(200);const hover=await control.evaluate((e:HTMLElement)=>getComputedStyle(e).backgroundColor);
    assert.notEqual(normal,hover,'Support actions need hover feedback');
    await page.mouse.down();const pressed=await control.evaluate((e:HTMLElement)=>getComputedStyle(e).boxShadow);assert.notEqual(pressed,'none');await page.mouse.up();
    const selected=await page.getByRole('button',{name:'My requests',exact:true}).evaluate((e:HTMLElement)=>getComputedStyle(e).backgroundColor);assert.notEqual(selected,hover,'Persistent selection must differ from hover');
    // A native disabled CSS fixture uses the real control's classes/parent,
    // outside React ownership so its transient loading state cannot race this check.
    await page.waitForTimeout(350);
    await control.evaluate((e:HTMLButtonElement)=>{const clone=e.cloneNode(true) as HTMLButtonElement;clone.disabled=true;clone.dataset.typographyDisabledFixture='true';e.parentElement!.append(clone);});
    const fixture=page.locator('[data-typography-disabled-fixture]');
    await page.mouse.move(0,0);await page.waitForTimeout(200);
    const disabled=await fixture.evaluate((e:HTMLElement)=>({bg:getComputedStyle(e).backgroundColor,opacity:getComputedStyle(e).opacity}));
    await fixture.hover({force:true});await page.waitForTimeout(200);
    assert(await fixture.isDisabled());assert.equal(await fixture.evaluate((e:HTMLElement)=>getComputedStyle(e).backgroundColor),disabled.bg);assert.equal(disabled.opacity,'1');
    await fixture.evaluate((e:HTMLElement)=>e.remove());
   }
   if(!ar&&name==='Company Feed') {
    await page.getByRole('button',{name:'Open Advanced Editor',exact:true}).click();
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Advanced editor overflow');
    await page.getByText('Insert',{exact:true}).first().waitFor();
    await page.screenshot({path:process.env.TEMP+'/stanza-type-after-editor.png',fullPage:true});await page.keyboard.press('Escape');
   }
   await page.screenshot({path:process.env.TEMP+'/stanza-type-after-'+(ar?'ar-':'')+name.replace(/[^a-zA-Z]/g,'')+'.png',fullPage:true});
  }
  }
  await appearance();await page.getByLabel(ar?'نوع الخط':'Font family',{exact:true}).scrollIntoViewIfNeeded();await page.waitForTimeout(250);await page.screenshot({path:process.env.TEMP+'/stanza-type-after-appearance-'+(ar?'ar':'en')+'.png',fullPage:true});
  // Real shared control feedback: native focus, hover, disabled, and motion.
  const select=page.getByLabel(ar?'نوع الخط':'Font family',{exact:true});
  await select.focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');
  const focus=await select.evaluate((e:HTMLElement)=>({visible:e.matches(':focus-visible'),outline:getComputedStyle(e).outlineStyle,shadow:getComputedStyle(e).boxShadow}));
  assert(focus.visible && (focus.outline!=='none'||focus.shadow!=='none'),'Keyboard focus must have a visible indicator: '+JSON.stringify(focus));
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await select.evaluate((e:HTMLElement)=>getComputedStyle(e).transitionDuration),'0s');
  assert.equal(await page.evaluate(()=>{const e=document.querySelector('.stanza-workspace-enter');return e?getComputedStyle(e).animationName:'none';}),'none');
  // Font caching is verified under real offline networking after first use.
  await page.evaluate(async()=>{await navigator.serviceWorker.ready;});
  const cachedFont=await page.evaluate(async()=>{const urls=performance.getEntriesByType('resource').map(r=>r.name).filter(n=>/\.woff2/.test(n));const url=urls[0];if(!url)throw Error('No real font request');await fetch(url);return url;});
  await context.setOffline(true);
  assert(await page.evaluate(async(url:string)=>{const font=new FontFace('stanza-offline-test','url('+url+')');await font.load();return font.status==='loaded';},cachedFont),'Previously used font must decode offline');
  await context.setOffline(false);
  const session=await context.newCDPSession(page);await session.send('Performance.enable');
  const before=(await session.send('Performance.getMetrics')).metrics;await page.waitForTimeout(1000);const after=(await session.send('Performance.getMetrics')).metrics;
  console.log(ar?'Arabic idle 1s':'English idle 1s',Object.fromEntries(['TaskDuration','ScriptDuration','LayoutCount','RecalcStyleCount'].map(name=>[name,after.find((m:any)=>m.name===name).value-before.find((m:any)=>m.name===name).value])));
  assert.deepEqual(errors,[]);assert.deepEqual(apiErrors,[],'Module verification must not pass on API error pages');
  await context.close();
 }
 console.log('PASS',matrix,'theme/family/language/scale/viewport states, real selection/persistence/navigation, focus and reduced motion');
 console.log('Measured font switches ms',fontTimes,'navigation ms (includes 450ms settling)',navigationTimes);
} finally {await browser.close();}
