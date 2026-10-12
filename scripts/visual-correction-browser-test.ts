import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {BusinessFixtures} from './business-scenario-fixtures';
const f=new BusinessFixtures(),before=process.env.VISUAL_CORRECTION_BASELINE==='true';
const owned=!process.env.VISUAL_ARTIFACT_DIR,dir=process.env.VISUAL_ARTIFACT_DIR||await mkdtemp(path.join(os.tmpdir(),'stanza-correction-'));
try {
 await f.setup('visual-correction');await f.ok(f.admin,'/api/hiring/applicants',{fullName:'Visual review candidate',positionTitle:'Fixture engineer'});
 for(const preset of ['emerald','warm_sand','graphite','light','amethyst','custom']) {
  const context=await f.browser.newContext({storageState:{cookies:await f.admin.context.cookies(),origins:[]},viewport:{width:1440,height:1000},serviceWorkers:'block'});
  await context.addInitScript(({preset})=>{localStorage.setItem('horizon-language','en');localStorage.setItem('horizon-theme',preset==='light'?'light':'dark');localStorage.setItem('stanza-demo-notice-seen','true');localStorage.setItem('stanza.preferences.v1',JSON.stringify({tutorialsAutoStart:false,lanyardEnabled:false,desktopNavigationMode:'rail',backgroundPreset:preset==='light'?'emerald':preset,customTheme:{accent:'#dd8b34'}}));},{preset});
  const p=await context.newPage();p.setDefaultTimeout(20000);await p.goto(f.base);await p.locator('[data-tutorial-target=stanza-launcher]').waitFor();
  const shot=async(name:string)=>{await p.screenshot({path:path.join(dir,`${before?'before':'after'}-${preset}-${name}.png`),fullPage:true});};
  let reference:any;const primary=async(label:string)=>{const b=p.getByRole('button',{name:label,exact:true}).first();await b.waitFor();if(!before){assert(await b.evaluate((e:HTMLElement)=>e.classList.contains('stanza-primary-action')),label+' shared primary');assert.equal(await b.evaluate((e:HTMLElement)=>getComputedStyle(e).textTransform),'none',label+' sentence casing');await p.mouse.move(1,1);await p.waitForTimeout(200);const paint=await b.evaluate((e:HTMLElement)=>({background:getComputedStyle(e).backgroundColor,color:getComputedStyle(e).color,border:getComputedStyle(e).borderColor}));if(reference)assert.deepEqual(paint,reference,label+' canonical primary paint');else reference=paint;}return b;};
  await f.navigate(p,'Weekly Roster');await primary(before?'Apply Leave':'Apply leave');await p.getByRole('tab',{name:'Goals / Tasks',exact:true}).click();await primary('Assign goal');await shot('roster');
  await f.navigate(p,'Hiring');await primary('Add applicant');await primary('Create job');await shot('hiring');await p.getByText('Visual review candidate',{exact:true}).first().click();await primary('Advance stage');await shot('candidate');
  await f.navigate(p,'Company Feed');await p.locator('.stanza-document-publish').waitFor();await p.getByLabel('Published',{exact:true}).selectOption('published');if(!before){await p.getByPlaceholder('Post title',{exact:true}).fill('Visual correction private draft');const canvas=p.locator('.stanza-feed-editor-surface');await canvas.focus();await p.keyboard.type('Disposable visual correction content.');await p.waitForFunction(()=>!(document.querySelector('.stanza-document-publish') as HTMLButtonElement)?.disabled);await primary('Publish post');}await shot('feed');
  if(!before){const settings=p.locator('.stanza-navigation-shell button[aria-label=Settings]');await settings.focus();await p.getByRole('tooltip',{name:'Settings',exact:true}).waitFor();assert.equal(await settings.getAttribute('title'),null);await p.keyboard.press('Escape');}await p.locator('[data-tutorial-target=stanza-launcher]').click();await shot('launcher');await p.keyboard.press('Escape');await p.keyboard.press('Control+k');await p.locator('.stanza-command-palette input').first().fill('Open Appearance');await p.locator('.stanza-command-palette [role=option]').filter({hasText:'Open Appearance'}).click();await p.getByLabel('Font family',{exact:true}).waitFor();
  if(!before){await p.getByRole('radiogroup',{name:'Color theme',exact:true}).waitFor();assert.equal(await p.getByRole('radiogroup',{name:'Background',exact:true}).count(),0);}
  await shot('settings');await p.locator('.stanza-appearance-options').scrollIntoViewIfNeeded();await shot('patterns');
  await context.close();console.log('PASS targeted visual correction review',preset,before?'baseline':'corrected');
 }
} finally {await f.cleanup();if(owned)await rm(dir,{recursive:true,force:true});}
