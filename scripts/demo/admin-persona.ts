import bcrypt from 'bcryptjs';
import {DEMO_ADMIN_EMAIL,PUBLIC_DEMO_PASSWORD} from '../../src/lib/demo-personas';
import {PERMISSION_REGISTRY,validatePermissionKeys} from '../../src/server/organisation/permission-registry';
import {fixtureId,type DemoContext} from './core';
import {fullDemoPermissions} from './full-demo-permissions';
/** Tenant capabilities only; operator authority remains a separate registry. */
export const demoAdminPermissions=fullDemoPermissions;
export async function seedDemoTenantAdmin(ctx:DemoContext){
 const {client,tenantId:t}=ctx;
 if(!(await client.query('SELECT 1 FROM tenants WHERE id=$1 AND is_demo_tenant AND slug=$2',[t,'stanza-demo'])).rowCount)throw Error('Demo Admin requires the positively marked demo tenant');
 if(!validatePermissionKeys(demoAdminPermissions)||demoAdminPermissions.some(key=>key.startsWith('platform.')||!PERMISSION_REGISTRY.some(p=>p.key===key)))throw Error('Invalid Demo Admin permission boundary');
 const existing=(await client.query('SELECT id,password_hash FROM employees WHERE tenant_id=$1 AND email=$2',[t,DEMO_ADMIN_EMAIL])).rows[0];
 const id=fixtureId('employees:tenant-admin');
 if((await client.query('SELECT 1 FROM employee_role_assignments WHERE tenant_id=$1 AND role_id=$2 AND employee_id<>$3',[t,fixtureId('tenant_roles:tenant-admin'),id])).rowCount)throw Error('Full Demo role is not exclusively owned by its dedicated principal');if(existing&&existing.id!==id)throw Error('Demo Admin identity collision');
 if(!existing)await ctx.row('employees','tenant-admin',{full_name:'Leila Tarek',email:DEMO_ADMIN_EMAIL,password_hash:await bcrypt.hash(PUBLIC_DEMO_PASSWORD,12),role:'employee',job_title:'Full demo tenant explorer',is_active:true,employment_status:'active'});
 else await client.query("UPDATE employees SET role='employee',is_active=true,employment_status='active' WHERE tenant_id=$1 AND id=$2",[t,id]);
 if(existing&&!await bcrypt.compare(PUBLIC_DEMO_PASSWORD,existing.password_hash))await client.query('UPDATE employees SET password_hash=$3 WHERE tenant_id=$1 AND id=$2',[t,id,await bcrypt.hash(PUBLIC_DEMO_PASSWORD,12)]);
 ctx.tables.get('employees')?.delete(id);ctx.people.set('tenant-admin',id);
 if((await client.query('SELECT 1 FROM router_platform_authorities WHERE employee_id=$1',[id])).rowCount)throw Error('Public Demo Admin cannot hold platform authority');
 const role=await ctx.row('tenant_roles','tenant-admin',{name:'Full Demo',description:'Complete tenant product exploration; no platform or operator authority.',is_system:true,is_active:true});
 await client.query('DELETE FROM tenant_role_permissions WHERE tenant_id=$1 AND role_id=$2',[t,role]);
 for(const key of demoAdminPermissions)await client.query('INSERT INTO tenant_role_permissions(tenant_id,role_id,permission_key) VALUES($1,$2,$3)',[t,role,key]);
 await client.query("UPDATE employee_role_assignments SET revoked_at=now() WHERE tenant_id=$1 AND employee_id=$2 AND (role_id<>$3 OR scope_type<>'company' OR expires_at IS NOT NULL) AND revoked_at IS NULL",[t,id,role]);
 await client.query("UPDATE permission_delegations SET status='revoked',revoked_at=now(),updated_at=now() WHERE tenant_id=$1 AND granted_to_employee_id=$2 AND status='active'",[t,id]);
 await client.query("INSERT INTO employee_role_assignments(tenant_id,employee_id,role_id,scope_type) SELECT $1,$2,$3,'company' WHERE NOT EXISTS(SELECT 1 FROM employee_role_assignments WHERE tenant_id=$1 AND employee_id=$2 AND role_id=$3 AND revoked_at IS NULL)",[t,id,role]);
 return id;
}
