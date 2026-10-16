import type {PoolClient} from 'pg';
import {fixtureId,DEMO_SLUG,identifyDemo} from './core';
import {readManifest} from './reset';
import {seedDemoContents} from './seed';
import {backupCaseHistory,readCaseHistory,assertDemoFileOwnership,listDemoFiles,backupDemoFiles,restoreDemoFiles,type DemoFile} from './files';
export const RECOVERY_TABLES=['qr_access_tokens','document_extraction_jobs','shift_swap_history','shift_swap_requests','performance_goal_updates','performance_goals','outbox_events','hiring_evaluations','hiring_application_reviews','hiring_interviews','hiring_offers','hiring_handoffs','hiring_applicant_notes','hiring_stage_history','hiring_applicants','hiring_jobs','support_ticket_events','support_tickets','company_feed_drafts','company_feed_images','company_feed_posts','communication_messages','communication_meetings','leave_request_history','leave_requests','expense_claim_history','expense_claims','asset_condition_reports','asset_assignments','assets','attendance_early_leave_requests','attendance_breaks','break_requests','time_logs','roster_shifts','roster_goals','grievance_attachments','grievances','user_webauthn_credentials','webauthn_challenges'] as const;
const checkpointId=fixtureId('audit_logs:recovery-checkpoint');
type Checkpoint={version:1;tenantId:string;ids:Record<string,string[]>;jobs:string[];files:DemoFile[];avatars:Record<string,string|null>;caseHistoryChecksum:string};
const historyTables=['grievance_case_events','grievance_messages','grievance_attachments'] as const;
export async function lockRecovery(client:PoolClient) {
 await client.query("SET LOCAL lock_timeout='5s'");
 if(!(await client.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS locked',['demo-seed:'+DEMO_SLUG])).rows[0].locked)throw Error('Another demo seed/reset is running.');
 const tenant=await identifyDemo(client);
 if(!tenant||tenant.demo!=='true'||!process.env.DEMO_TENANT_ID||tenant.id!==process.env.DEMO_TENANT_ID)throw Error('Recovery requires the exact DEMO_TENANT_ID and positive demo marker.');
 const people=await client.query('SELECT email FROM employees WHERE tenant_id=$1 AND email=ANY($2::text[])',[tenant.id,['admin@stanza-demo.com','manager@stanza-demo.com','employee@stanza-demo.com']]);
 if(people.rowCount!==3)throw Error('Recovery requires all three existing demo login identities.');
 await client.query("SELECT set_config('app.current_tenant',$1,true)",[tenant.id]);return tenant;
}
export async function prepareRecovery(client:PoolClient,tenantId:string,jobs:string[]=[]) {
 if((await client.query('SELECT 1 FROM audit_logs WHERE tenant_id=$1 AND id=$2',[tenantId,checkpointId])).rowCount)throw Error('A recovery checkpoint already exists; it is never overwritten implicitly.');
 const manifest=await readManifest(client,tenantId);if(!manifest.employees?.length)throw Error('Seed the existing demo before registering recovery.');
 const files=await listDemoFiles(client,tenantId);await assertDemoFileOwnership(client,files,tenantId);await backupDemoFiles(files,tenantId);
 const avatars=Object.fromEntries((await client.query('SELECT id,profile_image_url FROM employees WHERE tenant_id=$1',[tenantId])).rows.map(r=>[r.id,r.profile_image_url]));
 const ids:Record<string,string[]>={};for(const table of RECOVERY_TABLES)ids[table]=(await client.query(`SELECT id FROM ${table} WHERE tenant_id=$1 ORDER BY id`,[tenantId])).rows.map(r=>r.id);
 const caseHistory:Record<string,Record<string,unknown>[]>={};for(const table of historyTables)caseHistory[table]=(await client.query(`SELECT to_jsonb(r) AS row FROM ${table} r WHERE tenant_id=$1 AND case_id=ANY($2::uuid[]) ORDER BY id`,[tenantId,manifest.grievances??[]])).rows.map(r=>r.row);
 await client.query("INSERT INTO audit_logs(id,tenant_id,action,entity_type,entity_id,metadata) VALUES($1,$2,'demo.recovery_checkpoint','demo_seed',$2,$3::jsonb)",[checkpointId,tenantId,JSON.stringify({version:1,tenantId,ids,caseHistoryChecksum:await backupCaseHistory(tenantId,caseHistory),files,avatars,jobs} satisfies Checkpoint)]);
}
export async function recoverDemo(client:PoolClient,tenant:{id:string;default_currency:string;allows_company_loans:boolean},onPhase:(phase:string)=>void=()=>{}) {
 const t=tenant.id,checkpoint=(await client.query('SELECT metadata FROM audit_logs WHERE tenant_id=$1 AND id=$2',[t,checkpointId])).rows[0]?.metadata as Checkpoint|undefined;
 if(!checkpoint||checkpoint.version!==1||checkpoint.tenantId!==t||RECOVERY_TABLES.some(table=>!Array.isArray(checkpoint.ids?.[table])||checkpoint.ids[table].length>10000||checkpoint.ids[table].some(id=>typeof id!=='string'||!/^[0-9a-f-]{36}$/i.test(id))))throw Error('Missing or invalid recovery checkpoint. Use demo:reset --initialize once after curation.');
 if(!Array.isArray(checkpoint.files)||!checkpoint.avatars)throw Error('Incomplete recovery checkpoint.');
 const protectedFiles=new Set(checkpoint.files.map(f=>f.kind+':'+f.key));const cleanupFiles=(await listDemoFiles(client,t)).filter(f=>!protectedFiles.has(f.kind+':'+f.key));
 const manifest=await readManifest(client,t);onPhase('remove public additions');let removed=0;
 // Explicit table order; all values parameterized and every deletion tenant-bound.
 for(const table of RECOVERY_TABLES){const r=await client.query(`DELETE FROM ${table} WHERE tenant_id=$1 AND NOT(id=ANY($2::uuid[]))`,[t,checkpoint.ids[table]]);removed+=r.rowCount??0;}
 await client.query("DELETE FROM attendance_daily_summaries s WHERE tenant_id=$1 AND NOT EXISTS(SELECT 1 FROM time_logs l WHERE l.tenant_id=s.tenant_id AND l.employee_id=s.employee_id AND (l.clock_in_time AT TIME ZONE 'UTC')::date=s.work_date)",[t]);
 const caseHistory=await readCaseHistory(t,checkpoint.caseHistoryChecksum);
 onPhase('restore curated case history');await client.query('DELETE FROM grievances WHERE tenant_id=$1 AND id=ANY($2::uuid[])',[t,manifest.grievances??[]]);
 onPhase('reseed existing company');await seedDemoContents(client,tenant);
 for(const table of historyTables){const rows=caseHistory[table];if(!Array.isArray(rows))throw Error('Invalid recovery case history.');for(const row of rows){if(row.tenant_id!==t||!(manifest.grievances??[]).includes(String(row.case_id)))throw Error('Foreign recovery case history.');await client.query(`INSERT INTO ${table} SELECT (jsonb_populate_record(NULL::${table},$1::jsonb)).* ON CONFLICT(id) DO NOTHING`,[JSON.stringify(row)]);}}
 onPhase('restore baseline files');await assertDemoFileOwnership(client,checkpoint.files,t);await restoreDemoFiles(checkpoint.files,t);
 for(const [employeeId,url]of Object.entries(checkpoint.avatars))await client.query('UPDATE employees SET profile_image_url=$3 WHERE tenant_id=$1 AND id=$2',[t,employeeId,url]);
 onPhase('invalidate demo sessions');await client.query('DELETE FROM auth_sessions WHERE tenant_id=$1',[t]);
 await client.query("INSERT INTO audit_logs(tenant_id,action,entity_type,entity_id,metadata) VALUES($1,'demo.recovered','demo_seed',$1,$2::jsonb)",[t,JSON.stringify({removed,sessionPolicy:'sign_in_again',cleanupFiles,protectedJobs:checkpoint.jobs,cleanupPending:true})]);return removed;
}
