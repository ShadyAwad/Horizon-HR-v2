import './router-env';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {getMigrationPool} from './migration-pool';
import {assertDatabaseMutationSafety,assertHttpMutationSafety} from './mutation-safety';
import {hiringDay,hiringLabel} from '../src/lib/hiring-presentation';
const base=assertHttpMutationSafety(process.env.BROWSER_BASE_URL||'http://localhost:3001','Hiring public-link browser');
assertDatabaseMutationSafety(process.env.DATABASE_URL,'Hiring public-link browser');
assert(process.env.BROWSER_ADMIN_PASSWORD,'BROWSER_ADMIN_PASSWORD required');
const {chromium}=createRequire(import.meta.url)(process.env.BROWSER_PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,channel:'msedge'}),db=getMigrationPool();
const title='Hiring public-link fixture '+crypto.randomUUID();
let job:any,tenant:string;
const cases=[
  {name:'unrestricted',sql:"status='open',opens_on=NULL,closes_on=NULL",state:'accepting_applications',available:true},
  {name:'inclusive-today',sql:"status='open',opens_on=current_date,closes_on=current_date",state:'accepting_applications',available:true},
  {name:'future',sql:"status='open',opens_on=current_date+1,closes_on=NULL",state:'opens_later',available:false},
  {name:'expired',sql:"status='open',opens_on=NULL,closes_on=current_date-1",state:'window_closed',available:false},
  {name:'closed',sql:"status='closed',opens_on=NULL,closes_on=NULL",state:'unavailable',available:false},
];
try {
  const loginContext=await browser.newContext();
  const login=await loginContext.request.post(base+'/api/auth/login',{headers:{Origin:base},data:{email:'admin@stanza-demo.com',password:process.env.BROWSER_ADMIN_PASSWORD}});
  assert.equal(login.status(),200);tenant=(await login.json()).user.tenantId;
  const created=await loginContext.request.post(base+'/api/hiring/jobs',{headers:{Origin:base},data:{title,description:'Owned public-link window verification',headcount:'1'}});
  assert.equal(created.status(),200);job=(await created.json()).job;
  assert.match(job.public_token,/^[A-Za-z0-9_-]{43}$/);assert.notEqual(job.public_token,job.id);
  const auth=await loginContext.storageState();await loginContext.close();
  for(const rtl of [false,true])for(const width of [1440,390]){
    // Different browser zones deliberately leave availability entirely to the server.
    const timezoneId=rtl?'Africa/Cairo':'America/Los_Angeles';
    const context=await browser.newContext({storageState:auth,viewport:{width,height:width===390?844:1000},timezoneId,serviceWorkers:'block'});
    await context.grantPermissions(['clipboard-read','clipboard-write']);
    await context.addInitScript((language:string)=>{
      localStorage.setItem('stanza.preferences.v1',JSON.stringify({tutorialsAutoStart:false,lanyardEnabled:false}));
      localStorage.setItem('horizon-language',language);localStorage.setItem('stanza-demo-notice-seen','true');
    },rtl?'ar':'en');
    const page=await context.newPage();page.setDefaultTimeout(15000);
    for(const fixture of cases){
      await db.query(`UPDATE hiring_jobs SET ${fixture.sql} WHERE tenant_id=$1 AND id=$2`,[tenant,job.id]);
      if(fixture===cases[0]){
        await page.goto(base);await page.locator('[data-tutorial-target=stanza-launcher]').waitFor();
        await page.keyboard.press('Control+k');await page.getByPlaceholder(/Search commands or ask Stanza|ابحث عن أمر أو اسأل Stanza/).fill('Hiring');
        await page.getByRole('option').filter({hasText:rtl?'التوظيف':'Hiring'}).first().click();
      }else{
        // Refresh through existing native filters instead of reopening the command router per fixture.
        const filter=page.getByRole('combobox',{name:rtl?'حالة الوظيفة':'Job status',exact:true});
        const [draftResponse]=await Promise.all([page.waitForResponse((r:any)=>new URL(r.url()).pathname==='/api/hiring/jobs'&&new URL(r.url()).searchParams.get('status')==='draft'),filter.selectOption('draft')]);
        assert.equal(draftResponse.status(),200);
        // Wait for the draft filter's render before changing it again.
        await page.locator('.hiring-job').filter({hasText:title}).waitFor({state:'detached'});
        const [allResponse]=await Promise.all([page.waitForResponse((r:any)=>new URL(r.url()).pathname==='/api/hiring/jobs'&&new URL(r.url()).searchParams.get('status')===''),filter.selectOption('')]);
        assert.equal(allResponse.status(),200);
      }
      const row=page.locator('.hiring-job').filter({hasText:title});
      await row.getByText(hiringLabel(fixture.state,rtl),{exact:true}).waitFor();
      assert.equal(await row.locator('.hiring-status').innerText(),hiringLabel(fixture.name==='closed'?'closed':'open',rtl));
      assert.equal(await row.evaluate((node:HTMLElement)=>node.closest('[dir]')?.getAttribute('dir')),rtl?'rtl':'ltr');
      const listed=(await (await context.request.get(base+'/api/hiring/jobs')).json()).jobs.find((j:any)=>j.id===job.id);
      assert.equal(listed.public_application_state,fixture.state);assert.equal(listed.public_application_available,fixture.available);
      const open=row.getByRole('link',{name:rtl?'فتح صفحة التقديم العامة':'Open public application page',exact:true});
      const copy=row.getByRole('button',{name:rtl?/^(نسخ رابط التقديم|تم النسخ)$/:/^(Copy public link|Copied)$/});
      if(fixture.available){
        await open.waitFor();assert.equal(await open.getAttribute('href'),'/careers/'+job.public_token);
        await page.evaluate(()=>navigator.clipboard.writeText(''));await copy.click();await row.getByRole('button',{name:rtl?'تم النسخ':'Copied',exact:true}).waitFor();
        assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),base+'/careers/'+job.public_token);
        const popupPromise=page.waitForEvent('popup');await open.click();const publicPage=await popupPromise;
        await publicPage.getByRole('heading',{name:title,exact:true}).waitFor();
        await publicPage.getByRole('button',{name:rtl?'إرسال الطلب':'Submit application',exact:true}).waitFor();
        assert.equal(await publicPage.locator('input[name=consent]').getAttribute('required'),'');
        assert(await publicPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
        await publicPage.close();
      }else{
        assert.equal(await open.count(),0);assert.equal(await copy.count(),0);
        const publicPage=await context.newPage();const responsePromise=publicPage.waitForResponse((response:any)=>response.url()===base+'/api/public/jobs/'+job.public_token);await publicPage.goto(base+'/careers/'+job.public_token);assert.equal((await responsePromise).status(),404,'unavailable public page must receive the server 404');
        await publicPage.getByRole('alert').getByText('Job unavailable.',{exact:true}).waitFor();
        assert.equal(await publicPage.locator('form').count(),0);
        assert.equal((await context.request.get(base+'/api/public/jobs/'+job.id)).status(),404);
        await publicPage.close();
      }
      await row.getByText(rtl?'تفاصيل الوظيفة / النشر':'Role details / publication',{exact:true}).click();
      const window=row.locator('details p').filter({hasText:rtl?'فترة التقديم':'Application window'});
      for(const column of ['opens_on','closes_on'])if(listed[column]){
        assert.match(listed[column],/^\d{4}-\d{2}-\d{2}$/);
        const d=listed[column].split('-').map(Number),display=new Intl.DateTimeFormat(rtl?'ar-EG':'en',{dateStyle:'medium',timeZone:timezoneId}).format(new Date(Date.UTC(d[0],d[1]-1,d[2],12)));
        assert((await window.innerText()).includes(display),'publication calendar date must preserve PostgreSQL day');
        assert.equal(hiringDay(listed[column],rtl),display);
      }
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      await row.screenshot({path:process.env.TEMP+'/stanza-hiring-link-'+(rtl?'ar':'en')+'-'+width+'-'+fixture.name+'.png'});
      console.log('PASS',rtl?'Arabic':'English',width,fixture.name,'lifecycle / availability / publication / public page');
    }
    await context.close();
  }
}catch(error){
  for(const context of browser.contexts())for(const page of context.pages())await page.screenshot({path:process.env.TEMP+'/stanza-hiring-link-failure.png',fullPage:true}).catch(()=>{});
  throw error;
}finally{
  await browser.close();
  if(job){
    assert.equal((await db.query('SELECT title FROM hiring_jobs WHERE tenant_id=$1 AND id=$2',[tenant!,job.id])).rows[0]?.title,title);
    await db.query('DELETE FROM audit_logs WHERE tenant_id=$1 AND entity_id=$2',[tenant!,job.id]);
    await db.query('DELETE FROM hiring_jobs WHERE tenant_id=$1 AND id=$2',[tenant!,job.id]);
    assert.equal(Number((await db.query('SELECT count(*) FROM hiring_jobs WHERE id=$1',[job.id])).rows[0].count),0);
    console.log('Owned public-link job fixture removed; zero remaining.');
  }
  await db.end();
}
