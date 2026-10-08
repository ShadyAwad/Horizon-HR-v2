import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {once} from 'node:events';
import ts from 'typescript';
import express from 'express';
import {hasPermissionClaim} from '../src/server/auth/permission-claims';
import * as rules from '../src/server/live-employees/live-employees-rules';
import {buildCommandRegistry} from '../src/components/command-palette/command-registry';
import {getIntent} from '../src/lib/intelligent-router';

// Execute production declarations without booting the full server or mounting
// Dashboard. AST lookup tolerates whitespace and stronger compound gates.
const read=(file:string)=>readFileSync(file,'utf8');
function declaration(file:string,name:string) {
  const source=ts.createSourceFile(file,read(file),ts.ScriptTarget.Latest,true);
  let found:ts.FunctionDeclaration|ts.VariableDeclaration|undefined;
  function visit(node:ts.Node) {
    if((ts.isFunctionDeclaration(node)||ts.isVariableDeclaration(node))&&node.name?.getText(source)===name)found=node;
    ts.forEachChild(node,visit);
  }
  visit(source);assert(found,`Production declaration missing: ${name}`);
  return ts.isVariableDeclaration(found)?'const '+found.getText(source)+';':found.getText(source);
}
const compile=(source:string)=>ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const dashboard='src/pages/Dashboard.tsx';
// Exercise the actual panel-render condition too: selecting the tab directly
// must not bypass the visibility gate.
const ui=ts.createSourceFile(dashboard,read(dashboard),ts.ScriptTarget.Latest,true);
let mountGuard:string|undefined;
function findPanel(node:ts.Node) {
  if(ts.isJsxSelfClosingElement(node)&&node.tagName.getText(ui)==='LiveEmployeesPanel') {
    let parent:ts.Node|undefined=node.parent;
    while(parent&&!ts.isBinaryExpression(parent))parent=parent.parent;
    assert(parent&&ts.isBinaryExpression(parent)&&parent.operatorToken.kind===ts.SyntaxKind.AmpersandAmpersandToken);
    mountGuard=parent.left.getText(ui);
  }
  ts.forEachChild(node,findPanel);
}
findPanel(ui);assert(mountGuard,'Live Employees panel render gate missing');
const policy=compile([
  declaration(dashboard,'legacyRolePermissionFallback'),declaration(dashboard,'hasPermission'),
  declaration('server.ts','requireRole'),declaration('server.ts','requirePermission'),
  `function visible(user:any){${declaration(dashboard,'canViewLiveEmployees')}return canViewLiveEmployees;}`,
  `function canMount(user:any,activeTab:string){${declaration(dashboard,'canViewLiveEmployees')}return ${mountGuard};}`,
].join('\n'));
const production=runInNewContext(policy+'\n({visible,canMount,requireRole,requirePermission})',{hasPermissionClaim});
const actors=[
  {role:'hr_admin',permissions:[],expected:true}, // Existing authenticated HR-admin grant.
  {role:'hr_admin',permissions:['attendance.view_live'],expected:true},
  {role:'manager',permissions:['attendance.view_live'],expected:false},
  {role:'employee',permissions:['attendance.view_live'],expected:false},
  {role:'manager',permissions:[],expected:false},
  {role:'employee',expected:false},
];
for(const actor of actors) {
  const visible=production.visible(actor);assert.equal(visible,actor.expected);
  assert.equal(production.canMount(actor,'liveEmployees'),actor.expected);
  assert.equal(production.canMount(actor,'profile'),false);
  const commands=buildCommandRegistry({navigationItems:visible?[{id:'liveEmployees',label:'Live Employees',group:'peopleOperations',icon:null,active:false,onSelect:()=>{}}]:[],openLabel:s=>s,moduleDescription:s=>s});
  assert.equal(commands.some(c=>c.id==='navigation:liveEmployees'),actor.expected);
  if(visible)assert(commands[0].keywords.includes('live employees'));
}
const intent=getIntent('live_employees');assert(intent);
assert.deepEqual(intent.permissions,['attendance.view_live']);
assert.equal(intent.commandId,'navigation:liveEmployees');
console.log('PASS production UI gate and palette: HR admin allowed; manager/employee denied even with live-attendance claims');

// Only SQL is a fixture. The actual route and production role/permission
// middleware execute over HTTP. Denied requests must never reach SQL.
let queries=0;const middlewarePermissions:string[]=[];
const module={exports:{} as {registerLiveEmployeesRoutes:Function}};
runInNewContext(compile(read('src/server/live-employees/live-employees-routes.ts')),{
  module,exports:module.exports,
  require:(name:string)=>{
    if(name.endsWith('/hr-background'))return {withTenant:async(tenantId:string,run:Function)=>run({query:async(_sql:string,params:unknown[])=>{queries++;assert.equal(params[0],tenantId);return {rows:[{employeeId:tenantId+'-employee'}]};}})};
    if(name.endsWith('/live-employees-rules'))return rules;
    if(name.endsWith('/server-logging'))return {logServerError:()=>{}};
    throw Error('Unexpected route dependency: '+name);
  },
});
const app=express();
module.exports.registerLiveEmployeesRoutes(app,{
  demoAuth:((req,res,next)=>{
    const index=Number(req.header('x-fixture-actor'));
    if(!req.header('x-fixture-actor')||!actors[index])return res.sendStatus(401);
    req.authUser={...actors[index],tenantId:req.header('x-fixture-tenant')||'tenant-a',employeeId:'fixture',email:'fixture@example.invalid'} as express.Request['authUser'];next();
  }) as express.RequestHandler,
  requireRole:production.requireRole,
  requirePermission:(key:string)=>{middlewarePermissions.push(key);return production.requirePermission(key);},
});
assert.deepEqual(middlewarePermissions,['attendance.view_live']);
const server=app.listen(0,'127.0.0.1');await once(server,'listening');
const address=server.address();assert(address&&typeof address!=='string');
const url=`http://127.0.0.1:${address.port}/api/hr/live-employees`;
try {
  assert.equal((await fetch(url)).status,401);assert.equal(queries,0);
  for(let index=0;index<actors.length;index++) {
    const before=queries,response=await fetch(url,{headers:{'x-fixture-actor':String(index)}});
    assert.equal(response.status,actors[index].expected?200:403);
    assert.equal(queries-before,actors[index].expected?1:0);
  }
  for(const tenant of ['tenant-a','tenant-b']) {
    const response=await fetch(url,{headers:{'x-fixture-actor':'0','x-fixture-tenant':tenant,'x-tenant-id':'forged-other-tenant'}});
    assert.equal(response.status,200);
    assert.deepEqual((await response.json()).employees,[{employeeId:tenant+'-employee'}]);
  }
} finally {await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
console.log('PASS real route/middleware HTTP: anonymous 401, unauthorized 403 without SQL; authorized 200; tenant bound to authenticated session, not forged headers (fixture SQL adapter)');
