import './router-env';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {BusinessFixtures} from './business-scenario-fixtures';
import {withTenant} from '../src/lib/hr-background';
import {wrapStanzaDocument} from '../src/lib/stanza-document';

const f=new BusinessFixtures();
const richDocument=wrapStanzaDocument({root:{type:'root',version:1,format:'',indent:0,direction:null,children:[{type:'paragraph',version:1,format:'',indent:0,direction:null,children:[{type:'text',version:1,text:'Disposable publication body',format:0,detail:0,mode:'normal',style:''}]}]}});
try {
 await f.setup('feed-status');
 const post=(await f.ok(f.admin,'/api/company-feed/posts',{title:'Status regression',contentText:'Disposable status fixture',visibility:[{type:'all'}]})).post;
 const url=`/api/company-feed/posts/${post.id}/status`;
 const state=async()=> (await f.db.query('SELECT status,published_at,archived_at,updated_at FROM company_feed_posts WHERE tenant_id=$1 AND id=$2',[f.primary,post.id])).rows[0];
 const audit=async()=> (await f.db.query("SELECT metadata FROM audit_logs WHERE tenant_id=$1 AND entity_id=$2 AND action='company_feed_post_status_updated' ORDER BY created_at,id",[f.primary,post.id])).rows;
 const snapshot=async()=>JSON.stringify({state:await state(),posts:(await f.db.query('SELECT * FROM company_feed_posts WHERE tenant_id=ANY($1::uuid[]) ORDER BY id',[f.tenants])).rows,drafts:(await f.db.query('SELECT * FROM company_feed_drafts WHERE tenant_id=ANY($1::uuid[]) ORDER BY id',[f.tenants])).rows,audit:(await f.db.query('SELECT * FROM audit_logs WHERE tenant_id=ANY($1::uuid[]) ORDER BY id',[f.tenants])).rows,outbox:(await f.db.query('SELECT * FROM outbox_events WHERE tenant_id=ANY($1::uuid[]) ORDER BY id',[f.tenants])).rows});
 let result=await f.api(f.admin,url,{status:'archived'},'PATCH');
 assert.equal(result.status,200);assert.equal(result.body.success,true);assert.equal(result.body.post.id,post.id);assert.equal(result.body.post.status,'archived');assert(Number.isFinite(Date.parse(result.body.post.updated_at)));assert(result.body.post.archived_at);
 assert.deepEqual((await audit())[0].metadata,{previousStatus:'published',newStatus:'archived',title:post.title});
 console.log('PASS same-origin PATCH /api/company-feed/posts/:id/status published → archived: 200, persisted record and one correct audit');
 // Existing contract permits all three statuses; transitions are serialized, not version-bearing.
 for(const status of ['draft','published','archived','published','draft','archived','draft','published']) {
  const previous=(await state()).status;const count=(await audit()).length;
  result=await f.api(f.admin,url,{status},'PATCH');assert.equal(result.status,200);assert.equal(result.body.post.status,status);assert.equal((await state()).status,status);
  assert.equal(Boolean(result.body.post.archived_at),status==='archived');assert.equal(result.body.post.published_at,post.published_at);
  const events=await audit();assert.equal(events.length,count+1);assert(events.some(e=>e.metadata.previousStatus===previous&&e.metadata.newStatus===status));
  const visible=(await f.ok(f.employee,'/api/company-feed')).posts.some((p:any)=>p.id===post.id);assert.equal(visible,status==='published');assert(!(await f.ok(f.foreign,'/api/company-feed')).posts.some((p:any)=>p.id===post.id));
 }
 const unchanged=await snapshot();
 for(const body of [{status:'unpublished'},{status:null},{status:7},{}]) assert.equal((await f.api(f.admin,url,body,'PATCH')).status,400);
 assert.equal((await f.api(f.employee,url,{status:'archived'},'PATCH')).status,403);
 assert.equal((await f.api(f.foreign,url,{status:'archived'},'PATCH')).status,404);
 const denied=await f.admin.context.request.patch(f.base+url,{headers:{Origin:'https://foreign.invalid'},data:{status:'archived'}});assert.equal(denied.status(),403);
 assert.equal(await snapshot(),unchanged,'invalid and denied requests change no status, metadata, audit or outbox');
 const client=await f.admin.context.request.patch(f.base+url,{data:{status:'published'}});assert.equal(client.status(),200,'legitimate missing-Origin API client remains supported');
 await withTenant(f.foreignTenant,async c=>assert.equal((await c.query('SELECT id FROM company_feed_posts WHERE id=$1',[post.id])).rowCount,0,'runtime RLS hides foreign post even without tenant predicate'));
 // Exercise the same existing transaction boundary with an audit FK failure after a status write.
 const beforeRollback=await snapshot();
 await assert.rejects(withTenant(f.primary,async c=>{await c.query("UPDATE company_feed_posts SET status='archived',archived_at=NOW() WHERE tenant_id=$1 AND id=$2",[f.primary,post.id]);await c.query("INSERT INTO audit_logs(tenant_id,actor_employee_id,action,entity_type,entity_id,metadata) VALUES($1,$2,'company_feed_post_status_updated','company_feed_post',$3,'{}'::jsonb)",[f.primary,randomUUID(),post.id]);}), (e:any)=>e.code==='23503');
 assert.equal(await snapshot(),beforeRollback,'audit failure rolls back status and metadata; no false audit/outbox');
 console.log('PASS lifecycle visibility, response dates, invalid status400, ordinary403, foreign404/RLS, foreign Origin403, missing-Origin200 and transaction rollback');
 // Private draft versions and publication content versions are separate existing contracts.
 const draftBody={title:'Private advanced draft',contentText:'Disposable publication body',contentJson:richDocument};
 const draft=(await f.ok(f.admin,'/api/me/company-feed/draft',draftBody,'PUT')).draft;
 const next=(await f.ok(f.admin,'/api/me/company-feed/draft',{...draftBody,expectedVersion:draft.version},'PUT')).draft;
 const beforeStaleDraft=await snapshot();assert.equal((await f.api(f.admin,'/api/me/company-feed/draft',{...draftBody,expectedVersion:draft.version},'PUT')).status,409);assert.equal(await snapshot(),beforeStaleDraft);
 const publicationBody={...draftBody,visibility:[{type:'all'}],draftId:next.id,draftVersion:draft.version};
 const beforeStale=await snapshot();assert.equal((await f.api(f.admin,'/api/company-feed/posts',publicationBody)).status,409);assert.equal(await snapshot(),beforeStale);
 assert.equal((await f.api(f.employee,'/api/me/company-feed/draft')).status,403);assert.equal((await f.ok(f.foreign,'/api/me/company-feed/draft')).draft,null);assert(!(await f.ok(f.employee,'/api/company-feed')).posts.some((p:any)=>p.title===draftBody.title));
 const advanced=(await f.ok(f.admin,'/api/company-feed/posts',{...publicationBody,draftVersion:next.version})).post;assert.equal((await f.ok(f.admin,'/api/me/company-feed/draft')).draft,null);
 const contentBody={title:advanced.title,contentText:'Disposable publication body',contentJson:richDocument,expectedUpdatedAt:advanced.updated_at};
 const edited=(await f.ok(f.admin,`/api/company-feed/posts/${advanced.id}/content`,contentBody,'PUT')).post;
 assert.notEqual(edited.updated_at,advanced.updated_at);const beforeStaleContent=await snapshot();assert.equal((await f.api(f.admin,`/api/company-feed/posts/${advanced.id}/content`,contentBody,'PUT')).status,409);assert.equal(await snapshot(),beforeStaleContent);
 assert.equal((await f.api(f.admin,`/api/company-feed/posts/${advanced.id}/status`,{status:'draft'},'PATCH')).status,200);assert(!(await f.ok(f.employee,'/api/company-feed')).posts.some((p:any)=>p.id===advanced.id));
 console.log('PASS private rich draft current/stale saves and current/stale publication; content expectedUpdatedAt200/409 and unpublished advanced content privacy');
 const uiContext=await f.browser.newContext({serviceWorkers:'allow'});await uiContext.addCookies(await f.admin.context.cookies());await uiContext.addInitScript(()=>{localStorage.setItem('stanza.preferences.v1',JSON.stringify({tutorialsAutoStart:false,lanyardEnabled:false}));localStorage.setItem('horizon-language','en');localStorage.setItem('stanza-demo-notice-seen','true');});const page=await uiContext.newPage();page.setDefaultTimeout(20000);const errors:string[]=[];page.on('pageerror',(e:Error)=>errors.push(e.message));page.on('console',(m:any)=>{if(m.type()==='error')errors.push(m.text());});await page.goto(f.base);await f.navigate(page,'Company Feed');
 const management=page.locator('.company-feed-management');await management.locator('summary').click();const row=management.locator('div').filter({has:page.getByText(post.title,{exact:true})}).filter({has:page.getByRole('combobox',{name:'Publication status',exact:true})}).last();const select=row.getByRole('combobox',{name:'Publication status',exact:true});
 const mutations:any[]=[];page.on('request',(r:any)=>{if(new URL(r.url()).pathname===url&&r.method()==='PATCH')mutations.push(r);});
 const response=page.waitForResponse((r:any)=>new URL(r.url()).pathname===url&&r.request().method()==='PATCH');await select.selectOption('archived');assert.equal((await response).status(),200);await page.waitForFunction(()=>document.querySelector<HTMLSelectElement>('.company-feed-management select')?.disabled===false);assert.equal(await select.inputValue(),'archived');assert.equal(await page.getByRole('button',{name:'Read: '+post.title,exact:true}).count(),0);assert.equal(mutations.length,1);
 await page.reload();await f.navigate(page,'Company Feed');await management.locator('summary').click();assert.equal(await select.inputValue(),'archived');assert.equal((await state()).status,'archived');assert.equal(await page.getByRole('button',{name:'Read: '+post.title,exact:true}).count(),0);assert.deepEqual(errors,[]);
 await f.shot(page,'feed-status-archived');console.log('PASS real Publication status selector: exactly one PATCH200, updated UI without reload, reload persists, hidden from public feed, no console/page errors');
 assert.equal((await f.db.query('SELECT count(*)::int n FROM outbox_events WHERE tenant_id=ANY($1::uuid[])',[f.tenants])).rows[0].n,0,'feed workflow emits no outbox events');
} finally {await f.cleanup();}
