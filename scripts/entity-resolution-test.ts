import 'dotenv/config';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import express from 'express';
import {once} from 'node:events';
import {getMigrationPool} from './migration-pool';
import {assertDatabaseMutationSafety} from './mutation-safety';
import {withTenant,closeHrResources} from '../src/lib/hr-background';
import {entityResolvers} from '../src/server/intelligent-router/entity-resolvers';
import {executeEntityIntent} from '../src/server/intelligent-router/entity-execution';
import {generalizeEntities,safeEntityTemplate,findEntitySpan} from '../src/lib/router-entities';
import {registerIntelligentRouterRoutes} from '../src/server/intelligent-router/routes';
import {createEmbedding,routerConfig} from '../src/server/intelligent-router/config';
import {validateReasoning} from '../src/server/intelligent-router/providers';
import {createCandidate,promoteCandidate,PgSemanticSearch} from '../src/server/intelligent-router/store';
import {handlerVisibilitySql} from '../src/server/grievances/grievance-policy';
import {getIntent,normalizeQuery} from '../src/lib/intelligent-router';
assertDatabaseMutationSafety(process.env.DATABASE_URL,'Entity integration');
const admin=getMigrationPool(),tag=randomUUID(),tenants:string[]=[],actors=new Map<string,NonNullable<Express.Request['authUser']>>();
for(const query of ['show me my grievance','show me grievance inbox','open my grievance history'])assert.equal(getIntent('employee_grievance_lookup')!.rule!.test(query),false,'entity classification preserves personal/inbox routing');
const config=routerConfig(),embedding=createEmbedding(config)!;
const app=express();app.use(express.json());
registerIntelligentRouterRoutes(app,{standardAuth:(req,res,next)=>{const u=actors.get(String(req.headers['x-test-actor']));if(!u){res.status(401).json({});return;}req.authUser=u;next();},mutationGuard:(_req,_res,next)=>next(),rateLimiter:(_req,_res,next)=>next()}, {config:{...config,learning:true},embedding,authorization:{resolve:async()=>({state:'disabled'})}});
const server=app.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert(address&&typeof address!=='string');const base=`http://127.0.0.1:${address.port}`;
async function api(who:string,path:string,body:object){const r=await fetch(base+'/api/command-router'+path,{method:'POST',headers:{'x-test-actor':who,'Content-Type':'application/json'},body:JSON.stringify(body)});return {http:r.status,...await r.json()};}
async function person(tenant:string,name:string,permissions:string[],key:string){
 const id=(await admin.query("INSERT INTO employees(tenant_id,email,full_name,password_hash) VALUES($1,$2,$3,'fixture-no-login') RETURNING id",[tenant,`${key}-${tag}@example.invalid`,name])).rows[0].id;
 if(permissions.length){const role=(await admin.query('INSERT INTO tenant_roles(tenant_id,name) VALUES($1,$2) RETURNING id',[tenant,key])).rows[0].id;for(const permission of permissions)await admin.query('INSERT INTO tenant_role_permissions(tenant_id,role_id,permission_key) VALUES($1,$2,$3)',[tenant,role,permission]);await admin.query("INSERT INTO employee_role_assignments(tenant_id,employee_id,role_id,scope_type) VALUES($1,$2,$3,'company')",[tenant,id,role]);}
 actors.set(key,{tenantId:tenant,employeeId:id,role:'employee',email:`${key}-${tag}@example.invalid`});return id as string;
}
async function location(tenant:string,name:string){return (await admin.query("INSERT INTO company_locations(tenant_id,name,latitude,longitude,radius_meters,boundary) VALUES($1,$2,30,31,100,ST_GeomFromText('POLYGON((30 30,31 30,31 31,30 31,30 30))',4326)) RETURNING id",[tenant,name])).rows[0].id as string;}
async function team(tenant:string,site:string,name:string){return (await admin.query('INSERT INTO organisation_teams(tenant_id,name,location_id) VALUES($1,$2,$3) RETURNING id',[tenant,name,site])).rows[0].id;}
async function grievance(tenant:string,employee:string,reference:string,confidential=false){return (await admin.query("INSERT INTO grievances(tenant_id,employee_id,title,description,category,case_number,status,confidentiality) VALUES($1,$2,'Fixture conduct case','Fictional test detail','conduct',$3,'submitted',$4) RETURNING id",[tenant,employee,reference,confidential?'confidential':'standard'])).rows[0].id;}
try {
 for(let i=0;i<2;i++)tenants.push((await admin.query('INSERT INTO tenants(slug,company_name) VALUES($1,$2) RETURNING id',[`entity-${tag}-${i}`,'Disposable entity fixture'])).rows[0].id);
 const [a,b]=tenants,handler=await person(a,'Fixture Handler',['grievances.view','grievances.confidential','roles.manage','semantic.review_candidates'],'handler');await person(a,'Standard Handler',['grievances.view'],'standard');await person(a,'Denied Handler',[],'denied');
 const ahmed=await person(a,'Ahmed Hassan',[],'ahmed'),ali=await person(a,'Ahmed Ali',[],'ali'),arabic=await person(a,'أحمد حَسَن',[],'arabic'),secret=await person(a,'Private Reporter',[],'secret');
 const foreign=await person(b,'Ahmed Hassan',[],'foreign');await person(b,'Mona Ali',[],'foreign-only');
 const site=await location(a,'Cairo Warehouse'),foreignSite=await location(b,'Cairo Warehouse'),otherSite=await location(a,'Cairo Office');const t=await team(a,site,'Cairo team');
 await admin.query('UPDATE employees SET team_id=$2 WHERE tenant_id=$1 AND id=ANY($3::uuid[])',[a,t,[ahmed,ali,arabic,secret]]);
 const caseId=await grievance(a,ahmed,'GRV-2026-000001');await grievance(a,ali,'GRV-2026-000002');await grievance(a,arabic,'GRV-2026-000003');await grievance(a,secret,'GRV-2026-000004',true);await grievance(b,foreign,'GRV-2026-000001');
 const department=(await admin.query("INSERT INTO organisation_departments(tenant_id,name) VALUES($1,'Scoped department') RETURNING id",[a])).rows[0].id;
 const scoped=await person(a,'Scoped Handler',['grievances.view'],'scoped');await admin.query("UPDATE employee_role_assignments SET scope_type='department',scope_id=$2 WHERE employee_id=$1",[scoped,department]);
 const actor={tenantId:a,employeeId:handler},query="show me Ahmed Hassan's disciplinary grievance from Cairo warehouse";
 await admin.query('UPDATE grievances SET assigned_department_id=$2 WHERE id=$1',[caseId,department]);
 const scopedResult=await withTenant(a,c=>executeEntityIntent(c,{tenantId:a,employeeId:scoped},"show me Ahmed's grievance"));assert.equal(scopedResult.caseId,caseId,'department scope discovers only visible case reporter');
 assert.equal((await withTenant(a,c=>executeEntityIntent(c,{tenantId:a,employeeId:scoped},"show me Ahmed Ali's grievance"))).status,'unresolved');
 const result=await withTenant(a,c=>executeEntityIntent(c,actor,query));assert.equal(result.status,'resolved');assert.equal(result.caseId,caseId);assert.equal(result.entities[0].entityId,ahmed);assert.equal(result.entities[1].entityId,site);assert(!JSON.stringify(result).includes(foreign));assert(!JSON.stringify(result).includes(foreignSite));
 for(const q of ["show me Ahmed Hassan's grievance",'find Ahmed Hassan disciplinary case','show Ahmed Hassan grievance from Cairo warehouse'])assert.equal((await withTenant(a,c=>executeEntityIntent(c,actor,q))).caseId,caseId,q);
 const ambiguous=await withTenant(a,c=>executeEntityIntent(c,actor,"show me Ahmed's grievance"));assert.equal(ambiguous.status,'ambiguous');assert.deepEqual(new Set(ambiguous.entities[0].candidates!.map(r=>r.id)),new Set([ahmed,ali]));assert.equal(ambiguous.caseId,undefined);
 assert.equal((await withTenant(a,c=>executeEntityIntent(c,actor,"show me Ahmed's grievance",{employee:ahmed}))).caseId,caseId);
 assert.equal((await withTenant(a,c=>executeEntityIntent(c,actor,"show me Ahmed's grievance",{employee:foreign}))).status,'unresolved');
 for(const q of ["show me Mona Ali's grievance",'open EMP-123 grievance',"show me Nobody Unique's grievance",'show Ahmed Hassan grievance from Missing warehouse'])assert.equal((await withTenant(a,c=>executeEntityIntent(c,actor,q))).status,'unresolved',q);
 assert.equal((await withTenant(a,c=>executeEntityIntent(c,actor,'show Ahmed Hassan grievance from Cairo Office'))).status,'unresolved');
 const officeTeam=await team(a,otherSite,'Office team');await admin.query('UPDATE employees SET team_id=$2 WHERE id=$1',[ali,officeTeam]);
 const ambiguousLocation=await withTenant(a,c=>entityResolvers.location({client:c,actor,query:'from Cairo'}));assert.equal(ambiguousLocation.status,'ambiguous');assert.equal(ambiguousLocation.candidates!.length,2);
 assert.equal((await withTenant(a,c=>executeEntityIntent(c,actor,'show Ahmed Hassan grievance from Cairo',{location:site}))).caseId,caseId);
 assert.equal((await withTenant(a,c=>executeEntityIntent(c,{tenantId:a,employeeId:actors.get('denied')!.employeeId},query))).status,'forbidden');
 assert.equal((await withTenant(a,c=>executeEntityIntent(c,{tenantId:a,employeeId:actors.get('standard')!.employeeId},"show me Private Reporter's grievance"))).status,'unresolved');
 assert.equal((await withTenant(a,c=>executeEntityIntent(c,actor,"show me Private Reporter's grievance"))).status,'resolved');
 assert.equal((await withTenant(a,c=>executeEntityIntent(c,actor,'وريني الشكوى بتاعت أحمد حسن من Cairo Warehouse'))).entities[0].entityId,arabic);
 assert.equal((await withTenant(a,c=>executeEntityIntent(c,actor,`open ${ahmed} grievance`))).caseId,caseId);
 const email=`ahmed-${tag}@example.invalid`;assert.equal((await withTenant(a,c=>executeEntityIntent(c,actor,`open ${email} grievance`))).caseId,caseId);
 assert.equal((await withTenant(a,c=>executeEntityIntent(c,actor,query,{}, {employeeName:'Ahmed Ali'}))).status,'unresolved','model parameters must occur in original query');
 assert.throws(()=>validateReasoning({status:'resolved',proposedIntentKey:'employee_grievance_lookup',suggestedParameters:{sql:'DROP TABLE'}}));
 assert.equal((await withTenant(a,c=>executeEntityIntent(c,actor,query,{}, {employeeName:'Mona Ali'}))).status,'unresolved','GPT text proves neither existence nor authorization');
 const template=generalizeEntities(query,result.entities)!;assert.equal(template.text,"show me {employee}'s disciplinary grievance from {location}");assert(safeEntityTemplate(template));assert.equal(template.placeholders.length,2);assert(!JSON.stringify(template).includes('Ahmed'));assert(!JSON.stringify(template).includes('Cairo'));assert(!JSON.stringify(template).includes(ahmed));
 assert.equal(findEntitySpan('Ahmedology','Ahmed','employee'),undefined);assert.equal(generalizeEntities(query,[{...result.entities[0],span:{type:'employee',start:1,end:20}},{...result.entities[1],span:{type:'location',start:2,end:25}}]),undefined);assert(!safeEntityTemplate({...template,text:template.text+' Secret Name'}));
 const http=await api('handler','/resolve',{query,allowReasoning:false,learn:true});assert.equal(http.http,200);assert.equal(http.result.intentKey,'employee_grievance_lookup');assert.equal(http.result.entityRoute.caseId,caseId);assert.equal(http.result.fallbackUsed,false);assert(http.result.candidateId);
 const candidate=(await admin.query('SELECT normalized_query,entity_template,resolution_source FROM router_candidates WHERE id=$1',[http.result.candidateId])).rows[0];assert.equal(candidate.normalized_query,normalizeQuery(template.text));assert.deepEqual(candidate.entity_template,template);assert.equal(candidate.resolution_source,'entity');
 assert.equal((await api('handler','/resolve',{query,learn:true})).result.candidateId,undefined,'idempotent candidate');
 assert.equal((await api('handler',`/candidates/${http.result.candidateId}/confirm`,{})).http,200);
 assert.equal((await api('handler',`/candidates/${http.result.candidateId}/review`,{decision:'approve'})).http,200);
 const learned=(await admin.query('SELECT example_text,entity_template FROM router_semantic_examples WHERE tenant_id=$1 AND intent_key=$2',[a,'employee_grievance_lookup'])).rows;assert(learned.every(r=>!r.example_text.includes('ahmed')&&!r.example_text.includes('cairo')));
 const learningQuery='open Ahmed Hassan grievance from Cairo Warehouse',learningTemplate=generalizeEntities(learningQuery,result.entities.map(e=>({...e,span:findEntitySpan(learningQuery,e.label!,e.type)})))!;
 const learningCandidate=await withTenant(a,c=>createCandidate(c,a,handler,learningQuery,{...http.result,entityTemplate:learningTemplate}));assert(learningCandidate);
 await admin.query("UPDATE router_candidates SET confirmation_state='confirmed' WHERE id=$1",[learningCandidate]);
 const fixtureProvider={model:'entity-learning-fixture',dimensions:3,version:'1',embed:async()=>[1,0,0]};
 const conflict=(await admin.query("INSERT INTO router_semantic_examples(tenant_id,intent_key,example_text,normalized_text,embedding,embedding_model,embedding_dimensions,embedding_version,source,approval_state) VALUES($1,'my_grievances','different phrase','different phrase','[1,0,0]',$2,3,'1','tenant','approved') RETURNING id",[a,fixtureProvider.model])).rows[0].id;
 await assert.rejects(promoteCandidate(a,handler,learningCandidate,fixtureProvider,async()=>true),/CONTRADICTORY_EXAMPLE/);
 await admin.query('DELETE FROM router_semantic_examples WHERE tenant_id=$1 AND id=$2',[a,conflict]);
 assert.equal((await promoteCandidate(a,handler,learningCandidate,fixtureProvider,async()=>true)).promoted,true);
 const promoted=(await admin.query('SELECT example_text,entity_template FROM router_semantic_examples WHERE tenant_id=$1 AND embedding_model=$2',[a,fixtureProvider.model])).rows[0];assert.deepEqual(promoted.entity_template,learningTemplate);assert(!JSON.stringify(promoted).includes('Ahmed'));assert(!JSON.stringify(promoted).includes('Cairo'));
 assert.equal((await new PgSemanticSearch(a,12).search([1,0,0],fixtureProvider,['employee_grievance_lookup']))[0].intentKey,'employee_grievance_lookup');
 console.log('PASS typed-template promotion/embedding/search contract and cross-intent near-duplicate rejection (isolated fixture vectors)');
 assert.equal((await api('denied','/resolve',{query,allowReasoning:false})).result.entityRoute,undefined);
 assert.equal((await api('handler','/resolve',{query,entityChoices:{employee:foreign}})).result.entityRoute.status,'unresolved');
 assert.equal((await api('handler','/resolve',{query,entityChoices:{employee:'bad'}})).http,400);
 console.log('PASS real PostgreSQL/runtime HTTP: exact/partial/ambiguous employee, location, IDs/email, Arabic, private/confidential/cross-tenant isolation, forged choices, untrusted GPT parameters and learning approval');
 // Realistic tenant density without touching demo tenants. Every fixture employee has a visible case.
 await admin.query("INSERT INTO company_locations(tenant_id,name,latitude,longitude,radius_meters,boundary) SELECT $1,'Site '||n,30,31,100,ST_GeomFromText('POLYGON((30 30,31 30,31 31,30 31,30 30))',4326) FROM generate_series(1,1000) n",[a]);
 await admin.query("INSERT INTO employees(tenant_id,email,full_name,password_hash,team_id) SELECT $1,'fixture-'||n||'@example.invalid','Fixture Person '||n,'no-login',$2 FROM generate_series(1,10000) n",[a,t]);
 await admin.query("INSERT INTO grievances(tenant_id,employee_id,title,description,category,case_number,status) SELECT $1,id,'Density fixture','Fictional','conduct','GRV-2026-'||lpad((100000+row_number() OVER())::text,6,'0'),'submitted' FROM employees WHERE tenant_id=$1 AND full_name LIKE 'Fixture Person %'",[a]);
 await admin.query('ANALYZE employees');await admin.query('ANALYZE company_locations');await admin.query('ANALYZE grievances');
 await withTenant(a,async c=>{
  const before=`SELECT e.id FROM company_locations e WHERE e.tenant_id=$1 AND e.is_active AND regexp_split_to_array(stanza_entity_normalize(e.name),' ') && ARRAY['cairo','warehouse']::text[] AND EXISTS(SELECT 1 FROM organisation_teams team JOIN employees target ON target.tenant_id=team.tenant_id AND target.team_id=team.id JOIN grievances g ON g.tenant_id=target.tenant_id AND g.employee_id=target.id WHERE team.tenant_id=e.tenant_id AND team.location_id=e.id AND ${handlerVisibilitySql()}) ORDER BY e.id LIMIT 51`;
  const after=before.replace(') ORDER BY e.id',' LIMIT 1 OFFSET 0) ORDER BY e.id');
  const plans=[];for(const [label,sql] of [['before',before],['after',after]]){const plan=(await c.query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+sql,[a,actor.employeeId])).rows[0]['QUERY PLAN'][0];const nodes:{node:string;rows:number;loops:number}[]=[];const walk=(p:Record<string,unknown>)=>{nodes.push({node:String(p['Node Type']),rows:Number(p['Actual Rows']),loops:Number(p['Actual Loops'])});for(const child of (p.Plans??[]) as Record<string,unknown>[])walk(child);};walk(plan.Plan);plans.push({label,executionMs:plan['Execution Time'],maxLoops:Math.max(...nodes.map(n=>n.loops))});}
  console.log(JSON.stringify({locationQueryPlans:plans}));
 });
 const employeeTimes:number[]=[],locationTimes:number[]=[],routeTimes:number[]=[],counts:number[]=[];
 for(let n=0;n<60;n++)await withTenant(a,async c=>{const start=performance.now();const r=await executeEntityIntent(c,actor,query);routeTimes.push(performance.now()-start);assert.equal(r.caseId,caseId);employeeTimes.push(r.entities[0].latencyMs);locationTimes.push(r.entities[1].latencyMs);counts.push(...r.entities.map(e=>e.evaluated));});
 const stats=(values:number[])=>{const v=[...values].sort((a,b)=>a-b);return {p50:v[Math.ceil(v.length*.5)-1],p95:v[Math.ceil(v.length*.95)-1]};};
 const httpTimes:number[]=[];for(let n=0;n<30;n++){const start=performance.now();const r=await api('handler','/resolve',{query,allowReasoning:false});httpTimes.push(performance.now()-start);assert.equal(r.result.entityRoute.caseId,caseId);assert.equal(r.result.fallbackUsed,false);}
 const broad=await withTenant(a,c=>entityResolvers.employee({client:c,actor,query:'Fixture'}));assert.equal(broad.status,'ambiguous');assert.equal(broad.evaluated,50);assert.equal(broad.truncated,true);assert.equal(broad.candidates!.length,8);
 console.log(JSON.stringify({fixtureEmployees:10000,fixtureLocations:1000,samples:60,employeeMs:stats(employeeTimes),locationMs:stats(locationTimes),entityExecutionMs:stats(routeTimes),overallHttpRouteMs:stats(httpTimes),httpSamples:httpTimes.length,candidates:{min:Math.min(...counts),max:Math.max(...counts)},broadQuery:{evaluated:broad.evaluated,returned:broad.candidates!.length,truncated:broad.truncated}}));
} finally {await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));await embedding?.close?.();for(const tenant of tenants){await admin.query('DELETE FROM router_operational_metrics WHERE tenant_id=$1',[tenant]);await admin.query('DELETE FROM tenants WHERE id=$1',[tenant]);}await admin.end();await closeHrResources();}
