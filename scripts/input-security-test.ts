import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {BusinessFixtures,type ScenarioActor} from './business-scenario-fixtures';
import {validateOperationalPlan} from '../src/lib/operational-plan';
import {casePage} from '../src/lib/grievance-contract';
import {validateSketch,validateFeedImageAttributes,isSafeFeedLink,wrapStanzaDocument,validateFeedEditorDocument} from '../src/lib/stanza-document';
const f=new BusinessFixtures(),phase=process.env.INPUT_AUDIT_PHASE,failures:string[]=[];
const marker='INPUT_PRIVATE_'+f.tag,validApplicant={fullName:'Input '+f.tag,positionTitle:'Engineer'},validSupport={issueType:'it_help',urgency:'normal',summary:'Input '+f.tag,description:marker};
process.send?.({type:'privacy-log-check',markers:[marker,f.password]});
async function health(){const r=await f.publicContext.request.get(f.base+'/api/system/live',{timeout:5000});assert.equal(r.status(),200,'server remains alive');}
async function probe(label:string,actor:ScenarioActor|null,url:string,data?:unknown,method?:string,expected=(n:number)=>n>=400&&n<500){try{const r=await f.api(actor,url,data,method);if(!expected(r.status)){failures.push(label+': '+r.status);console.log('REPRO',label,'status',r.status);}if(r.status>=400){assert(!/stack|password_hash|postgres|SELECT |INSERT |UPDATE |C:\\|node_modules|storage_key/i.test(JSON.stringify(r.body)),'safe error: '+label);assert(!JSON.stringify(r.body).includes(marker),'private input absent from error');}await health();return r;}catch(e){failures.push(label+': '+(e as Error).message);console.log('REPRO',label,(e as Error).message);return null;}}
try{
 await f.setup('input-audit-'+phase);for(const a of f.actors)for(const c of await a.context.cookies())if(c.name==='stanza_session')process.send?.({type:'privacy-log-check',markers:[c.value]});
 if(phase==='completion'){
  for(const value of [undefined,null,1,'2'])assert.equal(casePage(value),value==null?1:Number(value));
  for(const value of [0,-1,'NaN',10001,[],{},true])assert.throws(()=>casePage(value));
  for(const path of ['/api/hiring/applicants','/api/hr/assets','/api/grievances'])for(const query of ['', '?page=1&pageSize=25','?pageSize=0','?pageSize=-1','?pageSize=NaN','?pageSize=1000000000','?pageSize[]=1&pageSize[]=2','?pageSize[x]=1'])await probe('pagination completion '+path+query,f.admin,path+query,undefined,undefined,n=>n===200||n===400);
  const applicant=(await f.ok(f.admin,'/api/hiring/applicants',validApplicant)).applicant;
  let assetNumber=0;
  for(const value of [[],{toString:null,valueOf:null},true,17,'2033-02-30','2033-13-01']){
   await probe('Hiring invalid date shape '+JSON.stringify(value),f.admin,'/api/hiring/applicants/'+applicant.id,{appliedAt:value},'PATCH');
   await probe('Assets invalid date shape '+JSON.stringify(value),f.admin,'/api/hr/assets',{assetTag:'INVALID-'+f.tag+'-'+assetNumber++,name:'Fixture',category:'laptop',purchaseDate:value});
   await probe('event invalid date shape '+JSON.stringify(value),f.admin,'/api/company-feed/posts',{title:'Fixture',contentText:'Fixture event',postType:'event',eventStartsAt:value});
  }
  for(const value of [null,'','2032-02-29']){
   const result=await f.ok(f.admin,'/api/hiring/applicants/'+applicant.id,{appliedAt:value},'PATCH');assert.equal(result.applicant.applied_at,value?value+'T00:00:00.000Z':null);
   const resultAsset=await f.ok(f.admin,'/api/hr/assets',{assetTag:'VALID-'+f.tag+'-'+assetNumber++,name:'Fixture',category:'laptop',purchaseDate:value});assert.equal((await f.db.query('SELECT purchase_date::text FROM assets WHERE tenant_id=$1 AND id=$2',[f.primary,resultAsset.asset.id])).rows[0].purchase_date,value||null);
  }
  for(const value of [null,'','2032-02-29','2033-01-31T10:00:00+02:00'])await f.ok(f.admin,'/api/company-feed/posts',{title:'Fixture',contentText:'Fixture event',postType:'event',eventStartsAt:value});
  const paragraph={type:'paragraph',version:1,children:[{type:'text',version:1,text:'Fixture document',format:0,detail:0,mode:'normal',style:''}]};
  const root=(node:unknown)=>wrapStanzaDocument({root:{type:'root',version:1,children:[node]}});
  for(const value of [{toString:null,valueOf:null},[],true])for(const [url,method,data] of [
   ['/api/me/company-feed/draft','PUT',{expectedVersion:value}],
   ['/api/company-feed/posts','POST',{title:'Fixture',contentText:'Fixture document',contentJson:root({type:'heading',tag:value,children:paragraph.children})}],
  ] as const)await probe('production coercion boundary',f.admin,url,data,method);
  await probe('future document version',f.admin,'/api/me/company-feed/draft',{title:'Fixture',contentText:'Fixture document',contentJson:{...root(paragraph),documentVersion:99}},'PUT');
  const counts=async()=> (await f.db.query('SELECT (SELECT count(*)::int FROM support_tickets WHERE tenant_id=$1) tickets,(SELECT count(*)::int FROM audit_logs WHERE tenant_id=$1) audits,(SELECT count(*)::int FROM outbox_events WHERE tenant_id=$1) outbox',[f.primary])).rows[0];
  const before=await counts();
  for(const requesterId of ['11111111-1111-4111-8111-111111111111',f.foreign.id,'not-a-uuid',{},[]])await probe('requester relationship',f.admin,'/api/support',{...validSupport,requesterId});
  assert.deepEqual(await counts(),before,'failed Support creation has no business/audit/outbox state');
  const ticket=(await f.ok(f.admin,'/api/support',{...validSupport,requesterId:f.employee.id})).ticket;
  await f.ok(f.admin,'/api/support/'+ticket.id+'/comments',{note:marker,visibility:'internal'});
  await f.ok(f.employee,'/api/grievances',{title:'Private logging fixture',description:marker});
  const image={type:'image',version:1,uploadId:'11111111-1111-4111-8111-111111111111',src:'/api/company-feed/images/11111111-1111-4111-8111-111111111111',width:'240',height:'120',altText:'Fixture alternative',caption:'Fixture caption'};
  const rich={type:'stanza-block',version:1,kind:'callout',tone:'info',border:'none',shaded:false,thickness:'1',title:'Fixture title',open:true,children:[paragraph]};
  for(const node of [{type:'heading',tag:'h2',children:paragraph.children},{type:'list',listType:'bullet',tag:'ul',children:[{type:'listitem',children:paragraph.children}]},image,...['callout','code','section'].map(kind=>({...rich,kind}))]){
   assert(validateFeedEditorDocument(root(node)).ok,'valid hierarchy/image/caption/numeric-string preserved');
   assert(validateFeedEditorDocument({root:root(node).root}).ok,'legacy document preserved');
  }
  for(const value of [{toString:null,valueOf:null},[]])await probe('production malformed image alt',f.admin,'/api/me/company-feed/draft',{title:'Fixture',contentText:'Fixture caption',contentJson:root({...image,altText:value})},'PUT');
  for(const value of ['2033-02-30','2033-02-30T10:00:00Z',{},[]])await probe('event end validation',f.admin,'/api/company-feed/posts',{title:'Fixture',contentText:'Fixture event',eventEndsAt:value});
  await health();
  console.log('PASS completion matrices: production pagination/dates/documents, health and atomic requester rejection');
 }
 if(phase==='security-baseline'){
  await f.db.query("UPDATE employees SET role='hr_admin' WHERE tenant_id=$1 AND id=$2",[f.primary,f.admin.id]);
  const child=spawn(process.execPath,['--import','tsx','scripts/security-test.ts'],{windowsHide:true,stdio:'inherit',env:{...process.env,SECURITY_TEST_BASE_URL:f.base,SECURITY_TEST_ADMIN_EMAIL:f.admin.email,SECURITY_TEST_ADMIN_PASSWORD:f.password,SECURITY_TEST_EMPLOYEE_EMAIL:f.employee.email,SECURITY_TEST_EMPLOYEE_PASSWORD:f.password}});assert.equal((await once(child,'exit'))[0],0,'existing security suite with disposable authenticated fixtures');
 }
 if(phase==='queries'){
  const own=(await f.ok(f.admin,'/api/hiring/applicants',validApplicant)).applicant;const foreign=(await f.ok(f.foreign,'/api/hiring/applicants',{...validApplicant,fullName:'Foreign '+f.tag})).applicant;
  await f.ok(f.admin,'/api/support',validSupport);
  for(const value of ["'",'"',';','--','%','_',"plain ' ; -- "]){for(const path of ['/api/hiring/applicants','/api/hr/assets','/api/support','/api/grievances','/api/finance/expense-claims']){const key=path==='/api/grievances'?'q':'search';const r=await probe('bound search '+path,f.admin,path+'?'+key+'='+encodeURIComponent(value),undefined,undefined,n=>n===200);if(r)assert(!JSON.stringify(r.body).includes(foreign.id),'search cannot expose other tenant');}}
  for(const q of ['sort=not_a_column','sort=name%20DESC%3B--','status=unsupported','assetId=not-a-uuid','pageSize=-1','pageSize=0','pageSize=1000000000','pageSize=NaN','pageSize[x]=1','pageSize[]=1&pageSize[]=2','from=2033-02-30','cursor=not-json'])await probe('Support '+q,f.admin,'/api/support?'+q);
  for(const q of ['pageSize[toString]=x&pageSize[valueOf]=x','page[toString]=x&page[valueOf]=x','page=-1','page=0','page=9999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999','page=NaN','page[x]=1','page[]=1&page[]=2','pageSize=1.5'])for(const path of ['/api/hiring/applicants','/api/hr/assets','/api/grievances'])await probe('pagination '+path+' '+q,f.admin,path+'?'+q,undefined,undefined,n=>n===200||n===400);
  assert.equal((await f.ok(f.admin,'/api/hiring/applicants/'+own.id)).applicant.id,own.id);console.log('PASS representative bound searches, tenant controls and bounded query probes');
 }
 if(phase==='shapes'){
  const applicant=(await f.ok(f.admin,'/api/hiring/applicants',validApplicant)).applicant;
  for(const value of [null,true,[],{},17,''])for(const [path,key,base] of [['/api/hiring/applicants','fullName',validApplicant],['/api/support','summary',validSupport],['/api/grievances','title',{title:'Input case',description:marker}],['/api/me/expense-claims','merchantName',{merchantName:'Fixture',expenseDate:'2033-01-01',amount:'12.50',currency:'EGP',category:'other',businessReason:marker}]] as const)await probe('shape '+path+' '+JSON.stringify(value),f.admin,path,{...base,[key]:value});
  for(const path of ['/api/hiring/applicants/not-a-uuid','/api/hr/assets/not-a-uuid','/api/support/not-a-uuid','/api/grievances/not-a-uuid','/api/me/expense-claims/not-a-uuid'])await probe('invalid ID '+path,f.admin,path);
  for(const value of ['nonsense','2033-02-30','2033-13-01',true,{},17])await probe('hiring date '+JSON.stringify(value),f.admin,'/api/hiring/applicants/'+applicant.id,{appliedAt:value},'PATCH');
  for(const value of ['2033-02-30','nonsense',{},true])await probe('asset date '+JSON.stringify(value),f.admin,'/api/hr/assets',{assetTag:'INPUT-'+f.tag,name:'Input asset',category:'laptop',purchaseDate:value});
  await f.ok(f.admin,'/api/hiring/applicants/'+applicant.id,{appliedAt:'2032-02-29'},'PATCH');await f.ok(f.admin,'/api/hiring/applicants/'+applicant.id,{appliedAt:'2033-01-31T10:00:00+02:00'},'PATCH');await f.ok(f.admin,'/api/hiring/applicants/'+applicant.id,{appliedAt:null},'PATCH');await f.ok(f.admin,'/api/hr/assets',{assetTag:'VALID-'+f.tag,name:'Valid asset',category:'laptop',purchaseDate:'2032-02-29'});console.log('PASS representative JSON shapes, IDs/dates plus leap-day/timestamp/clear controls');
 }
 if(phase==='assignment'){
  const privileged={tenant_id:f.foreignTenant,created_by:f.foreign.id,updated_by:f.foreign.id,actor_id:f.foreign.id,role:'hr_admin',permissions:['platform.admin'],is_admin:true,platform_admin:true,status:'approved',approved_by:f.foreign.id,reviewed_by:f.foreign.id,owner_id:f.foreign.id};
  const app=(await f.ok(f.admin,'/api/hiring/applicants',{...validApplicant,...privileged})).applicant;await f.ok(f.admin,'/api/hiring/applicants/'+app.id,{fullName:'Safe '+f.tag,...privileged},'PATCH');const row=(await f.db.query('SELECT tenant_id,created_by,updated_by,status FROM hiring_applicants WHERE id=$1',[app.id])).rows[0];assert.deepEqual(row,{tenant_id:f.primary,created_by:f.admin.id,updated_by:f.admin.id,status:'active'});
  for(const path of ['/api/support','/api/grievances','/api/me/expense-claims'])await probe('protected fields '+path,f.admin,path,{...(path==='/api/support'?validSupport:path==='/api/grievances'?{title:'Fixture',description:marker}:{merchantName:'Fixture',expenseDate:'2033-01-01',amount:'12.50',currency:'EGP',category:'other',businessReason:marker}),...privileged});
  const base={domain:'support',resource:'tickets',filters:{status:'open'}};assert(validateOperationalPlan(base));for(const bad of [{...base,domain:'sql'},{...base,resource:'employees'},{...base,filters:{sort:'password_hash'}},{...base,filters:{__proto__:null,constructor:{prototype:{polluted:true}}}},{...base,sql:'SELECT 1'},{domain:'composition',resource:'jobs',filters:{}},{...base,filters:{olderThanDays:1000000}}])assert.throws(()=>validateOperationalPlan(bad));assert.equal(({} as any).polluted,undefined);
  for(const data of [{query:'show open tickets',intent:'anything'},{query:'show open tickets',plan:base},{query:'show open tickets',entityChoices:{table:'employees'}},{query:'show open tickets',entityChoices:{employee:{id:f.admin.id}}},{query:'show open tickets',timeZone:'Invalid/Zone'}])await probe('router unsupported plan/choice',f.admin,'/api/command-router/resolve',data);
  const proto=JSON.parse('{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}');await probe('prototype keys strict mutation',f.admin,'/api/support',{...validSupport,...proto});assert.equal(({} as any).polluted,undefined);console.log('PASS server-derived ownership, strict unknown fields, structured plan allowlists and no object pollution');
 }
 if(phase==='document'){
  const dir=await mkdtemp(path.join(process.cwd(),'node_modules','stanza-input-editor-'));
  try{const outfile=path.join(dir,'editor.cjs');await build({stdin:{contents:"export const createEditor=require('lexical').createEditor;export {FeedImageNode} from './src/components/lexical/FeedImageNode';",resolveDir:process.cwd()},outfile,bundle:true,packages:'external',define:{'import.meta.env':'{}'},platform:'node',format:'cjs',logLevel:'silent'});const {createEditor,FeedImageNode}=createRequire(import.meta.url)(outfile);
   for(const altText of ['Fixture alternative text',null,undefined]){const errors:Error[]=[];const editor=createEditor({namespace:'owned-input-import',nodes:[FeedImageNode],onError:(e:Error)=>errors.push(e)});editor.update(()=>{const node=FeedImageNode.importJSON({type:'feed-image',version:1,uploadId:'00000000-0000-4000-8000-000000000001',src:'/api/public/feed-images/00000000-0000-4000-8000-000000000001',altText,width:100,height:100});assert.equal(node.exportJSON().altText,altText??'');},{discrete:true});assert.deepEqual(errors,[],'legacy optional image alternative text imports safely');}
   console.log('PASS actual Lexical image import: string, null and omitted alternative text');
  }finally{await rm(dir,{recursive:true,force:true});}
  const poison={toString:null,valueOf:null},id='11111111-1111-4111-8111-111111111111';const paragraph={type:'paragraph',version:1,children:[{type:'text',version:1,text:'Input valid document',format:0,detail:0,mode:'normal',style:''}],direction:null,format:'',indent:0};
  const rich={type:'stanza-block',version:1,kind:'callout',tone:'info',border:'none',shaded:false,thickness:'1',title:'',open:true,children:[paragraph],direction:null,format:'',indent:0};
  const doc=(node:any)=>wrapStanzaDocument({root:{type:'root',version:1,children:[node],direction:null,format:'',indent:0}});
  assert.equal(validateFeedEditorDocument(doc(rich),'Input valid document').ok,true,'ordinary rich block and numeric string preserved');
  const image={type:'image',version:1,uploadId:id,src:'/api/company-feed/images/'+id,width:'240',height:'120',altText:'safe'};assert(validateFeedImageAttributes(image));for(const field of ['width','height','altText'])assert(!validateFeedImageAttributes({...image,[field]:poison}));assert(!validateSketch({description:'fixture',shapes:[{tool:poison,color:'#111827',points:[[1,2]]}]}));
  const malformed=[{...rich,kind:poison},{...rich,thickness:poison},{...image,align:poison},{...image,altText:poison},{...image,width:poison},{type:'heading',tag:poison,children:[]},{type:'list',listType:poison,children:[]},{type:'stanza-sketch',drawing:{description:'fixture',shapes:[{tool:poison,color:'#111827',points:[[1,2]]}]}},{type:'tablecell',colSpan:1,rowSpan:1,headerState:poison,children:[]}];
  for(const node of malformed){assert.equal(validateFeedEditorDocument(doc(node)).ok,false,'nonthrowing shared validation');for(const [path,method] of [['/api/me/company-feed/draft','PUT'],['/api/company-feed/posts','POST']] as const)await probe('malformed rich attribute '+node.type,f.admin,path,{title:'Fixture',contentText:'Input valid document',contentJson:doc(node)},method);}
  await f.ok(f.admin,'/api/me/company-feed/draft',{title:'Fixture',contentText:'Input valid document',contentJson:doc(rich)},'PUT');await f.ok(f.admin,'/api/company-feed/posts',{title:'Valid rich fixture',contentText:'Input valid document',contentJson:doc(rich),visibility:[{type:'all'}]});
  for(const scheme of ['javascript:INPUT_MARKER','data:text/html,INPUT_MARKER']){assert(!isSafeFeedLink(scheme));await probe('unsafe rich link',f.admin,'/api/company-feed/posts',{title:'Fixture',contentText:'Input valid document',contentJson:doc({...paragraph,children:[{type:'link',url:scheme,children:paragraph.children}]}),visibility:[{type:'all'}]});}assert(isSafeFeedLink('https://example.invalid/fixture'),'safe URL positive without navigation');console.log('PASS nonthrowing shared documents, both Feed boundaries, legacy numeric strings, valid rich publication and unsafe schemes rejected');
 }
 if(phase==='feed-version'||phase==='feed-date'){
  const response=await f.admin.context.request.fetch(f.base+(phase==='feed-version'?'/api/me/company-feed/draft':'/api/company-feed/posts'),{method:phase==='feed-version'?'PUT':'POST',headers:{Origin:f.base},data:phase==='feed-version'?{expectedVersion:{toString:null,valueOf:null}}:{title:'Fixture',contentText:'Fixture event',eventStartsAt:{toString:null,valueOf:null}},timeout:5000}).catch(e=>{console.log('REPRO draft version request failed',e.message);return null;});await health();assert(response&&response.status()===400,'version shape fails safely');
 }
 if(phase==='html'){
  const literal='<script data-input-marker="owned">INPUT_LITERAL</script><a href="javascript:INPUT_LITERAL">fixture</a>';
  await f.db.query('UPDATE employees SET full_name=$3 WHERE tenant_id=$1 AND id=$2',[f.primary,f.employee.id,literal]);
  await f.ok(f.admin,'/api/hiring/applicants',{fullName:literal,positionTitle:'Fixture engineer'});await f.ok(f.admin,'/api/hiring/jobs',{title:literal,description:literal,ownerId:f.admin.id,managerId:f.admin.id,employmentType:'full_time',headcount:'1',applicationQuestions:[]});
  await f.ok(f.admin,'/api/support',{...validSupport,summary:literal});await f.ok(f.employee,'/api/grievances',{title:literal,description:literal});await f.ok(f.admin,'/api/company-feed/posts',{title:'Input ordinary text',contentText:literal,visibility:[{type:'all'}]});
  const page=await f.page(f.admin);for(const module of ['Organisation','Support','Grievances','Hiring','Company Feed']){await f.navigate(page,module);if(module==='Organisation')await page.locator('[data-tutorial-target=organisation-workspace]').getByRole('button',{name:'People & Hierarchy',exact:true}).click();if(module==='Grievances')await page.getByRole('button',{name:'Case Inbox',exact:true}).click();await page.getByText(literal,{exact:true}).first().waitFor({timeout:15000});assert.equal(await page.locator('script[data-input-marker],a[href="javascript:INPUT_LITERAL"]').count(),0,module+' renders literal text rather than executable elements');await health();}console.log('PASS actual browser People/Support/Grievances/Hiring/Feed ordinary text escaped');
 }
 if(phase==='errors-production'){
  await probe('invalid JSON shape',f.admin,'/api/grievances',{title:{value:marker},description:marker});await probe('missing record',f.admin,'/api/hr/assets/11111111-1111-4111-8111-111111111111');await probe('permission denial',f.employee,'/api/hr/assets');
  const value={assetTag:'INPUT-'+f.tag,name:'Fixture',category:'laptop',serialNumber:'SERIAL-'+f.tag};await f.ok(f.admin,'/api/hr/assets',value);await probe('SQL constraint mapped conflict',f.admin,'/api/hr/assets',{...value,assetTag:'SECOND-'+f.tag},undefined,n=>n===409);
  const upload=await f.admin.context.request.post(f.base+'/api/profile/avatar',{headers:{Origin:f.base},multipart:{avatar:{name:'owned.txt',mimeType:'text/plain',buffer:Buffer.from(marker)}}});assert([400,415].includes(upload.status()));assert(!JSON.stringify(await upload.json()).includes(marker));await health();
  for(let n=0;n<6;n++){const r=await probe('bounded signup limiter',null,'/api/auth/register-tenant',{},undefined,status=>status===(n<5?400:429));if(n===5)assert(!/ip|account:|limitKey/i.test(JSON.stringify(r?.body)));}
  await probe('missing nested requester',f.admin,'/api/support',{...validSupport,requesterId:'11111111-1111-4111-8111-111111111111'});await probe('foreign requester',f.admin,'/api/support',{...validSupport,requesterId:f.foreign.id});await f.ok(f.admin,'/api/support',{...validSupport,requesterId:f.employee.id});console.log('PASS production-like error contracts, controlled limits, uploads/conflicts and health');
 } assert.deepEqual(failures,[],'input contract regressions');
}finally{await f.cleanup();console.log('PASS owned input fixtures cleaned');}
