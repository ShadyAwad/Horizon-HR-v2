import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {writeFileSync} from 'node:fs';
const phase=process.env.THEME_PROFILE_PHASE||'before';
const base=process.env.BROWSER_BASE_URL||'http://127.0.0.1:3000';
const {chromium}=createRequire(import.meta.url)(process.env.BROWSER_PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
 const c=await browser.newContext({viewport:{width:1440,height:900}});
 await c.addInitScript(()=>{
  if(!localStorage.getItem('stanza.preferences.v1'))localStorage.setItem('stanza.preferences.v1',JSON.stringify({tutorialsAutoStart:false,lanyardEnabled:false,backgroundPreset:'custom',desktopNavigationMode:'rail'}));localStorage.setItem('stanza-demo-notice-seen','true');
  const w=window as any;w.profile={commits:0,writes:0,previews:0};
  w.__REACT_DEVTOOLS_GLOBAL_HOOK__={supportsFiber:true,inject:()=>1,onCommitFiberRoot:()=>{w.profile.commits++;},onCommitFiberUnmount:()=>{}};
  const set=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='stanza.preferences.v1')w.profile.writes++;return set.call(this,k,v);};
  const prop=CSSStyleDeclaration.prototype.setProperty;CSSStyleDeclaration.prototype.setProperty=function(k,v,p){if(k==='--stanza-custom-base')w.profile.previews++;return prop.call(this,k,v,p);};
 });
 const login=await c.request.post(base+'/api/auth/login',{data:{email:'admin@stanza-demo.com',password:process.env.BROWSER_ADMIN_PASSWORD}});assert.equal(login.status(),200);
 const p=await c.newPage();await p.goto(base);await p.locator('[data-dashboard-context-header]').waitFor();
 await p.keyboard.press('Control+k');await p.getByPlaceholder('Search commands or ask Stanza…').fill('Open Appearance');await p.keyboard.press('Enter');await p.locator('.stanza-custom-editor').waitFor();
 if(process.env.THEME_PROFILE_NO_TRANSITION)await p.addStyleTag({content:'.stanza-custom-editor * { transition-property:transform,opacity !important; }'});
 const session=await c.newCDPSession(p);await session.send('Performance.enable');
 const results=[];
 for(const field of (process.env.THEME_PROFILE_NO_TRANSITION ? [0] : [0,1,2,3,4,5,6])){
  const picker=p.locator('.stanza-studio-fields').first().locator('input[type=color]').nth(field);
  await picker.scrollIntoViewIfNeeded();await p.waitForTimeout(500);
  const before=(await session.send('Performance.getMetrics')).metrics;
  await p.evaluate(()=>{
    const w=window as any;const stats={commits:null,writes:0,previews:0};w.profile=stats;w.__STANZA_RENDER_DIAGNOSTICS__?.reset();
    const set=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='stanza.preferences.v1')stats.writes++;return set.call(this,k,v);};
    const prop=CSSStyleDeclaration.prototype.setProperty;CSSStyleDeclaration.prototype.setProperty=function(k,v,p){if(k==='--stanza-accent')stats.previews++;return prop.call(this,k,v,p);};
   });
  await session.send('Tracing.start',{categories:'devtools.timeline,disabled-by-default-devtools.timeline',transferMode:'ReturnAsStream'});
  await picker.evaluate(async(e:HTMLInputElement)=>{const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!;for(let i=0;i<240;i++){set.call(e,'#'+((i*7919+123456)%0xffffff).toString(16).padStart(6,'0'));e.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,8));}e.dispatchEvent(new Event('change',{bubbles:true}));});
  await p.waitForTimeout(650);
  const done=new Promise<any>(resolve=>session.once('Tracing.tracingComplete',resolve));await session.send('Tracing.end');const {stream}=await done;let data='';for(;;){const chunk=await session.send('IO.read',{handle:stream});data+=chunk.data;if(chunk.eof)break;}await session.send('IO.close',{handle:stream});
  writeFileSync(process.env.TEMP+`/stanza-picker-${phase}-${field}.json`,data);
  const after=(await session.send('Performance.getMetrics')).metrics;const metric=(name:string)=>(after.find((m:any)=>m.name===name)?.value||0)-(before.find((m:any)=>m.name===name)?.value||0);
  if(phase==='after'){const names=['accent','primaryAction','secondaryAction','surfaceTint','backgroundTint','textColor','hoverHighlight'];const expected='#'+((239*7919+123456)%0xffffff).toString(16).padStart(6,'0').toUpperCase();assert.equal(await p.evaluate(name=>JSON.parse(localStorage.getItem('stanza.preferences.v1')!).customTheme[name],names[field]),expected);}
  const events=JSON.parse(data).traceEvents;const time=(name:string)=>events.filter((e:any)=>e.name===name&&e.ph==='X').reduce((sum:number,e:any)=>sum+(e.dur||0)/1000,0);
  results.push({field,inputs:240,...await p.evaluate(()=>({...((window as any).profile),renders:(window as any).__STANZA_RENDER_DIAGNOSTICS__?.snapshot()})),scriptMs:Math.round(metric('ScriptDuration')*1000),styleMs:Math.round(metric('RecalcStyleDuration')*1000),layoutMs:Math.round(metric('LayoutDuration')*1000),paintMs:Math.round(time('Paint')),rasterMs:Math.round(time('RasterTask'))});
 }
 if(phase==='after'){
  const picker=p.locator('.stanza-studio-fields').first().locator('input[type=color]').first();
  await picker.evaluate((e:HTMLInputElement)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(e,'#237ada');e.dispatchEvent(new Event('input',{bubbles:true}));});
  // Close before the settle timer: editor teardown must persist the final color.
  await p.keyboard.press('Escape');await p.waitForTimeout(50);
  assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('stanza.preferences.v1')!).customTheme.accent),'#237ADA'.toUpperCase());
  await p.reload();await p.locator('[data-dashboard-context-header]').waitFor();
  assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('stanza.preferences.v1')!).customTheme.accent),'#237ADA'.toUpperCase());
  assert.equal(await p.evaluate(()=>document.documentElement.dataset.themeAdjusting),undefined);
  await p.keyboard.press('Control+k');await p.getByPlaceholder('Search commands or ask Stanza…').fill('Open Appearance');await p.keyboard.press('Enter');await p.locator('.stanza-custom-editor').waitFor();
  await p.locator('.stanza-studio-fields').first().locator('input[type=color]').nth(3).evaluate((e:HTMLInputElement)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(e,'#aabbcc');e.dispatchEvent(new Event('input',{bubbles:true}));dispatchEvent(new PageTransitionEvent('pagehide'));});
  assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('stanza.preferences.v1')!).customTheme.surfaceTint),'#AABBCC');
  await p.reload();await p.locator('[data-dashboard-context-header]').waitFor();assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('stanza.preferences.v1')!).customTheme.surfaceTint),'#AABBCC');
  await p.screenshot({path:process.env.TEMP+'/stanza-theme-picker-final.png'});
  await p.keyboard.press('Control+k');await p.getByPlaceholder('Search commands or ask Stanza…').fill('Open Appearance');await p.keyboard.press('Enter');await p.locator('.stanza-custom-editor').waitFor();
  const sections=p.locator('.stanza-custom-editor > details');await sections.nth(1).locator('summary').click();await sections.nth(2).locator('summary').click();
  await sections.nth(2).locator('select').first().selectOption('dot');await sections.nth(2).locator('select').nth(1).selectOption('dot-trail');await p.locator('.stanza-studio-actions button').first().click();
  const extras=p.locator('.stanza-custom-editor input[type=color]');assert.equal(await extras.count(),12);
  for(let i=7;i<12;i++){
   await extras.nth(i).evaluate(async(e:HTMLInputElement)=>{const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!;for(let n=0;n<20;n++){set.call(e,'#'+(0x147890+n*100).toString(16));e.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,8));}e.dispatchEvent(new FocusEvent('focusout',{bubbles:true}));});await p.waitForTimeout(350);
   const expected='#'+(0x147890+19*100).toString(16).toUpperCase();const field=['cardColor','accentColor','strapColor','pointerColor','cursorColor'][i-7];
   assert.equal(await p.evaluate(({field,i})=>{const config=JSON.parse(localStorage.getItem('stanza.preferences.v1')!).customTheme;return i<10?config.lanyardStyle[field]:config[field];},{field,i}),expected);
  }
  const hex=p.locator('.stanza-studio-fields').first().locator('input[type=text]').first();await hex.fill('#114477');await p.keyboard.press('Tab');await p.waitForTimeout(300);assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('stanza.preferences.v1')!).customTheme.accent),'#114477');
  // External/newer state cancels a pending preview rather than being overwritten.
  await extras.first().evaluate((e:HTMLInputElement)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(e,'#aa1144');e.dispatchEvent(new Event('input',{bubbles:true}));});
  await p.evaluate(()=>{const key='stanza.preferences.v1';const value=JSON.parse(localStorage.getItem(key)!);value.customTheme.accent='#227744';value.customAccent='#227744';const serialized=JSON.stringify(value);localStorage.setItem(key,serialized);dispatchEvent(new StorageEvent('storage',{key,newValue:serialized}));});await p.waitForTimeout(350);
  assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('stanza.preferences.v1')!).customTheme.accent),'#227744');assert.equal(await extras.first().inputValue(),'#227744');
  console.log('PASS all twelve color inputs, typed color, lanyard/pointer colors, settle/teardown/pagehide/reload persistence and newer-state cancellation');


 }
 if(phase==='after'){for(const sample of results){assert.equal(sample.writes,1);assert(sample.previews<240);assert(sample.renders.Dashboard.renders<20);}}
 console.log(JSON.stringify({phase,results}));
 writeFileSync(process.env.TEMP+`/stanza-picker-${phase}-metrics.json`,JSON.stringify(results));
} finally {await browser.close();}
