import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import {BusinessFixtures} from './business-scenario-fixtures';
const f=new BusinessFixtures(),owned=!process.env.RENDERED_ARTIFACT_DIR,dir=process.env.RENDERED_ARTIFACT_DIR||await mkdtemp(path.join(os.tmpdir(),'stanza-rendered-browser-'));
async function ink(p:any,selector:string,property='color',token='--stanza-accent-ink'){
 const e=p.locator(selector).first();await e.waitFor();
 const result=await e.evaluate((e:HTMLElement,{property,token}:any)=>{const probe=document.createElement('span');probe.style.color=`var(${token})`;document.body.append(probe);const expected=getComputedStyle(probe).color,actual=getComputedStyle(e).getPropertyValue(property);probe.remove();return{expected,actual};},{property,token});
 assert.equal(result.actual,result.expected,selector+' resolved theme ownership');assert.notEqual(result.actual,'rgb(255, 255, 255)');assert.notEqual(result.actual,'rgb(16, 185, 129)');
}
async function shot(p:any,name:string){await p.screenshot({path:path.join(dir,name+'.png'),fullPage:true});}
try{
 await f.setup('rendered-ownership');
 // Only our disposable reviewer receives the existing HR role required by Live Employees.
 await f.db.query("UPDATE employees SET role='hr_admin' WHERE id=$1 AND tenant_id=$2",[f.admin.id,f.primary]);
 const hr=await f.login(f.admin.id,f.primary,f.admin.email,f.admin.roleId);
 await f.db.query("INSERT INTO time_logs(tenant_id,employee_id,clock_in_time,location_status,is_valid_geofence,clock_in_location) VALUES($1,$2,NOW()-interval '10 minutes','verified',true,ST_SetSRID(ST_MakePoint(31,30),4326))",[f.primary,f.employee.id]);
 await f.db.query("INSERT INTO audit_logs(tenant_id,actor_employee_id,action,entity_type,entity_id,metadata) VALUES($1,$2,'fixture.rendered_review','employee',$2,'{}')",[f.primary,hr.id]);
 for(const preset of ['amethyst','warm_sand','custom']){
  const c=await f.browser.newContext({storageState:{cookies:await hr.context.cookies(),origins:[]},viewport:{width:1440,height:1000},serviceWorkers:'block'});
  await c.addInitScript(({preset})=>{localStorage.setItem('horizon-language','en');localStorage.setItem('horizon-theme','dark');localStorage.setItem('stanza-demo-notice-seen','true');localStorage.setItem('stanza.preferences.v1',JSON.stringify({tutorialsAutoStart:false,lanyardEnabled:false,desktopNavigationMode:'rail',backgroundPreset:preset,customTheme:{accent:'#dd8b34'}}));},{preset});
  const p=await c.newPage();p.setDefaultTimeout(20000);
  await p.route('**/api/auth/session',async route=>{await new Promise(r=>setTimeout(r,650));await route.continue();});
  await p.goto(f.base);await p.locator('.stanza-auth-loader .stanza-fingerprint-loader').waitFor();await shot(p,preset+'-startup');
  const startup=await p.locator('.stanza-auth-loader .stanza-fingerprint-loader').evaluate((e:HTMLElement)=>({bg:getComputedStyle(e).backgroundImage,shadow:getComputedStyle(e).boxShadow,animation:getComputedStyle(e).animationName}));assert(!startup.bg.includes('52, 211, 153')&&!startup.shadow.includes('16, 185, 129'));assert.equal(startup.animation,'stanzaAuthenticatedLoader');
  await f.navigate(p,'Profile');await p.locator('.stanza-photo-upload').waitFor();await ink(p,'.stanza-photo-upload','background-color','--stanza-accent');await ink(p,'.stanza-user-avatar','border-top-color','--stanza-accent');await ink(p,'[data-accent-panel=SessionManagementPanel] .lucide-laptop');await ink(p,'[data-accent-panel=SessionManagementPanel] .lucide-shield-check');
  await p.locator('.stanza-photo-upload').scrollIntoViewIfNeeded();await shot(p,preset+'-profile');await p.locator('[data-accent-panel=SessionManagementPanel]').screenshot({path:path.join(dir,preset+'-active-sessions.png')});
  await p.locator('.stanza-navigation-shell button[aria-label=Settings]').click();await p.locator('[data-tutorial-target=settings-notifications]').click();const checks=p.locator('#stanza-control-center-notifications input[type=checkbox]');await checks.first().waitFor();await ink(p,'#stanza-control-center-notifications input[type=checkbox]','accent-color','--stanza-accent');await checks.first().check();assert(await checks.first().isChecked());await p.locator('#stanza-control-center-notifications').screenshot({path:path.join(dir,preset+'-notifications.png')});await p.keyboard.press('Escape');
  await f.navigate(p,'Session Center');await ink(p,'[data-accent-panel=SessionCenterPanel] .lucide-search');await ink(p,'[data-accent-panel=SessionCenterPanel] .lucide-shield-check');await p.waitForTimeout(500);await shot(p,preset+'-session-center');
  await f.navigate(p,'Live Employees');await ink(p,'[data-accent-panel=live-employees] .lucide-users-round');await ink(p,'[data-accent-panel=live-employees] .grid svg');await ink(p,'[data-accent-panel=live-employees] .lucide-search');await p.locator('[data-accent-panel=live-employees] tbody tr').first().waitFor();await shot(p,preset+'-live-employees');
  await f.navigate(p,'Audit Trail');await ink(p,'[data-accent-role=actor]');await ink(p,'[data-accent-role=module]');await shot(p,preset+'-audit');
  const trigger=p.locator('.stanza-surface-trigger').first(),rect=await trigger.boundingBox();await trigger.click();
  // Sample the real browser timeline at normal playback rate. Bounded to 240ms; no production observer/RAF.
  const widths=await p.evaluate(`new Promise(resolve => {const menu=document.querySelector('.stanza-surface-menu'),samples=[],start=performance.now();function sample(){samples.push(menu.getBoundingClientRect().width);if(performance.now()-start<240)requestAnimationFrame(sample);else resolve(samples);}sample();})`) as number[];
  assert(widths.at(-1)!>=widths[0]);assert(widths.every((w,i)=>!i||w>=widths[i-1]-1),'rail expands without bounce');
  await shot(p,preset+'-surface-opening');await p.waitForTimeout(210);const menu=p.getByRole('menu');const boxes=await menu.getByRole('menuitemradio').evaluateAll((es:HTMLElement[])=>es.map(e=>({y:e.getBoundingClientRect().y,padding:parseFloat(getComputedStyle(e).paddingInlineStart)})));assert(boxes.every(b=>Math.abs(b.y-boxes[0].y)<1&&b.padding>=8));assert((await menu.boundingBox())!.y>=rect!.y+rect!.height);assert.deepEqual(await trigger.boundingBox(),rect);await shot(p,preset+'-surface-open');await p.keyboard.press('End');await p.keyboard.press('Enter');await p.waitForTimeout(90);assert(await menu.isVisible(),'selection keeps preview open');await p.getByRole('button',{name:'Close surface selector',exact:true}).click();await shot(p,preset+'-surface-closing');await menu.waitFor({state:'hidden'});assert(await trigger.evaluate((e:HTMLElement)=>e===document.activeElement));await trigger.click();await p.waitForTimeout(280);assert.equal(await menu.getByRole('menuitemradio').last().getAttribute('aria-checked'),'true');await p.keyboard.press('Escape');await menu.waitFor({state:'hidden'});
  await f.navigate(p,'Geo-Operations');const clock=p.locator('.attendance-terminal');await clock.waitFor();await clock.scrollIntoViewIfNeeded();await p.mouse.move(1,1);await p.waitForTimeout(400);await shot(p,preset+'-clock-idle');const hitbox=await clock.boundingBox();await clock.hover();await p.waitForTimeout(230);assert.deepEqual(await clock.boundingBox(),hitbox);const hover=await clock.locator('.attendance-terminal-face').evaluate((e:HTMLElement)=>getComputedStyle(e).transform);assert.notEqual(hover,'none');await shot(p,preset+'-clock-hover');await p.mouse.down();await p.waitForTimeout(110);await shot(p,preset+'-clock-press');await p.mouse.move(1,1);await p.mouse.up();assert.deepEqual(await clock.boundingBox(),hitbox);
  if(preset==='amethyst')for(const name of ['Workspace','Company Feed','Weekly Roster','Payroll','Resignations','Grievances','Expenses','Assets & Equipment','IT & equipment support','Hiring','Locations']){await f.navigate(p,name);await p.waitForTimeout(400);await shot(p,'amethyst-module-'+name.replace(/[^a-z]/gi,'-'));assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+' overflow');}
  await c.close();console.log('PASS real rendered accents/startup/selection/clock fixed hitbox',preset);
 }
}finally{await f.cleanup();if(owned)await rm(dir,{recursive:true,force:true});}
