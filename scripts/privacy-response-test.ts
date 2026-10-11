import './router-env';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {PDFDocument} from 'pdf-lib';
import sharp from 'sharp';
import path from 'node:path';
import {PrivateExtractionStorage} from '../src/server/document-extraction/extraction-storage';
import {wrapStanzaDocument,validateFeedEditorDocument} from '../src/lib/stanza-document';
import {BusinessFixtures,type ScenarioActor} from './business-scenario-fixtures';
import {getMigrationPool} from './migration-pool';
import {widgetPath} from '../src/components/workspace-composer/widget-catalog';
import {companyFeedImageStorage} from '../src/lib/company-feed-image-storage';
const queries:string[]=[];
const f=new BusinessFixtures(),phase=process.env.PRIVACY_TEST_PHASE;
assert(['cases','hiring','feed','qr'].includes(phase||''),'Unknown privacy phase');
const markers=Object.fromEntries(['GRIEVANCE_BODY','GRIEVANCE_INTERNAL','GRIEVANCE_TITLE','SUPPORT_PUBLIC','SUPPORT_INTERNAL','HIRING_HR','HIRING_TEAM','HIRING_EVALUATION','HIRING_CV','HIRING_SCREENING','FEED_DRAFT','LEAVE_DECISION'].map(k=>[k,'PRIVACY_'+k+'_'+f.tag]));
process.send?.({type:'privacy-log-check',markers:Object.values(markers)});
// Field visibility matrix follows existing contracts: reporters/requesters see their
// public body/replies; case handlers/support.manage see internal history; hiring.view_notes
// sees team notes, hiring.edit additionally sees HR-only notes; assigned evaluators see
// their own evaluations and final-decision users see all. People is directory-only,
// Leave decisions expose status/dates/history, not stored approval notes; feed drafts are author-private.
function absent(value:unknown,forbidden:string[],label:string){const serialized=JSON.stringify(value);for(const marker of forbidden)assert(!serialized.includes(marker),label+' exposed forbidden fixture data');}
function present(value:unknown,marker:string,label:string){assert(JSON.stringify(value).includes(marker),label+' positive control missing');}
async function read(actor:ScenarioActor,path:string,forbidden:string[]=[]){const result=await f.ok(actor,path);absent(result,forbidden,path);return result;}
async function unavailable(actor:ScenarioActor,path:string,forbidden:string[]){const result=await f.api(actor,path);assert([403,404].includes(result.status),path+' must be unavailable');absent(result.body,forbidden,path);return result;}
async function router(actor:ScenarioActor,query:string,forbidden:string[]){queries.push(query);const result=await f.ok(actor,'/api/command-router/resolve',{query,allowReasoning:false});assert.equal(result.result.fallbackUsed,false);absent(result,forbidden,'router');return result;}
async function telemetry(){for(const table of ['router_daily_metrics','router_operational_metrics','router_http_metrics','router_embedding_metrics','router_vector_metrics','audit_logs'])absent((await f.db.query(`SELECT to_jsonb(t) value FROM ${table} t WHERE tenant_id=ANY($1::uuid[])`,[f.tenants])).rows,[...Object.values(markers),...queries],table+' aggregate/audit storage');absent(await f.ok(f.admin,'/api/command-router/metrics'),Object.values(markers),'metrics response');absent(await f.ok(f.admin,'/api/hr/audit-events'),Object.values(markers),'audit presentation');}
try{
 await f.setup('privacy-'+phase);
 if(phase==='qr'){
const result=spawnSync(process.execPath,['--import','tsx','scripts/qr-test.ts'],{env:{...process.env,QR_TEST_TENANT_ID:f.primary,QR_TEST_EMPLOYEE_ID:f.admin.id,QR_TEST_OTHER_TENANT_ID:f.foreignTenant},stdio:'inherit',windowsHide:true});assert.equal(result.status,0,'Existing QR suite with fully disposable PostgreSQL fixtures');
 }
 if(phase==='hiring'){
const reviewer=await f.person(f.primary,'Privacy Hiring reviewer',['hiring.view','hiring.view_notes']);
const moduleAware=await f.person(f.primary,'Privacy onboarding viewer',['hiring.onboarding.view']);
const job=(await f.ok(f.admin,'/api/hiring/jobs',{title:'Privacy Engineer',description:'Public job description',ownerId:f.admin.id,managerId:f.admin.id,employmentType:'full_time',headcount:'1',applicationQuestions:[{id:'eligibility',label:'Eligible?',type:'short_text',required:false,screening:{expected:markers.HIRING_SCREENING,hardRequirement:false}}]})).job;
await f.ok(f.admin,`/api/hiring/jobs/${job.id}/status`,{status:'open'});
const publicJob=await f.api(null,`/api/public/jobs/${job.public_token}`);assert.equal(publicJob.status,200);present(publicJob.body,'Public job description','public job');absent(publicJob.body,[markers.HIRING_SCREENING,job.id,f.primary],'public job projection');
const pdf=await PDFDocument.create();pdf.addPage().drawText(markers.HIRING_CV);const buffer=Buffer.from(await pdf.save());
const application=await f.publicContext.request.post(f.base+`/api/public/jobs/${job.public_token}/apply`,{headers:{Origin:f.base},multipart:{fullName:'Privacy Candidate',email:`privacy-${f.tag}@example.invalid`,consent:'true',coverNote:'Candidate-supplied cover note',resume:{name:'fictional-cv.pdf',mimeType:'application/pdf',buffer}}});assert.equal(application.status(),201);absent(await application.json(),[markers.HIRING_SCREENING,markers.HIRING_CV],'public application');
const candidate=(await f.db.query('SELECT * FROM hiring_applicants WHERE tenant_id=$1 AND job_id=$2',[f.primary,job.id])).rows[0];assert(candidate?.resume_key);
const cv=await reviewer.context.request.get(f.base+`/api/hiring/applicants/${candidate.id}/resume`);assert.equal(cv.status(),200);assert.deepEqual(await cv.body(),buffer);
await unavailable(moduleAware,`/api/hiring/applicants/${candidate.id}/resume`,[candidate.resume_key,markers.HIRING_CV]);
const projections=[['detail',await read(reviewer,`/api/hiring/applicants/${candidate.id}`)],['update',await f.ok(f.admin,`/api/hiring/applicants/${candidate.id}`,{positionTitle:'Privacy Engineer'},'PATCH')],['stage',await f.ok(f.admin,`/api/hiring/applicants/${candidate.id}/stage`,{targetStage:'screening'})],['archive',await f.ok(f.admin,`/api/hiring/applicants/${candidate.id}/archive`,{})]] as const;
for(const [,body] of projections){assert.equal(body.applicant.full_name,'Privacy Candidate');assert.equal(body.applicant.resume_available,true);}const leaks=projections.filter(([,body])=>JSON.stringify(body).includes(candidate.resume_key)).map(([path])=>path);if(leaks.length)console.log('REPRO private CV storage key exposed in:',leaks.join(', '));assert.deepEqual(leaks,[],'Applicant responses must not expose the private CV object key');
// Restore only this disposable candidate after independently checking each serializer.
await f.db.query("UPDATE hiring_applicants SET stage='new',status='active',archived_at=NULL WHERE tenant_id=$1 AND id=$2",[f.primary,candidate.id]);
await f.ok(f.admin,`/api/hiring/applicants/${candidate.id}/notes`,{noteText:markers.HIRING_HR,visibility:'hr_only'});await f.ok(f.admin,`/api/hiring/applicants/${candidate.id}/notes`,{noteText:markers.HIRING_TEAM,visibility:'hiring_team'});
present(await read(f.admin,`/api/hiring/applicants/${candidate.id}`),markers.HIRING_HR,'HR notes');const team=await read(reviewer,`/api/hiring/applicants/${candidate.id}`,[markers.HIRING_HR,candidate.resume_key]);present(team,markers.HIRING_TEAM,'team notes');
const interview=(await f.ok(f.admin,`/api/hiring/applicants/${candidate.id}/interviews`,{startsAt:new Date(Date.now()+3600000).toISOString(),endsAt:new Date(Date.now()+7200000).toISOString(),timezone:'Africa/Cairo',location:'Owned privacy fixture',attendeeIds:[f.admin.id],interviewType:'Technical'})).interview;
await f.ok(f.admin,`/api/hiring/interviews/${interview.id}/evaluations`,{recommendation:'yes',score:'4',notes:markers.HIRING_EVALUATION});
present(await read(f.admin,`/api/hiring/applicants/${candidate.id}/workflow`),markers.HIRING_EVALUATION,'final-decision evaluation');await read(reviewer,`/api/hiring/applicants/${candidate.id}/workflow`,[markers.HIRING_HR,markers.HIRING_EVALUATION,candidate.resume_key]);
for(const path of ['/api/hiring/applicants?search=Privacy',widgetPath('hiring'),'/api/hiring/summary','/api/dashboard/attention-counts'])await read(reviewer,path,[markers.HIRING_HR,markers.HIRING_EVALUATION,candidate.resume_key]);
present(await read(reviewer,widgetPath('hiring')),candidate.id,'nonempty Hiring widget');
await router(reviewer,'show candidates in screening',[markers.HIRING_HR,markers.HIRING_EVALUATION,candidate.resume_key]);
for(const targetStage of ['screening','hr_review','hiring_manager_review','interview','final_review','offer'])await f.ok(f.admin,`/api/hiring/applicants/${candidate.id}/stage`,{targetStage});
const offer=(await f.ok(f.admin,`/api/hiring/applicants/${candidate.id}/offers`,{salary:'5000',currency:'EGP',startDate:'2033-06-01',expiresOn:'2033-05-01',notes:markers.HIRING_HR})).offer;
// Delivery evidence belongs only to this fixture; no external provider or worker is invoked.
const message=(await f.ok(f.admin,`/api/hiring/applicants/${candidate.id}/message`,{subject:'Fictional offer delivery',body:'Disposable delivery evidence'})).message;await f.db.query("UPDATE communication_messages SET status='sent',sent_at=now() WHERE tenant_id=$1 AND id=$2",[f.primary,message.id]);await f.ok(f.admin,`/api/hiring/offers/${offer.id}/status`,{status:'sent',messageId:message.id});
const link=await f.ok(f.admin,`/api/hiring/offers/${offer.id}/candidate-link`,{confirmed:true});
const publicOffer=await f.api(null,'/api/public'+link.path);assert.equal(publicOffer.status,200);present(publicOffer.body,'Privacy Candidate','public offer');absent(publicOffer.body,[markers.HIRING_HR,candidate.id,offer.id,f.primary,candidate.resume_key],'public offer');
const document=await f.publicContext.request.get(f.base+'/api/public'+link.path+'/document');assert.equal(document.status(),200);assert.match(document.headers()['content-type'],/application\/pdf/);
await unavailable(reviewer,`/api/hiring/offers/${offer.id}/document`,[markers.HIRING_HR]);await telemetry();
console.log('PASS Hiring notes/evaluations/CV retrieval and metadata, list/search/widgets/router, public job/application/offer/download and aggregate telemetry');
 }
 if(phase==='feed'){
const author=await f.person(f.primary,'Privacy feed author',['feed.read','feed.publish']);
const png=await sharp({create:{width:80,height:40,channels:3,background:'#10b981'}}).png().toBuffer();
const upload=await author.context.request.post(f.base+'/api/company-feed/images',{headers:{Origin:f.base},multipart:{image:{name:'fictional-private.png',mimeType:'image/png',buffer:png}}});assert.equal(upload.status(),201);const image=(await upload.json()).image;
const storage=(await f.db.query('SELECT storage_key FROM company_feed_images WHERE tenant_id=$1 AND id=$2',[f.primary,image.id])).rows[0].storage_key;absent(image,[storage],'protected image metadata');
const node=(type:string,children:any[]=[])=>({type,version:1,format:'',indent:0,direction:null,children});
const doc=wrapStanzaDocument({root:node('root',[node('paragraph',[{type:'text',version:1,text:markers.FEED_DRAFT,format:0,detail:0,mode:'normal',style:''}]),{type:'image',version:1,src:image.url,uploadId:image.id,altText:'Private fixture',width:80,height:40,maxWidth:800,showCaption:false,caption:'',align:'center'}])});const valid=validateFeedEditorDocument(doc);assert(valid.ok);
await f.ok(author,'/api/me/company-feed/draft',{title:'Private fixture title',contentText:valid.extractedText,contentJson:doc},'PUT');
present(await read(author,'/api/me/company-feed/draft'),markers.FEED_DRAFT,'author draft');assert.equal((await read(f.admin,'/api/me/company-feed/draft',[markers.FEED_DRAFT])).draft,null,'another publisher cannot read an author draft');
assert.equal((await author.context.request.get(f.base+image.url)).status(),200);const deniedImage=await f.employee.context.request.get(f.base+image.url);assert.equal(deniedImage.status(),404);absent(await deniedImage.text(),[markers.FEED_DRAFT,storage],'private image denial');
const published=(await f.ok(f.admin,'/api/company-feed/posts',{title:'Public privacy fixture',contentText:'Ordinary published body',visibility:[{type:'all'}]})).post;
const feed=await read(f.employee,'/api/company-feed',[markers.FEED_DRAFT,storage,image.id]);present(feed,'Ordinary published body','published reader');assert.equal(feed.posts.length,1);
for(const path of ['/api/company-feed?search=Private','/api/company-feed?manage=true',widgetPath('feed'),'/api/dashboard/attention-counts'])await read(f.employee,path,[markers.FEED_DRAFT,storage]);await unavailable(f.employee,'/api/me/company-feed/draft',[markers.FEED_DRAFT,storage]);
const context=await f.browser.newContext({serviceWorkers:'allow'});await context.addCookies(await author.context.cookies());await context.addInitScript(()=>{localStorage.setItem('stanza-demo-notice-seen','true');localStorage.setItem('stanza.preferences.v1',JSON.stringify({tutorialsAutoStart:false,lanyardEnabled:false}));});const page=await context.newPage();await page.goto(f.base);await page.waitForFunction(()=>Boolean(navigator.serviceWorker.controller));await page.locator('[data-tutorial-target=stanza-launcher]').waitFor();
const response=await page.evaluate(async()=>{const r=await fetch('/api/me/company-feed/draft',{cache:'no-store'});return {status:r.status,body:await r.json()};});assert.equal(response.status,200);present(response.body,markers.FEED_DRAFT,'active worker authorized request');
const cachesApi=await page.evaluate(async()=>{const paths:string[]=[];for(const key of await caches.keys())for(const request of await(await caches.open(key)).keys()){const p=new URL(request.url).pathname;if(p.startsWith('/api/'))paths.push(p);}return paths;});assert.deepEqual(cachesApi,[]);await context.close();
const readerPage=await f.page(f.employee);const networkBodies:unknown[]=[];const capture=async(response:any)=>{if(new URL(response.url()).pathname.startsWith('/api/')&&response.headers()['content-type']?.includes('application/json'))networkBodies.push(await response.json().catch(()=>null));};readerPage.on('response',capture);await readerPage.reload();await f.navigate(readerPage,'Company Feed');await readerPage.getByRole('button',{name:'Read: Public privacy fixture',exact:true}).click();await readerPage.getByText('Ordinary published body',{exact:true}).last().waitFor();await readerPage.waitForTimeout(200);readerPage.off('response',capture);assert(networkBodies.length>0);absent(networkBodies,[markers.FEED_DRAFT,storage],'reader network delivery');
assert(published.id);await telemetry();console.log('PASS author-private draft, publisher/readers, protected image metadata/access, feed/widget/network projections and active service-worker API cache exclusion');
 }
 if(phase==='cases'){
const reviewer=await f.person(f.primary,'Privacy case reviewer',['grievances.review','grievances.confidential','grievances.internal_notes','grievances.respond','grievances.triage','grievances.resolve']);
let g=(await f.ok(f.employee,'/api/grievances',{title:markers.GRIEVANCE_TITLE,description:markers.GRIEVANCE_BODY,confidentiality:'confidential'})).grievance;
await f.ok(reviewer,`/api/grievances/${g.id}/messages`,{version:g.version,kind:'internal',body:markers.GRIEVANCE_INTERNAL});g=(await f.ok(reviewer,`/api/grievances/${g.id}`)).grievance;
await f.ok(reviewer,`/api/grievances/${g.id}/messages`,{version:g.version,kind:'response',body:'Reporter-visible response'});
present(await read(reviewer,`/api/grievances/${g.id}`),markers.GRIEVANCE_INTERNAL,'case handler internal');const own=await read(f.employee,`/api/grievances/${g.id}`,[markers.GRIEVANCE_INTERNAL]);present(own,markers.GRIEVANCE_BODY,'reporter body');present(own,'Reporter-visible response','reporter reply');
for(const path of ['/api/grievances/me','/api/grievances/me?q='+encodeURIComponent(markers.GRIEVANCE_TITLE),`/api/grievances/${g.id}?page=2`])await read(f.employee,path,[markers.GRIEVANCE_INTERNAL]);
const caseRoute=await router(f.admin,"show me Scenario Employee's grievance",[markers.GRIEVANCE_INTERNAL,markers.GRIEVANCE_BODY]);assert.equal(caseRoute.result.entityRoute.status,'resolved');present(caseRoute,g.id,'authorized grievance router');
for(let i=0;i<4;i++)await f.ok(f.employee,'/api/grievances',{title:'Visible fixture '+i,description:'Visible own body'});
await f.db.query('INSERT INTO tenant_role_permissions(tenant_id,role_id,permission_key) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[f.primary,f.limited.roleId,'grievances.create']);for(let i=0;i<2;i++)await f.ok(f.limited,'/api/grievances',{title:'Hidden fixture '+i,description:'Unrelated private body'});
assert.equal((await read(f.employee,'/api/grievances/me')).total,5);assert.equal((await read(f.limited,'/api/grievances/me')).total,2);
const known=await unavailable(f.limited,`/api/grievances/${g.id}`,[markers.GRIEVANCE_BODY,markers.GRIEVANCE_INTERNAL,markers.GRIEVANCE_TITLE]);const missing=await unavailable(f.limited,`/api/grievances/${randomUUID()}`,[markers.GRIEVANCE_BODY]);assert.deepEqual(known.body,missing.body);
const tech=await f.person(f.primary,'Privacy Support technician',['support.view','support.manage']);
const asset=(await f.ok(f.admin,'/api/hr/assets',{assetTag:'PRIVACY-LAPTOP',name:'Owned privacy laptop',category:'laptop',condition:'good'})).asset;
await f.ok(f.admin,`/api/hr/assets/${asset.id}/assign`,{employeeId:f.employee.id});
const ticket=(await f.ok(f.employee,'/api/support',{assetId:asset.id,issueType:'it_help',urgency:'normal',summary:'Privacy Support ticket',description:'Requester-visible description'})).ticket;
await f.ok(tech,`/api/support/${ticket.id}/comments`,{note:markers.SUPPORT_PUBLIC,visibility:'requester'});await f.ok(tech,`/api/support/${ticket.id}/comments`,{note:markers.SUPPORT_INTERNAL,visibility:'internal'});
present(await read(tech,`/api/support/${ticket.id}`),markers.SUPPORT_INTERNAL,'technician history');present(await read(f.employee,`/api/support/${ticket.id}`,[markers.SUPPORT_INTERNAL]),markers.SUPPORT_PUBLIC,'requester reply');
for(const path of ['/api/support','/api/support?search=Privacy',`/api/support/${ticket.id}?pageSize=1`,widgetPath('support'),'/api/me/assets'])await read(f.employee,path,[markers.SUPPORT_INTERNAL,markers.GRIEVANCE_INTERNAL]);
let cursor:string|undefined;const publicHistory:unknown[]=[];for(let page=0;page<10;page++){const detail=await read(f.employee,`/api/support/${ticket.id}?pageSize=1${cursor?'&historyCursor='+encodeURIComponent(cursor):''}`,[markers.SUPPORT_INTERNAL]);publicHistory.push(...detail.history);if(!detail.historyHasMore)break;assert(detail.historyNextCursor);cursor=detail.historyNextCursor;assert(page<9,'history pagination must settle');}present(publicHistory,markers.SUPPORT_PUBLIC,'paginated requester history');
assert.equal((await read(f.employee,`/api/support/${ticket.id}`,[markers.SUPPORT_INTERNAL])).asset.id,asset.id,'related asset positive control');
assert.equal((await read(f.limited,'/api/grievances/me?q='+encodeURIComponent(markers.GRIEVANCE_TITLE))).total,0,'matching hidden grievance has no search total');
const denial=await unavailable(f.limited,`/api/support/${ticket.id}`,[markers.SUPPORT_INTERNAL]);const noTicket=await unavailable(f.limited,`/api/support/${randomUUID()}`,[markers.SUPPORT_INTERNAL]);assert.deepEqual(denial.body,noTicket.body);
for(const actor of [f.employee,f.limited]){const self=await read(actor,'/api/auth/session',Object.values(markers));assert.equal(self.user.id,actor.id);assert(!Object.keys(self.user).some(k=>/password|token_hash|resume_key/i.test(k)));}
for(const actor of [f.employee,f.limited])for(const path of ['/api/hr/organisation/people','/api/hr/organisation/overview','/api/dashboard/attention-counts']){const result=await read(actor,path,[markers.GRIEVANCE_BODY,markers.GRIEVANCE_INTERNAL,markers.GRIEVANCE_TITLE,markers.SUPPORT_INTERNAL]);if(path.includes('attention-counts'))assert.equal(result.counts.grievances,0);}
for(const actor of [f.employee,f.limited])await router(actor,"show me Scenario Employee's grievance",[markers.GRIEVANCE_INTERNAL,markers.GRIEVANCE_BODY]);

const supportRoute=await router(tech,'show support issues for Scenario Employee',[markers.SUPPORT_INTERNAL]);assert.equal(supportRoute.result.entityRoute.status,'resolved');present(supportRoute,ticket.id,'authorized Support router');await router(f.employee,'show support issues for Scenario Employee',[markers.SUPPORT_INTERNAL]);
await read(reviewer,widgetPath('grievances'),[markers.GRIEVANCE_INTERNAL]);await unavailable(f.limited,widgetPath('grievances'),[markers.GRIEVANCE_TITLE]);
const leave=(await f.ok(f.employee,'/api/me/leave-requests',{leaveType:'annual',startDate:'2033-08-01',endDate:'2033-08-01',reason:'Own leave reason'})).request;await f.ok(f.admin,`/api/hr/leave-requests/${leave.requestId}/approve`,{expectedVersion:leave.version,note:markers.LEAVE_DECISION});
assert.equal((await f.db.query('SELECT approval_note FROM leave_requests WHERE tenant_id=$1 AND id=$2',[f.primary,leave.requestId])).rows[0].approval_note,markers.LEAVE_DECISION,'internal approval note retained');const decision=await read(f.employee,`/api/me/leave-requests/${leave.requestId}`,[markers.LEAVE_DECISION]);assert.equal(decision.request.status,'approved');assert(decision.history.some((h:any)=>h.newStatus==='approved'));await read(f.employee,'/api/me/leave-requests',[markers.LEAVE_DECISION]);await read(f.admin,`/api/hr/leave-requests/${leave.requestId}`,[markers.LEAVE_DECISION]);await read(f.admin,widgetPath('leave'),[markers.LEAVE_DECISION]);await read(f.limited,'/api/hr/organisation/people',[markers.LEAVE_DECISION]);await telemetry();
console.log('PASS Grievance/Support internal history and positive controls, concealed existence/counts, People/summary/widget/router projections and intended Leave status/history and internal approval-note minimization');
 }
}finally{
 const cvKeys=(await f.db.query('SELECT resume_key FROM hiring_applicants WHERE tenant_id=ANY($1::uuid[]) AND resume_key IS NOT NULL',[f.tenants])).rows.map(r=>r.resume_key);
 const imageKeys=(await f.db.query('SELECT storage_key FROM company_feed_images WHERE tenant_id=ANY($1::uuid[])',[f.tenants])).rows.map(r=>r.storage_key);
 for(const row of (await f.db.query('SELECT storage_key FROM company_feed_images WHERE tenant_id=ANY($1::uuid[])',[f.tenants])).rows)await companyFeedImageStorage.remove(row.storage_key);
 await f.cleanup();const cvStore=new PrivateExtractionStorage(path.join(process.env.GRIEVANCE_ATTACHMENT_DIRECTORY||'uploads/private-grievances','hiring'),Infinity);for(const key of cvKeys)await assert.rejects(cvStore.read(key),{code:'ENOENT'});for(const key of imageKeys)await assert.rejects(companyFeedImageStorage.read(key),{code:'ENOENT'});const db=getMigrationPool();try{const tables=(await db.query("SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='tenant_id'")).rows;for(const row of tables){const quoted='"'+row.table_name.replaceAll('"','""')+'"';assert.equal((await db.query(`SELECT count(*)::int n FROM ${quoted} WHERE tenant_id=ANY($1::uuid[])`,[f.tenants])).rows[0].n,0,row.table_name+' cleanup');assert.equal((await db.query(`SELECT count(*)::int n FROM ${quoted} t WHERE to_jsonb(t)::text LIKE $1`,['%PRIVACY_%'+f.tag+'%'])).rows[0].n,0,row.table_name+' persisted marker cleanup');}console.log('PASS owned privacy tenants/roles/sessions/marker records removed');}finally{await db.end();}
}