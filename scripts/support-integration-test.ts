import './router-env';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import express from 'express';
import sharp from 'sharp';
import {registerAssetEvidenceRoutes} from '../src/server/assets/asset-evidence-routes';
import {assetEvidenceStorage} from '../src/lib/asset-evidence-storage';
import type {AddressInfo} from 'node:net';
import {once} from 'node:events';
import {getMigrationPool} from './migration-pool';
import {assertDatabaseMutationSafety} from './mutation-safety';
import {withTenant,closeHrResources} from '../src/lib/hr-background';
import {registerSupportRoutes} from '../src/server/support/support-routes';
assertDatabaseMutationSafety(process.env.DATABASE_URL,'Support integration');
const db=getMigrationPool(),tag=randomUUID(),tenants:string[]=[],actors=new Map<string,NonNullable<express.Request['authUser']>>();
const app=express();app.use(express.json());registerSupportRoutes(app,{standardAuth:(r,s,n)=>{const u=actors.get(String(r.headers['x-test-actor']));if(!u){s.sendStatus(401);return;}r.authUser=u;n();},mutationGuard:(_r,_s,n)=>n(),rateLimiter:(_r,_s,n)=>n()});
registerAssetEvidenceRoutes(app,{standardAuth:(r,s,n)=>{const u=actors.get(String(r.headers['x-test-actor']));if(!u){s.sendStatus(401);return;}r.authUser=u;n();},rateLimiter:(_r,_s,n)=>n(),isSameOriginRequest:()=>true});
const server=app.listen(0,'127.0.0.1');await once(server,'listening');const addr=server.address();assert(addr&&typeof addr!=='string');
async function api(actor:string,path:string,body?:object){const r=await fetch('http://127.0.0.1:'+(addr as AddressInfo).port+'/api/support'+path,{method:body?'POST':'GET',headers:{'x-test-actor':actor,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,...await r.json()};}
async function employee(t:string,name:string,support=false){const id=(await db.query("INSERT INTO employees(tenant_id,email,full_name,role,password_hash) VALUES($1,$2,$3,'employee','test-no-login') RETURNING id",[t,name+'-'+tag+'@example.invalid',name])).rows[0].id;actors.set(name,{employeeId:id,tenantId:t,email:name+'@example.invalid',role:'hr_admin',permissions:['support.manage','support.view']});if(support){const role=(await db.query('INSERT INTO tenant_roles(tenant_id,name,is_system) VALUES($1,$2,false) RETURNING id',[t,'IT '+name])).rows[0].id;for(const k of ['support.view','support.manage'])await db.query('INSERT INTO tenant_role_permissions(tenant_id,role_id,permission_key) VALUES($1,$2,$3)',[t,role,k]);await db.query("INSERT INTO employee_role_assignments(tenant_id,employee_id,role_id,scope_type) VALUES($1,$2,$3,'company')",[t,id,role]);}return id;}
try{for(const label of ['a','b'])tenants.push((await db.query('INSERT INTO tenants(slug,company_name) VALUES($1,$2) RETURNING id',['support-'+label+'-'+tag,'Support fixture '+label])).rows[0].id);const [a,b]=tenants;const owner=await employee(a,'requester'),peer=await employee(a,'peer'),handler=await employee(a,'handler',true),foreign=await employee(b,'foreign',true);
 const asset=(await db.query("INSERT INTO assets(tenant_id,asset_tag,name,category,status) VALUES($1,$2,'Test laptop','laptop','assigned') RETURNING id",[a,tag])).rows[0].id;await db.query('INSERT INTO asset_assignments(tenant_id,asset_id,employee_id) VALUES($1,$2,$3)',[a,asset,owner]);
 const body={assetId:asset,issueType:'damage',summary:'Screen damaged',description:'Fictional equipment damage for integration test',urgency:'normal'};
 assert.equal((await api('peer','',body)).status,404);assert.equal((await api('foreign','',body)).status,404);assert.equal((await api('requester','?queue=true')).status,403,'forged role/claims do not grant queue');
 const created=await api('requester','',body);assert.equal(created.status,201);assert.equal(created.ticket.assigned_to,handler);assert.equal(created.ticket.requester_id,owner);const id=created.ticket.id;
 assert.equal((await api('requester','')).tickets.length,1);assert.equal((await api('peer','')).tickets.length,0);assert.equal((await api('peer','/'+id)).status,404);assert.equal((await api('foreign','/'+id)).status,404);assert.equal((await api('handler','?queue=true')).tickets.length,1);
 assert.equal((await api('requester','/'+id+'/update',{status:'resolved'})).status,403);assert.equal((await api('handler','/'+id+'/update',{status:'resolved',assignedTo:foreign})).status,403);assert.equal((await api('handler','/'+id+'/update',{status:'in_progress',assignedTo:handler,note:'Fictional repair queued'})).status,201);
 const detail=await api('requester','/'+id);assert.equal(detail.ticket.status,'in_progress');assert.equal(detail.history.length,2);assert.equal((await api('requester','',{...body,issueType:'it_help',assetId:undefined})).status,201);assert.equal((await api('requester','',{...body,issueType:'equipment_issue'})).status,201);
 assert.equal((await api('requester','',{...body,summary:'',assignedTo:foreign})).status,400);assert.equal((await api('requester','',{...body,evidenceReportId:randomUUID()})).status,404);
 // Exercise the real decoded upload, private storage and ticket-linked handler read.
 for(const actor of actors.values())actor.role='employee';
 const image=await sharp({create:{width:16,height:16,channels:3,background:'#ffffff'}}).png().toBuffer();const upload=new FormData();upload.set('image',new Blob([new Uint8Array(image)],{type:'image/png'}),'fixture.png');upload.set('condition','damaged');upload.set('notes','Fictional evidence test');
 const base='http://127.0.0.1:'+(addr as AddressInfo).port;
 const response=await fetch(base+'/api/assets/'+asset+'/evidence',{method:'POST',headers:{'x-test-actor':'requester'},body:upload});assert.equal(response.status,201);const report=(await response.json()).report.id;
 const evidenceRead=async(actor:string)=>(await fetch(base+'/api/assets/evidence/'+report,{headers:{'x-test-actor':actor}})).status;
 assert.equal(await evidenceRead('requester'),200);assert.equal(await evidenceRead('handler'),404,'support capability alone cannot read unlinked reports');
 assert.equal((await api('requester','',{...body,evidenceReportId:report})).status,201);assert.equal(await evidenceRead('handler'),200,'authorized handler sees ticket-linked evidence');assert.equal(await evidenceRead('peer'),404);assert.equal(await evidenceRead('foreign'),404);
 await withTenant(b,async c=>{assert.equal((await c.query('SELECT * FROM support_tickets WHERE id=$1',[id])).rowCount,0);assert.equal((await c.query('SELECT * FROM support_ticket_events WHERE ticket_id=$1',[id])).rowCount,0);});
 assert(Number((await db.query("SELECT count(*) FROM audit_logs WHERE tenant_id=$1 AND action='support.updated'",[a])).rows[0].count)>=4);
 await db.query("UPDATE employees SET is_active=false WHERE id=$1",[handler]);assert.equal((await api('handler','?queue=true')).status,403);const unassigned=await api('requester','',{...body,issueType:'it_help',assetId:undefined});assert.equal(unassigned.ticket.assigned_to,null,'no cross-tenant fallback when no authorized active handler');
 console.log('PASS real support creation, assigned asset ownership, company capability routing, requester history, forged permissions, status updates, same-tenant handler validation, audit and stanza_runtime RLS.');
}finally{await new Promise<void>(resolve=>server.close(()=>resolve()));for(const row of (await db.query('SELECT evidence_url FROM asset_condition_reports WHERE tenant_id=ANY($1::uuid[]) AND evidence_url IS NOT NULL',[tenants])).rows)await assetEvidenceStorage.remove(row.evidence_url);await db.query('DELETE FROM support_tickets WHERE tenant_id=ANY($1::uuid[])',[tenants]);await db.query('DELETE FROM asset_condition_reports WHERE tenant_id=ANY($1::uuid[])',[tenants]);await db.query('DELETE FROM asset_assignments WHERE tenant_id=ANY($1::uuid[])',[tenants]);await db.query('DELETE FROM assets WHERE tenant_id=ANY($1::uuid[])',[tenants]);await db.query('DELETE FROM tenants WHERE id=ANY($1::uuid[])',[tenants]);await db.end();await closeHrResources();}
