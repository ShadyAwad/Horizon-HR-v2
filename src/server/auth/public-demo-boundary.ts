import type express from 'express';
import type {PoolClient} from 'pg';
import {withTenant} from '../../lib/hr-background';
export const PUBLIC_DEMO_IDENTITIES=['tenant-admin@stanza-demo.com','admin@stanza-demo.com','manager@stanza-demo.com','employee@stanza-demo.com'] as const;
export async function protectedDemoIdentity(client:PoolClient,tenantId:string,employeeId:string){return Boolean((await client.query('SELECT 1 FROM employees e JOIN tenants t ON t.id=e.tenant_id WHERE e.tenant_id=$1 AND e.id=$2 AND t.is_demo_tenant AND e.email=ANY($3::text[])',[tenantId,employeeId,PUBLIC_DEMO_IDENTITIES])).rowCount);}
/** Product permissions still run normally after this narrow identity/egress boundary. */
export async function enforcePublicDemoBoundary(req:express.Request,res:express.Response,next:express.NextFunction){
 const user=req.authUser;if(!user)return next();
 try{const demo=await withTenant(user.tenantId,async c=>Boolean((await c.query('SELECT 1 FROM tenants WHERE id=$1 AND is_demo_tenant',[user.tenantId])).rowCount));if(!demo)return next();user.isDemoTenant=true;
 if(req.path.startsWith('/api/command-router/openai/'))return void res.status(403).json({success:false,code:'DEMO_EXTERNAL_ACCESS_DISABLED',error:'Provider connections are unavailable in the public demo.'});
 if(req.path==='/api/command-router/resolve'){if(process.env.STANZA_ROUTER_EMBEDDING_PROVIDER==='openai')return void res.status(403).json({success:false,code:'DEMO_EXTERNAL_ACCESS_DISABLED',error:'Public demo semantic search requires the local embedding provider.'});if(req.body&&typeof req.body==='object')req.body.allowReasoning=false;}
 if(['GET','HEAD','OPTIONS'].includes(req.method))return next();
 if(req.path==='/api/document-extractions')return void res.status(403).json({success:false,code:'DEMO_EXTERNAL_ACCESS_DISABLED',error:'External document extraction is unavailable in the public demo. Use manual entry.'});
 const blocked=await withTenant(user.tenantId,async c=>{
  if(req.path.startsWith('/api/auth/passkeys/')&&!req.path.includes('/login/'))return protectedDemoIdentity(c,user.tenantId,user.employeeId);
  const assignment=req.path.match(/^\/api\/hr\/organisation\/role-assignments\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/revoke$/i);
  if(assignment){const r=(await c.query('SELECT employee_id FROM employee_role_assignments WHERE tenant_id=$1 AND id=$2',[user.tenantId,assignment[1]])).rows[0];return r&&protectedDemoIdentity(c,user.tenantId,r.employee_id);}
  if(req.path.startsWith('/api/hr/organisation/')||req.path.startsWith('/api/employees/')){const employee=req.path.match(/\/employees\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i)?.[1]??req.body?.employeeId;if(typeof employee==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(employee))return protectedDemoIdentity(c,user.tenantId,employee);}
  const resignation=req.path.match(/^\/api\/resignations\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/process$/i);if(resignation){const r=(await c.query('SELECT employee_id FROM resignation_requests WHERE tenant_id=$1 AND id=$2',[user.tenantId,resignation[1]])).rows[0];return r&&protectedDemoIdentity(c,user.tenantId,r.employee_id);}
  return false;
 });if(blocked)return void res.status(403).json({success:false,code:'DEMO_IDENTITY_PROTECTED',error:'Public demo login identities are maintained by operator recovery. Use a fictional employee to explore this action.'});next();
 }catch(error){next(error);}
}
