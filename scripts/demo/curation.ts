import {randomBytes} from 'node:crypto';
import {fixtureId,demoAmount,type DemoContext} from './core';
/** Extend the existing company with a small connected story; no delivery providers. */
export async function seedRecruiterStory(ctx:DemoContext) {
 await ctx.client.query("UPDATE company_feed_posts SET status='archived',archived_at=COALESCE(archived_at,now()) WHERE tenant_id=$1 AND title ~ '^Runtime (retry|image content|list content|rich content|double click|publish diagnosis)( [0-9]+)?$'",[ctx.tenantId]);
 const {client,tenantId:t}=ctx,admin=ctx.people.get('admin')!,employee=ctx.people.get('employee')!;
 const asset=(await client.query("SELECT a.id FROM assets a JOIN asset_assignments s ON s.asset_id=a.id AND s.tenant_id=a.tenant_id WHERE a.tenant_id=$1 AND s.employee_id=$2 AND s.status='active' ORDER BY a.name LIMIT 1",[t,employee])).rows[0];
 for(const [key,status,summary,description] of [['dock','in_progress','Laptop docking station disconnects','Sarah reports intermittent monitor disconnects at her assigned workstation. A replacement cable is being checked.'],['setup','open','New starter equipment setup','Jana needs the standard workstation checklist before her first team session.'],['card','resolved','Access-card reader check','The fictional card-reader configuration was checked and the requester confirmed access.']] as const) {
 const requester=key==='setup'?ctx.people.get('new'):employee;
 const ticket=await ctx.row('support_tickets',key,{requester_id:requester,asset_id:key==='dock'?asset?.id??null:null,assigned_to:admin,issue_type:'it_help',summary,description,urgency:'normal',status,created_at:ctx.time(-3),updated_at:ctx.time(-1)});
 await ctx.row('support_ticket_events',key,{ticket_id:ticket,actor_id:admin,status,visibility:'internal',kind:'comment',note:'Fictional technician checklist: verify the connection before replacing equipment.',created_at:ctx.time(-1)});
 }
 const location=(await client.query("SELECT id FROM company_locations WHERE tenant_id=$1 AND name='Cairo HQ'",[t])).rows[0].id;
 for(const [key,title,department] of [['engineering','Backend Engineer','Engineering'],['support','Support Specialist','IT']] as const) {
 const previous=(await client.query('SELECT public_token FROM hiring_jobs WHERE tenant_id=$1 AND id=$2',[t,fixtureId('hiring_jobs:'+key)])).rows[0];
 const job=await ctx.row('hiring_jobs',key,{public_token:previous?.public_token&&/^[A-Za-z0-9_-]{43}$/.test(previous.public_token)?previous.public_token:randomBytes(32).toString('base64url'),title,department,department_id:ctx.departments.get(department),location_id:location,description:'Fictional Northstar role: help the team deliver reliable internal services and clear employee support.',requirements:'Demonstrate practical problem solving, clear communication and collaborative delivery.',manager_id:ctx.people.get(key==='engineering'?'manager':'it-head'),owner_id:admin,status:'open',headcount:1,opens_on:ctx.date(-7),closes_on:ctx.date(30)});
 await client.query('UPDATE hiring_applicants SET job_id=$3 WHERE tenant_id=$1 AND id=$2',[t,fixtureId('hiring_applicants:'+(key==='engineering'?'9':'7')),job]);
 }
 const meeting=await ctx.row('communication_meetings','support-interview',{organizer_id:admin,title:'Northstar Support Specialist interview',notes:'Fictional interview schedule. No invitation is sent.',starts_at:ctx.time(2,11),ends_at:ctx.time(2,12),timezone:'Africa/Cairo',location:'Cairo HQ meeting room',status:'scheduled',related_employee_id:ctx.people.get('it')});
 await client.query('INSERT INTO communication_meeting_attendees(tenant_id,meeting_id,employee_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[t,meeting,admin]);
 await ctx.row('hiring_interviews','support',{applicant_id:fixtureId('hiring_applicants:7'),meeting_id:meeting,interview_type:'Structured technical discussion'});
 await ctx.row('hiring_offers','backend',{applicant_id:fixtureId('hiring_applicants:9'),created_by:admin,status:'draft',salary:demoAmount(ctx,31000),currency:ctx.currency,start_date:ctx.date(28),expires_on:ctx.date(14),notes:'Fictional draft for compensation review. No offer was sent.'});
}
