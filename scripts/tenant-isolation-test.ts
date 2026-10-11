import './router-env';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import path from 'node:path';
import {getMigrationPool} from './migration-pool';
import {PrivateExtractionStorage} from '../src/server/document-extraction/extraction-storage';
import {QrTokenService} from '../src/server/qr/qr-token-service';
import {processMessage} from '../src/server/communications/communications-queue';
import {rollupAttendanceDailySummary} from '../src/server/attendance/attendance-rollup';
import {PDFDocument} from 'pdf-lib';
import {BusinessFixtures,type ScenarioActor} from './business-scenario-fixtures';
import {verifyTenantDatabase} from './tenant-database-checks';
import {companyFeedImageStorage} from '../src/lib/company-feed-image-storage';
import {wrapStanzaDocument} from '../src/lib/stanza-document';
import {getHrQueue,withTenant} from '../src/lib/hr-background';
process.env.DATABASE_POOL_MAX='1';
const f=new BusinessFixtures();
const entityPhase=process.env.TENANT_AUDIT_ENTITIES==='true';
const rich=(value:string)=>wrapStanzaDocument({root:{type:'root',version:1,format:'',indent:0,direction:null,children:[{type:'paragraph',version:1,format:'',indent:0,direction:null,children:[{type:'text',version:1,text:value,format:0,detail:0,mode:'normal',style:''}]}]}});
const checked:string[]=[];
const stateTables=['employees','time_logs','attendance_daily_summaries','company_locations','organisation_teams','assets','asset_assignments','asset_condition_reports','support_tickets','support_ticket_events','leave_requests','leave_request_history','grievances','grievance_messages','grievance_case_events','hiring_jobs','hiring_applicants','hiring_applicant_notes','hiring_interviews','hiring_evaluations','hiring_offers','hiring_onboarding_tasks','hiring_onboarding_template_applications','company_feed_posts','company_feed_drafts','company_feed_images','audit_logs','outbox_events','communication_messages','qr_access_tokens'];
async function snapshot(){const state:Record<string,unknown>={};for(const table of stateTables)state[table]=(await f.db.query(`SELECT to_jsonb(r) value FROM ${table} r WHERE tenant_id=ANY($1::uuid[]) ORDER BY to_jsonb(r)::text`,[f.tenants])).rows;state.jobs=(await getHrQueue().getJobs(['wait','active','delayed','completed','failed'],0,-1)).filter(j=>f.tenants.includes(j.data?.tenantId)).map(j=>({id:j.id,data:j.data})).sort((a,b)=>String(a.id).localeCompare(String(b.id)));return JSON.stringify(state);}
async function denied(label:string,url:string,body?:unknown,method?:string,actor:ScenarioActor=f.admin){const r=await f.api(actor,url,body,method);assert([400,401,403,404,409,422].includes(r.status),`${label}: ${r.status} ${JSON.stringify(r.body)}`);checked.push(label);return r;}
async function hidden(label:string,url:string,marker:string){const r=await f.api(f.admin,url);assert.equal(r.status,200,label);assert(!JSON.stringify(r.body).includes(marker),label+' foreign content');checked.push(label);return r.body;}
try {
 await f.setup('tenant-isolation');const A=f.admin,B=f.foreign;
 const bReader=await f.person(f.foreignTenant,'Foreign Confidential Person',f.permissions.filter(k=>['grievances.create','grievances.view_own','leave.request.self','leave.view.self','leave.cancel.self','feed.read','attendance.clock'].includes(k)),B.id);
 const locationBody={name:'Tenant fixture location',latitude:30,longitude:31,radius:200,locationType:'branch'};
 const aLocation=(await f.ok(A,'/api/hr/locations',{...locationBody,name:'Tenant A fixture location'})).location;
 const bLocation=(await f.ok(B,'/api/hr/locations',{...locationBody,name:'Tenant B private location'})).location;
 const aTeam=(await f.ok(A,'/api/hr/organisation/teams',{name:'Tenant A team',locationId:aLocation.id})).team;
 const aAsset=(await f.ok(A,'/api/hr/assets',{assetTag:'A-'+f.tag,name:'Tenant A equipment',category:'laptop',condition:'good'})).asset;
 const bAsset=(await f.ok(B,'/api/hr/assets',{assetTag:'B-'+f.tag,name:'Tenant B equipment',category:'laptop',condition:'good',serialNumber:'PRIVATE-SERIAL-'+f.tag,purchaseCost:1234,notes:'PRIVATE-ASSET-'+f.tag})).asset;
 await f.ok(B,`/api/hr/assets/${bAsset.id}/assign`,{employeeId:bReader.id});
 const supportBody={issueType:'it_help',urgency:'normal',summary:'Tenant B private ticket',description:'PRIVATE-SUPPORT-'+f.tag,assetId:bAsset.id};
 const bTicket=(await f.ok(bReader,'/api/support',supportBody)).ticket;await f.ok(B,`/api/support/${bTicket.id}/comments`,{note:'PRIVATE-INTERNAL-'+f.tag,visibility:'internal'});
 const aTicket=(await f.ok(A,'/api/support',{issueType:'it_help',urgency:'normal',summary:'Tenant A ticket',description:'Owned fixture'})).ticket;
 const leaveBody={leaveType:'annual',startDate:'2032-05-02',endDate:'2032-05-03',reason:'PRIVATE-LEAVE-'+f.tag};
 const bLeave=(await f.ok(bReader,'/api/me/leave-requests',leaveBody)).request;
 let bCase=(await f.ok(bReader,'/api/grievances',{title:'Tenant B confidential case',description:'PRIVATE-GRIEVANCE-'+f.tag,category:'workplace',priority:'high',confidentiality:'confidential'})).grievance;
 await f.ok(B,`/api/grievances/${bCase.id}/messages`,{version:bCase.version,kind:'internal',body:'PRIVATE-CASE-NOTE-'+f.tag});bCase=(await f.ok(B,`/api/grievances/${bCase.id}`)).grievance;
 const jobBody={title:'Tenant B Engineer',description:'Fictional job only',managerId:B.id,ownerId:B.id,employmentType:'full_time',headcount:'1',locationId:bLocation.id};
 const bJob=(await f.ok(B,'/api/hiring/jobs',jobBody)).job;await f.ok(B,`/api/hiring/jobs/${bJob.id}/status`,{status:'open'});
 const pdf=await PDFDocument.create();pdf.addPage();const cv=Buffer.from(await pdf.save());
 const application=await f.publicContext.request.post(f.base+`/api/public/jobs/${bJob.public_token}/apply`,{headers:{Origin:f.base},multipart:{fullName:'Tenant B Candidate',email:'candidate-'+f.tag+'@example.invalid',consent:'true',resume:{name:'owned.pdf',mimeType:'application/pdf',buffer:cv}}});assert.equal(application.status(),201);
 const bCandidate=(await f.db.query('SELECT * FROM hiring_applicants WHERE tenant_id=$1 AND job_id=$2',[f.foreignTenant,bJob.id])).rows[0];assert(bCandidate.resume_key);
 const aCandidate=(await f.ok(A,'/api/hiring/applicants',{fullName:'Tenant A Candidate',positionTitle:'Engineer',email:'own-'+f.tag+'@example.invalid'})).applicant;
 const interview=(await f.ok(B,`/api/hiring/applicants/${bCandidate.id}/interviews`,{startsAt:new Date(Date.now()+3600000).toISOString(),endsAt:new Date(Date.now()+7200000).toISOString(),timezone:'Africa/Cairo',location:'Owned room',attendeeIds:[B.id],interviewType:'Technical'})).interview;
 await f.ok(B,`/api/hiring/interviews/${interview.id}/evaluations`,{recommendation:'yes',score:4,notes:'PRIVATE-EVALUATION-'+f.tag});const evaluation=(await f.db.query('SELECT id FROM hiring_evaluations WHERE tenant_id=$1 AND interview_id=$2',[f.foreignTenant,interview.id])).rows[0];assert(evaluation);
 await f.ok(B,`/api/hiring/applicants/${bCandidate.id}/reviews`,{recommendation:'hold',score:3,notes:'Owned fixture review'});for(const targetStage of ['screening','hr_review','hiring_manager_review','interview','final_review','offer'])await f.ok(B,`/api/hiring/applicants/${bCandidate.id}/stage`,{targetStage});
 const dates={startDate:new Date(Date.now()+86400000).toISOString().slice(0,10),expiresOn:new Date(Date.now()+7*86400000).toISOString().slice(0,10)};
 const offer=(await f.ok(B,`/api/hiring/applicants/${bCandidate.id}/offers`,{salary:'5000',currency:'EGP',...dates})).offer;
 const link=await f.ok(B,`/api/hiring/offers/${offer.id}/candidate-link`,{confirmed:true});
 // Fixture-only delivery and hire linkage enable existing public/readiness paths without external delivery or a product change.
 await f.db.query("UPDATE hiring_offers SET status='sent' WHERE tenant_id=$1 AND id=$2",[f.foreignTenant,offer.id]);
 await f.db.query('UPDATE hiring_applicants SET hired_employee_id=$3 WHERE tenant_id=$1 AND id=$2',[f.foreignTenant,bCandidate.id,bReader.id]);
 const template=(await f.ok(B,'/api/hiring/onboarding/templates',{name:'Tenant B checklist',tasks:[{key:'orientation',title:'Tenant B orientation',kind:'orientation',dueOffsetDays:0}]})).template;
 await f.ok(B,`/api/hiring/onboarding/employees/${bReader.id}/template`,{templateId:template.id});
 const task=(await f.db.query('SELECT * FROM hiring_onboarding_tasks WHERE tenant_id=$1 AND employee_id=$2',[f.foreignTenant,bReader.id])).rows[0];assert(task);
 const postBody={title:'Tenant B publication',contentText:'PRIVATE-PUBLICATION-'+f.tag,visibility:[{type:'all'}]};
 const bPost=(await f.ok(B,'/api/company-feed/posts',postBody)).post;
 const bAdvanced=(await f.ok(B,'/api/company-feed/posts',{title:'Tenant B advanced publication',contentText:'Advanced fixture',contentJson:rich('Advanced fixture'),visibility:[{type:'all'}]})).post;
 const bDraft=(await f.ok(B,'/api/me/company-feed/draft',{title:'Tenant B private draft',contentText:'PRIVATE-DRAFT-'+f.tag,contentJson:rich('PRIVATE-DRAFT-'+f.tag)},'PUT')).draft;
 const png=await sharp({create:{width:80,height:80,channels:3,background:'#10b981'}}).png().toBuffer();
 const upload=await B.context.request.post(f.base+'/api/company-feed/images',{headers:{Origin:f.base},multipart:{image:{name:'owned.png',mimeType:'image/png',buffer:png}}});assert.equal(upload.status(),201);const bImage=(await upload.json()).image;
 const qr=await f.ok(B,'/api/qr/tokens',{purpose:'asset_lookup',subjectId:bAsset.id});assert(qr.token);
 const aTask=(await f.db.query("INSERT INTO hiring_onboarding_tasks(tenant_id,employee_id,title,kind) VALUES($1,$2,'Owned tenant A task','orientation') RETURNING id",[f.primary,f.employee.id])).rows[0];
 console.log('PASS representative two-tenant fixture setup through real cookie APIs/public application; own records exist and private CV/image fixtures created');
 await verifyTenantDatabase(f);
 if(!entityPhase){
 const before=await snapshot();
 // Employees, location relationships, and related role authority.
 await denied('foreign employee badge',`/api/hr/employees/${bReader.id}/digital-badge`);
 await denied('foreign employee title',`/api/employees/${bReader.id}/title`,{jobTitle:'Changed'},'PATCH');
 await denied('foreign employee reporting update',`/api/hr/organisation/employees/${bReader.id}/reporting-line`,{managerId:A.id},'PATCH');
 await denied('foreign manager',`/api/hr/organisation/employees/${f.employee.id}/reporting-line`,{managerId:bReader.id},'PATCH');
 await denied('foreign location GET',`/api/hr/locations/${bLocation.id}`);
 await denied('foreign location PATCH',`/api/hr/locations/${bLocation.id}`,{name:'Changed'},'PATCH');
 await denied('foreign location usage',`/api/hr/locations/${bLocation.id}/usage`);
 await denied('foreign team location',`/api/hr/organisation/teams/${aTeam.id}`,{locationId:bLocation.id},'PATCH');
 await denied('foreign employee team member',`/api/hr/organisation/teams/${aTeam.id}/members`,{employeeId:bReader.id});
 await denied('foreign job location','/api/hiring/jobs',{...jobBody,title:'Rejected location',ownerId:A.id,managerId:A.id});
 await denied('foreign employee asset assignment',`/api/hr/assets/${aAsset.id}/assign`,{employeeId:bReader.id});
 for(const [suffix,data,method] of [['',undefined,'GET'],['',{name:'Changed'},'PATCH'],['/assign',{employeeId:f.employee.id},'POST'],['/report-condition',{condition:'damaged',notes:'Changed'},'POST'],['/retire',{},'POST'],['/qr-label',undefined,'GET'],['/qr-label/issue',{},'POST'],['/qr-label/rotate',{},'POST'],['/qr-label/revoke',{},'POST']] as const)await denied('foreign asset '+suffix+' '+method,`/api/hr/assets/${bAsset.id}${suffix}`,data,method);
 await denied('foreign asset generic QR issue','/api/qr/tokens',{purpose:'asset_lookup',subjectId:bAsset.id});
 await denied('foreign Support detail',`/api/support/${bTicket.id}`);
 for(const visibility of ['requester','internal'])await denied('foreign Support '+visibility,`/api/support/${bTicket.id}/comments`,{note:'Changed',visibility});
 for(const status of ['in_progress','resolved','closed'])await denied('foreign Support '+status,`/api/support/${bTicket.id}/update`,{status,note:'Changed',assignedTo:A.id});
 await denied('foreign Support handler',`/api/support/${aTicket.id}/update`,{status:'in_progress',assignedTo:B.id});
 await denied('foreign Support asset link','/api/support',{...supportBody,summary:'Rejected equipment'});
 await denied('foreign leave detail',`/api/hr/leave-requests/${bLeave.requestId}`);
 await denied('foreign own leave detail',`/api/me/leave-requests/${bLeave.requestId}`);
 for(const decision of ['approve','reject'])await denied('foreign leave '+decision,`/api/hr/leave-requests/${bLeave.requestId}/${decision}`,{expectedVersion:bLeave.version,note:'Changed'});
 await denied('foreign leave cancellation',`/api/me/leave-requests/${bLeave.requestId}/cancel`,{expectedVersion:bLeave.version});
 await denied('forged leave employee','/api/me/leave-requests',{...leaveBody,employeeId:bReader.id,tenant_id:f.foreignTenant});
 const foreignCase=await denied('foreign confidential grievance',`/api/grievances/${bCase.id}`);const absentCase=await denied('absent confidential grievance',`/api/grievances/${randomUUID()}`);assert.equal(foreignCase.status,absentCase.status);assert.deepEqual(foreignCase.body,absentCase.body);
 await denied('foreign grievance messages',`/api/grievances/${bCase.id}/messages`,{version:bCase.version,kind:'internal',body:'Changed'});
 await denied('foreign grievance status',`/api/grievances/${bCase.id}/status`,{version:bCase.version,status:'triaged'},'PATCH');
 await denied('foreign grievance assignment',`/api/grievances/${bCase.id}/assignment`,{version:bCase.version,employeeId:A.id},'PATCH');
 await denied('forged grievance reporter','/api/grievances',{title:'Rejected fixture',description:'Owned fixture',employeeId:bReader.id,tenant_id:f.foreignTenant});
 await denied('foreign job status',`/api/hiring/jobs/${bJob.id}/status`,{status:'closed'});
 const foreignCandidate=await denied('foreign candidate detail',`/api/hiring/applicants/${bCandidate.id}`);const absentCandidate=await denied('absent candidate detail',`/api/hiring/applicants/${randomUUID()}`);assert.deepEqual(foreignCandidate.body,absentCandidate.body);assert.equal(foreignCandidate.status,absentCandidate.status);
 await denied('foreign candidate workflow',`/api/hiring/applicants/${bCandidate.id}/workflow`);
 await denied('foreign candidate edit',`/api/hiring/applicants/${bCandidate.id}`,{fullName:'Changed'},'PATCH');
 await denied('foreign candidate notes',`/api/hiring/applicants/${bCandidate.id}/notes`,{noteText:'Changed'});
 await denied('foreign candidate stage',`/api/hiring/applicants/${bCandidate.id}/stage`,{targetStage:'screening'});
 await denied('foreign candidate review',`/api/hiring/applicants/${bCandidate.id}/reviews`,{recommendation:'hold',score:3,notes:'Changed'});
 await denied('foreign candidate hire',`/api/hiring/applicants/${bCandidate.id}/hire`,{confirmed:true});
 await denied('foreign candidate owner',`/api/hiring/applicants/${aCandidate.id}/handoff`,{reviewerId:B.id,targetStage:'screening',message:'Rejected'});
 await denied('foreign interview evaluation',`/api/hiring/interviews/${interview.id}/evaluations`,{recommendation:'yes',score:4,notes:'Changed'});
 await denied('foreign offer status',`/api/hiring/offers/${offer.id}/status`,{status:'withdrawn'});
 await denied('foreign offer link',`/api/hiring/offers/${offer.id}/candidate-link`,{confirmed:true});
 await denied('foreign offer document',`/api/hiring/offers/${offer.id}/document`);
 await denied('foreign onboarding owner',`/api/hiring/onboarding/tasks/${aTask.id}`,{status:'in_progress',ownerId:B.id});
 await denied('foreign onboarding task',`/api/hiring/onboarding/tasks/${task.id}`,{status:'completed'});
 await denied('foreign onboarding employee',`/api/hiring/onboarding/employees/${bReader.id}/template`,{templateId:template.id});
 await denied('foreign feed status',`/api/company-feed/posts/${bPost.id}/status`,{status:'archived'},'PATCH');
 await denied('foreign advanced content',`/api/company-feed/posts/${bAdvanced.id}/content`,{title:'Changed',contentText:'Advanced fixture',contentJson:rich('Advanced fixture'),expectedUpdatedAt:bAdvanced.updated_at},'PUT');
 await denied('private draft ID is not a post',`/api/company-feed/posts/${bDraft.id}/status`,{status:'published'},'PATCH');
 for(const [label,path] of [['foreign CV',`/api/hiring/applicants/${bCandidate.id}/resume`],['foreign image',bImage.url]] as const){const r=await A.context.request.get(f.base+path);assert.equal(r.status(),404,label);checked.push(label);}
 const foreignSupport=await denied('foreign Support concealment',`/api/support/${bTicket.id}`),absentSupport=await denied('absent Support concealment',`/api/support/${randomUUID()}`);assert.deepEqual(foreignSupport.body,absentSupport.body);assert.equal(foreignSupport.status,absentSupport.status);
 assert.equal(await snapshot(),before,'all denied foreign/relationship mutations preserve records, audit/outbox and queue jobs');
 console.log('PASS',checked.length,'real foreign-ID/relationship mutations and sensitive enumeration checks: no changed records or false success audit/outbox/jobs');
 // Search, summary, singleton drafts and filters always retain the session tenant.
 await hidden('foreign employee search',`/api/hr/organisation/people?search=Foreign%20Confidential&tenant_id=${f.foreignTenant}`,bReader.id);
 await hidden('foreign location list',`/api/hr/locations?tenant_id=${f.foreignTenant}`,bLocation.id);
 await hidden('foreign asset list',`/api/hr/assets?tenantId=${f.foreignTenant}`,bAsset.id);
 await hidden('foreign Support filters',`/api/support?queue=true&requesterId=${bReader.id}&assetId=${bAsset.id}&locationId=${bLocation.id}`,bTicket.id);
 await hidden('foreign leave list',`/api/hr/leave-requests?employeeId=${bReader.id}&tenant_id=${f.foreignTenant}`,bLeave.requestId);
 await hidden('foreign grievance list',`/api/grievances?q=Tenant%20B&assignee=${B.id}&tenant_id=${f.foreignTenant}`,bCase.id);
 const attention=await hidden('foreign grievance summary',`/api/dashboard/attention-counts?employeeId=${bReader.id}&tenant_id=${f.foreignTenant}`,bCase.id);assert.equal(attention.counts.grievances,0);assert.equal((await f.ok(B,'/api/dashboard/attention-counts')).counts.grievances,1,'own B confidential case count positive control');
 await hidden('foreign hiring jobs',`/api/hiring/jobs?tenant_id=${f.foreignTenant}`,bJob.id);
 await hidden('foreign hiring summary','/api/hiring/summary',bCandidate.id);
 await hidden('foreign onboarding filter',`/api/hiring/onboarding/readiness?employeeId=${bReader.id}`,bReader.id);
 await hidden('foreign feed list',`/api/company-feed?postId=${bPost.id}&tenant_id=${f.foreignTenant}`,bPost.id);
 await hidden('foreign feed management',`/api/company-feed/admin?tenant_id=${f.foreignTenant}`,bAdvanced.id);
 await hidden('foreign audit target',`/api/hr/audit-events?targetId=${bAsset.id}&tenant_id=${f.foreignTenant}`,bAsset.id);
 await hidden('foreign audit actor',`/api/hr/audit-events?actorId=${B.id}&tenant_id=${f.foreignTenant}`,B.id);
 assert((await f.ok(B,`/api/hr/audit-events?targetId=${bAsset.id}`)).events.length>0,'owned B audit positive control');
 assert.equal((await f.ok(A,`/api/me/company-feed/draft?draftId=${bDraft.id}&tenant_id=${f.foreignTenant}`)).draft,null);
 // Opaque public routes remain separate from authenticated IDs.
 assert.equal((await f.api(null,`/api/public/jobs/${bJob.id}`)).status,404);assert.equal((await f.api(null,`/api/public/offers/${offer.id}`)).status,404);assert.equal((await f.api(null,`/api/public/verify/asset/${bAsset.id}`)).status,404);
 const publicJob=await f.ok(null,`/api/public/jobs/${bJob.public_token}`);assert.equal(publicJob.job.title,bJob.title);assert(!JSON.stringify(publicJob).includes(bCandidate.email));
 const publicOffer=await f.ok(null,'/api/public'+link.path);assert(!JSON.stringify(publicOffer).includes('PRIVATE-EVALUATION'));
 const publicAsset=await f.ok(null,`/api/public/verify/asset/${new URL(qr.token.encodedUrl).pathname.split('/').at(-1)}`);assert(!JSON.stringify(publicAsset).includes('PRIVATE-SERIAL'));assert(!JSON.stringify(publicAsset).includes('PRIVATE-ASSET'));assert(!JSON.stringify(publicAsset).includes(bReader.email));
 assert.equal((await f.api(null,`/api/hr/assets/${bAsset.id}`)).status,401);
 assert.equal((await B.context.request.get(f.base+`/api/hiring/applicants/${bCandidate.id}/resume`)).status(),200);assert.equal((await B.context.request.get(f.base+bImage.url)).status(),200);
 console.log('PASS tenant-scoped lists/filters/summary/drafts and public opaque job/offer/QR projections; raw IDs do not bypass private APIs');
 // Forged identity is ignored or rejected, never trusted, in otherwise valid own mutations.
 const forged={tenant_id:f.foreignTenant,tenantId:f.foreignTenant,actor_id:B.id,created_by:B.id};
 const ownAsset=(await f.ok(A,'/api/hr/assets',{assetTag:'FORGED-'+f.tag,name:'Authoritative A asset',category:'laptop',...forged})).asset;
 const stored=(await f.db.query('SELECT tenant_id,created_by FROM assets WHERE id=$1',[ownAsset.id])).rows[0];assert.equal(stored.tenant_id,f.primary);assert.equal(stored.created_by,A.id);
 const successAudit=(await f.db.query("SELECT tenant_id,actor_employee_id,entity_id FROM audit_logs WHERE entity_id=$1 AND action='asset.created'",[ownAsset.id])).rows;assert.equal(successAudit.length,1);assert.equal(successAudit[0].tenant_id,f.primary);assert.equal(successAudit[0].actor_employee_id,A.id);
 const ownApplicant=(await f.ok(A,'/api/hiring/applicants',{fullName:'Forged-input A candidate',positionTitle:'Engineer',...forged})).applicant;assert.equal(ownApplicant.tenant_id,f.primary);assert.equal(ownApplicant.created_by,A.id);
 const ownDraft=(await f.ok(A,'/api/me/company-feed/draft',{title:'Owned A draft',contentText:'Owned A content',contentJson:rich('Owned A content'),draftId:bDraft.id,...forged},'PUT')).draft;assert.notEqual(ownDraft.id,bDraft.id);assert.equal((await f.ok(B,'/api/me/company-feed/draft')).draft.id,bDraft.id);
 await denied('strict nested forged actor','/api/support',{issueType:'it_help',urgency:'normal',summary:'Rejected forge',description:'Owned fixture',identity:forged});
 await denied('tenant admin platform corpus','/api/semantic-intelligence/platform/corpus');
 await denied('tenant admin platform mutation',`/api/semantic-intelligence/platform/corpus/${randomUUID()}`,{action:'deactivate',confirm:true});
 // Even an explicit platform authority is not a tenant-role permission or cross-tenant private read grant.
 await f.db.query("INSERT INTO router_platform_authorities(tenant_id,employee_id,capabilities) VALUES($1,$2,ARRAY['view_all']::text[])",[f.primary,A.id]);
 const capabilities=await f.ok(A,'/api/semantic-intelligence/capabilities');assert(capabilities.platform.includes('view_all'));
 assert.equal((await f.api(A,'/api/semantic-intelligence/platform/corpus')).status,200);await denied('platform operator private foreign grievance',`/api/grievances/${bCase.id}`);
 await f.db.query('DELETE FROM router_platform_authorities WHERE tenant_id=$1 AND employee_id=$2',[f.primary,A.id]);
 console.log('PASS forged tenant/actor/creator ignored or rejected; explicit platform registry separate from tenant-admin/custom roles and private tenant APIs');
 }
 if(entityPhase){
 const ownCase=(await f.ok(f.employee,'/api/grievances',{title:'Owned A case',description:'Owned A description',confidentiality:'confidential'})).grievance;const relationshipBefore=await snapshot();await denied('foreign grievance reviewer',`/api/grievances/${ownCase.id}/assignment`,{version:ownCase.version,employeeId:B.id},'PATCH');assert.equal(await snapshot(),relationshipBefore);
 const invite=(await f.ok(B,'/api/qr/tokens',{purpose:'onboarding_invite',expiresInMinutes:60})).token;assert(invite.tokenRecordId);await f.db.query("UPDATE qr_access_tokens SET expires_at=NOW()-INTERVAL '1 minute' WHERE tenant_id=$1 AND id=$2",[f.foreignTenant,invite.tokenRecordId]);
 await f.db.query("INSERT INTO time_logs(tenant_id,employee_id,clock_in_time,clock_out_time,location_status,is_valid_geofence,clock_in_location) VALUES($1,$2,'2032-05-02T08:00:00Z','2032-05-02T10:00:00Z','verified',true,ST_SetSRID(ST_MakePoint(31,30),4326))",[f.foreignTenant,bReader.id]);await rollupAttendanceDailySummary({tenantId:f.foreignTenant,employeeId:bReader.id,workDate:'2032-05-02'});assert.equal((await f.db.query('SELECT total_minutes FROM attendance_daily_summaries WHERE tenant_id=$1 AND employee_id=$2',[f.foreignTenant,bReader.id])).rows[0].total_minutes,120);
 const bMessage=(await f.ok(B,`/api/hiring/applicants/${bCandidate.id}/message`,{subject:'Owned worker fixture',body:'Not delivered'})).message;await f.db.query("UPDATE communication_messages SET status='queued' WHERE tenant_id=$1 AND id=$2",[f.foreignTenant,bMessage.id]);
 const workerBefore=await snapshot();let sends=0;await processMessage({data:{tenantId:f.primary,messageId:bMessage.id},attemptsMade:0},async()=>{sends++;throw Error('Provider must never be called for a foreign message');});assert.equal(sends,0);assert.equal(await new QrTokenService().expireToken(f.primary,invite.tokenRecordId),false);await rollupAttendanceDailySummary({tenantId:f.primary,employeeId:bReader.id,workDate:'2032-05-02'});assert.equal(await snapshot(),workerBefore);
 assert.equal(await new QrTokenService().expireToken(f.foreignTenant,invite.tokenRecordId),true);await processMessage({data:{tenantId:f.foreignTenant,messageId:bMessage.id},attemptsMade:0},async()=>({ok:true,id:'fixture-delivery-only'}));assert.equal((await f.db.query('SELECT status FROM communication_messages WHERE tenant_id=$1 AND id=$2',[f.foreignTenant,bMessage.id])).rows[0].status,'sent');
 console.log('PASS actual communication, QR expiry and attendance worker functions: own positive controls; foreign object IDs cause no delivery/mutation');
 const ownRecognized=(await f.ok(B,'/api/command-router/resolve',{query:'what laptop is Foreign Confidential Person using?',allowReasoning:false})).result;assert.equal(ownRecognized.outcome,'matched');assert(ownRecognized.entityRoute.items.some((item:any)=>item.id===bAsset.id));
 const queries=['what laptop is Foreign Confidential Person using?','who has B-'+f.tag+'?','show support issues for Foreign Confidential Person',"show me Foreign Confidential Person's grievance",'show candidates for Tenant B Engineer','show support issues at Tenant B private location'];
 for(const query of queries){const response=await f.ok(A,'/api/command-router/resolve',{query,allowReasoning:false});const serialized=JSON.stringify(response);for(const id of [bReader.id,bAsset.id,bTicket.id,bCase.id,bCandidate.id,bLocation.id])assert(!serialized.includes(id),'router exposes foreign ID');for(const privateText of ['PRIVATE-GRIEVANCE','PRIVATE-CASE-NOTE','PRIVATE-SUPPORT','PRIVATE-DRAFT'])assert(!serialized.includes(privateText));assert.equal(response.result.fallbackUsed,false);if(query===queries[0])assert.equal(response.result.intentKey,ownRecognized.intentKey);}
 const chosen=await f.ok(A,'/api/command-router/resolve',{query:queries[0],allowReasoning:false,entityChoices:{employee:bReader.id,asset:bAsset.id}});assert(!JSON.stringify(chosen).includes(bAsset.id));assert(!JSON.stringify(chosen).includes(bReader.id));
 console.log('PASS frozen router recognized intent/foreign names and explicit foreign choices reveal no employee/asset/location/candidate/grievance records; no reasoning calls');
 // Bounded real parallel operations on separate tenants; no guard/rate-limit changes.
 for(let round=0;round<4;round++){
  const results=await Promise.all([f.ok(A,`/api/hr/assets/${aAsset.id}`,{name:'Tenant A round '+round},'PATCH'),f.ok(B,`/api/hr/assets/${bAsset.id}`,{name:'Tenant B round '+round},'PATCH')]);assert(results.every(r=>r.success));
  const reads=await Promise.all([f.ok(A,`/api/hr/assets/${aAsset.id}`),f.ok(B,`/api/hr/assets/${bAsset.id}`)]);assert.equal(reads[0].asset.name,'Tenant A round '+round);assert.equal(reads[1].asset.name,'Tenant B round '+round);
 }
 await f.ok(A,`/api/hr/organisation/employees/${f.employee.id}/reporting-line`,{managerId:A.id},'PATCH');await f.ok(A,`/api/hr/locations/${aLocation.id}`,{name:'Tenant A updated'},'PATCH');await f.ok(A,`/api/hr/assets/${aAsset.id}/assign`,{employeeId:f.employee.id});
 await f.ok(A,`/api/support/${aTicket.id}/update`,{status:'in_progress',assignedTo:A.id});
 }
 const outbox=(await f.db.query('SELECT tenant_id,event_type,payload FROM outbox_events WHERE tenant_id=ANY($1::uuid[])',[f.tenants])).rows;assert(outbox.length>0);for(const r of outbox){if(r.payload.tenantId!==undefined)assert.equal(r.payload.tenantId,r.tenant_id);if(r.payload.data?.tenantId!==undefined)assert.equal(r.payload.data.tenantId,r.tenant_id);}
 const auditRows=(await f.db.query("SELECT l.tenant_id,e.tenant_id actor_tenant FROM audit_logs l JOIN employees e ON e.id=l.actor_employee_id WHERE l.tenant_id=ANY($1::uuid[])",[f.tenants])).rows;assert(auditRows.length>0);assert(auditRows.every(r=>r.tenant_id===r.actor_tenant));
 console.log('PASS audit/outbox authoritative tenant integrity; concurrent phase:',entityPhase);
 console.log('PASS total foreign/mass-relationship/visibility checks:',checked.length);assert(evaluation);
}finally{
 const images=(await f.db.query('SELECT storage_key FROM company_feed_images WHERE tenant_id=ANY($1::uuid[])',[f.tenants])).rows;const resumes=(await f.db.query('SELECT resume_key FROM hiring_applicants WHERE tenant_id=ANY($1::uuid[]) AND resume_key IS NOT NULL',[f.tenants])).rows;
 for(const r of images){await companyFeedImageStorage.remove(r.storage_key);await assert.rejects(companyFeedImageStorage.read(r.storage_key),(e:any)=>e.code==='ENOENT');}
 const queue=getHrQueue();for(const job of await queue.getJobs(['wait','delayed','completed','failed'],0,-1))if(f.tenants.includes(job.data?.tenantId))await job.remove();assert.equal((await queue.getJobs(['wait','active','delayed','completed','failed'],0,-1)).filter(j=>f.tenants.includes(j.data?.tenantId)).length,0);
 await f.cleanup();const store=new PrivateExtractionStorage(path.join(process.env.GRIEVANCE_ATTACHMENT_DIRECTORY||'uploads/private-grievances','hiring'),Infinity);for(const r of resumes)await assert.rejects(store.read(r.resume_key),(e:any)=>e.code==='ENOENT');
 const finalDb=getMigrationPool();try{const tables=(await finalDb.query("SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='tenant_id'")).rows;for(const r of tables){assert.match(r.table_name,/^[a-z][a-z0-9_]*$/);assert.equal((await finalDb.query(`SELECT count(*)::int n FROM public."${r.table_name}" WHERE tenant_id=ANY($1::uuid[])`,[f.tenants])).rows[0].n,0,r.table_name+' owned cleanup');}}finally{await finalDb.end();}
 console.log('PASS final owned uploads, jobs, sessions and tenant-linked records: zero');
}
