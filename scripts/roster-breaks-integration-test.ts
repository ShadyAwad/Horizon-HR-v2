import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import {getMigrationPool} from './migration-pool';
import {assertDatabaseMutationSafety,assertHttpMutationSafety} from './mutation-safety';
const base=assertHttpMutationSafety(process.env.ROSTER_BREAK_TEST_BASE_URL||'http://localhost:3000','Roster breaks integration');
assertDatabaseMutationSafety(process.env.DATABASE_URL,'Roster breaks integration');
const pool=getMigrationPool(),tenants:string[]=[],tag=crypto.randomUUID(),password=crypto.randomBytes(20).toString('base64url');
type Person={id:string;cookie:string};
async function call(person:Person,path:string,body?:unknown,method='POST') {
 const r=await fetch(base+path,{method:body===undefined?'GET':method,headers:{Cookie:person.cookie,Origin:base,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 return {status:r.status,body:await r.json()};
}
async function person(tenant:string,name:string,manage:boolean):Promise<Person> {
 const email=name+'-'+tag+'@example.invalid';
 const row=(await pool.query('INSERT INTO employees(tenant_id,email,full_name,password_hash,role) VALUES($1,$2,$3,$4,$5) RETURNING id',[tenant,email,'Roster test '+name,await bcrypt.hash(password,10),manage?'hr_admin':'employee'])).rows[0];
 const role=(await pool.query('INSERT INTO tenant_roles(tenant_id,name) VALUES($1,$2) RETURNING id',[tenant,name])).rows[0];
 if(manage)await pool.query("INSERT INTO tenant_role_permissions(tenant_id,role_id,permission_key) VALUES($1,$2,'roster.manage')",[tenant,role.id]);
 await pool.query("INSERT INTO employee_role_assignments(tenant_id,employee_id,role_id,scope_type) VALUES($1,$2,$3,'company')",[tenant,row.id,role.id]);
 const response=await fetch(base+'/api/auth/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({email,password})});assert.equal(response.status,200);
 return {id:row.id,cookie:response.headers.get('set-cookie')!.split(';')[0]};
}
try {
 for(let i=0;i<2;i++)tenants.push((await pool.query('INSERT INTO tenants(slug,company_name) VALUES($1,$2) RETURNING id',['roster-test-'+tag+'-'+i,'Roster test'])).rows[0].id);
 const admin=await person(tenants[0],'admin',true),employee=await person(tenants[0],'employee',false),foreign=await person(tenants[1],'foreign',true);
 const body={employeeId:employee.id,startTime:'2027-06-07T06:00:00Z',endTime:'2027-06-07T14:00:00Z',plannedBreaks:[{startTime:'2027-06-07T07:00:00Z',endTime:'2027-06-07T07:15:00Z'},{startTime:'2027-06-07T09:00:00Z',endTime:'2027-06-07T09:30:00Z'}]};
 const created=await call(admin,'/api/roster/shifts',body);assert.equal(created.status,201,JSON.stringify(created.body));const id=created.body.shift.id;
 const own=await call(employee,'/api/roster/shifts?employeeId='+employee.id);assert.equal(own.status,200);assert.equal(own.body.shifts[0].planned_breaks.length,2);
 const {plannedBreaks,...legacy}=body;
 assert.equal((await call(admin,'/api/roster/shifts/'+id,legacy,'PATCH')).status,200);
 assert.equal((await call(employee,'/api/roster/shifts?employeeId='+employee.id)).body.shifts[0].planned_breaks.length,2,'Legacy caller preserves breaks');
 assert.equal((await call(admin,'/api/roster/shifts/'+id,{...body,plannedBreaks:[plannedBreaks[0],plannedBreaks[0]]},'PATCH')).status,400);
 assert.equal((await call(admin,'/api/roster/shifts/'+id,{...legacy,startTime:'2027-06-07T08:00:00Z'},'PATCH')).status,400,'Retained windows must fit edited shift');
 assert.equal((await call(employee,'/api/roster/shifts/'+id,body,'PATCH')).status,403);
 const foreignRead=await call(foreign,'/api/roster/shifts?employeeId='+employee.id);assert.equal(foreignRead.status,200);assert.deepEqual(foreignRead.body.shifts,[],'RLS hides other tenant shifts');
 assert.equal((await call(foreign,'/api/roster/shifts/'+id,body,'PATCH')).status,404);
 assert.equal((await call(admin,'/api/roster/shifts/'+id,{...body,plannedBreaks:[]},'PATCH')).status,200);
 assert.deepEqual((await call(employee,'/api/roster/shifts?employeeId='+employee.id)).body.shifts[0].planned_breaks,[]);
 console.log('PASS real HTTP/PostgreSQL multi-break create/read/update/remove, legacy preservation, bounds/overlap rejection, self read, manager-only write and tenant isolation');
} finally {for(const tenant of tenants)await pool.query('DELETE FROM tenants WHERE id=$1',[tenant]);await pool.end();}
