import assert from 'node:assert/strict';
import {loadDevelopmentEnvironment} from './development-environment.mjs';
import {Pool} from 'pg';
import Redis from 'ioredis';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {randomBytes} from 'node:crypto';
import {readFile,mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createServer} from 'node:net';
loadDevelopmentEnvironment();
const source=new URL(process.env.DATABASE_MIGRATION_URL);assert(['localhost','127.0.0.1'].includes(source.hostname));source.pathname='/postgres';
const control=new Pool({connectionString:source.toString(),max:2});
const tag=randomBytes(8).toString('hex'),adminRole='stanza_rehearsal_admin_'+tag,runtimeRole='stanza_rehearsal_runtime_'+tag;
const password=randomBytes(32).toString('base64url'),demoPassword='Aa1!'+randomBytes(24).toString('base64url');
const root=await mkdtemp(path.join(os.tmpdir(),'stanza-rehearsal-')),databases=[],children=new Set();let redis,redisDb,roles=false;
const baseEnv={...process.env,NODE_ENV:'test',DATABASE_RUNTIME_ROLE:runtimeRole,DATABASE_RUNTIME_PASSWORD:password,DATABASE_SSL:'false',DATABASE_ALLOW_PLAINTEXT:'true',DATABASE_POOL_MAX:'3',ALLOW_TEST_DATA_MUTATION:'true',ALLOW_DEMO_DATA_MUTATION:'true',STANZA_DEMO_ENV:'false',DEMO_PASSWORD:demoPassword,DEV_AUTH_HEADERS:'false',ALLOW_TRYCLOUDFLARE_DEV_ORIGINS:'false',ALLOW_DOCUMENT_EXTRACTION_FIXTURES:'false',STANZA_ROUTER_AI_MODE:'disabled',STANZA_ROUTER_EMBEDDING_PROVIDER:'local',STANZA_ROUTER_OPENAI_LOCAL_AUTH:'false',RESEND_API_KEY:'',EMAIL_FROM:'',QR_TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('base64'),TRUST_PROXY_HOPS:'0',WEB_REPLICAS:'1',PROFILE_IMAGE_DIRECTORY:path.join(root,'avatars'),COMPANY_FEED_IMAGE_DIRECTORY:path.join(root,'feed'),ASSET_EVIDENCE_DIRECTORY:path.join(root,'assets'),GRIEVANCE_ATTACHMENT_DIRECTORY:path.join(root,'private'),BROWSER_PLAYWRIGHT_MODULE:process.env.BROWSER_PLAYWRIGHT_MODULE||'C:/Users/10/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'};
async function run(args,env,expected=0,executable=process.execPath){const child=spawn(executable,args,{env,windowsHide:true,stdio:['ignore','pipe','pipe']});children.add(child);let output='';for(const stream of [child.stdout,child.stderr])stream.on('data',data=>{output+=data;process.stdout.write(data)});const [code]=await once(child,'exit');children.delete(child);assert.equal(code,expected,args.join(' '));return output;}
const ts=(script,env,args=[])=>run(['--import','tsx',script,...args],env);
async function stop(child){if(child.exitCode!==null)return;const ended=once(child,'exit');child.kill();await ended;children.delete(child);}
async function freePort(){const socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=socket.address().port;await new Promise(r=>socket.close(r));return port;}
async function start(env,worker=false){const child=spawn(process.execPath,[worker?'dist/worker.cjs':'dist/server.cjs'],{env:{...env,NODE_ENV:'production',DATABASE_MIGRATION_URL:'',STANZA_RUNTIME_PROFILE:'production'},windowsHide:true,stdio:['ignore','pipe','pipe']});children.add(child);let logs='';for(const stream of [child.stdout,child.stderr])stream.on('data',data=>{logs+=data;process.stdout.write(data)});for(let i=0;i<100;i++){assert.equal(child.exitCode,null,'first boot exited');if(worker?logs.includes('Redis connection ready.'):await fetch(env.APP_BASE_URL+'/api/system/ready').then(r=>r.ok).catch(()=>false))return child;await new Promise(r=>setTimeout(r,150));}throw Error('First boot not ready');}
try{
 const version=(await control.query('SELECT version() version')).rows[0].version;console.log('ENVIRONMENT',process.version,version);
 const available=(await control.query("SELECT name,default_version FROM pg_available_extensions WHERE name IN ('postgis','vector','uuid-ossp','btree_gist') ORDER BY name")).rows;assert.equal(available.length,4);console.log('AVAILABLE EXTENSIONS',available);
 // Each role is task-owned; runtime never inherits migration privilege.
 await control.query(`CREATE ROLE "${adminRole}" LOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD '${password}'`);roles=true;
 await control.query(`CREATE ROLE "${runtimeRole}" LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD '${password}'`);
 await control.query(`GRANT "${runtimeRole}" TO "${adminRole}"`);
 const redisUrl=new URL(process.env.REDIS_URL||'redis://127.0.0.1:6379');
 for(let db=15;db>=1;db--){const candidate=new Redis({...{host:redisUrl.hostname,port:Number(redisUrl.port||6379),password:redisUrl.password?decodeURIComponent(redisUrl.password):undefined},db,maxRetriesPerRequest:1});if(await candidate.dbsize()===0){redis=candidate;redisDb=db;redisUrl.pathname='/'+db;break;}candidate.disconnect();}assert(redis,'No empty task Redis logical database available');baseEnv.REDIS_URL=redisUrl.toString();await redis.set('stanza-rehearsal-owner',tag);console.log('REDIS task-owned logical DB',redisDb,'normal DB untouched');
 for(const round of ['first','acceptance']){
  const name='stanza_rehearsal_'+tag+'_'+round;assert.match(name,/^stanza_rehearsal_[a-f0-9]{16}_(first|acceptance)$/);
  await control.query(`CREATE DATABASE "${name}" OWNER "${adminRole}" TEMPLATE template0`);databases.push(name);
  const adminUrl=new URL(source);adminUrl.pathname='/'+name;adminUrl.username=adminRole;adminUrl.password=password;const runtimeUrl=new URL(adminUrl);runtimeUrl.username=runtimeRole;
  const env={...baseEnv,DATABASE_URL:runtimeUrl.toString(),DATABASE_MIGRATION_URL:adminUrl.toString(),TEST_DATABASE_ALLOWLIST:name,DEMO_DATABASE_ALLOWLIST:name,DEMO_DATABASE_NAME:name,DEMO_TENANT_ID:''};
  const privilegedUrl=new URL(source);privilegedUrl.pathname='/'+name;const privileged=new Pool({connectionString:privilegedUrl.toString()});const db=new Pool({connectionString:adminUrl.toString()});
  try{
   assert.equal((await privileged.query("SELECT count(*)::int n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'")).rows[0].n,0);console.log('PASS',round,'empty template0 database');
   for(const extension of ['uuid-ossp','postgis','btree_gist','vector'])await privileged.query(`CREATE EXTENSION "${extension}"`);
   await run(['-X','-v','ON_ERROR_STOP=1','-f','src/db/schema.sql'],{...env,PGHOST:adminUrl.hostname,PGPORT:adminUrl.port||'5432',PGUSER:adminRole,PGPASSWORD:password,PGDATABASE:name},0,process.env.PSQL_BINARY||'psql');console.log('PASS documented psql schema.sql bootstrap');
   await run(['dist/migrate.cjs'],env);await ts('scripts/setup-runtime-role.ts',env);await run(['dist/migrate.cjs'],env);
   console.log('PASS ordered migrations and full replay');await ts('scripts/seed-demo.ts',{...env,STANZA_DEMO_ENV:'true'});
   await ts('scripts/local-embedding-prepare.ts',env);await ts('scripts/semantic-router-seed.ts',{...env,STANZA_ROUTER_SEED_SYSTEM:'true'});await ts('scripts/semantic-router-seed.ts',{...env,STANZA_ROUTER_SEED_SYSTEM:'true'});
   const port=await freePort(),base='http://localhost:'+port;Object.assign(env,{PORT:String(port),APP_BASE_URL:base,WEBAUTHN_ORIGIN:base,WEBAUTHN_RP_ID:'localhost',BROWSER_BASE_URL:base,SMOKE_TEST_BASE_URL:base,SMOKE_TEST_EMAIL:'admin@stanza-demo.com',SMOKE_TEST_PASSWORD:demoPassword});
   const web=await start(env);try{const worker=await start(env,true);try{await ts('scripts/fresh-database-smoke.ts',env);await ts('scripts/fresh-database-failure-test.ts',env);if(!process.argv.includes('--bootstrap-only'))await ts('scripts/business-scenarios-runner.mjs',env);}finally{await stop(worker);}}finally{await stop(web);}
   console.log('PASS',round,'complete supported first boot');
  }finally{await db.end();await privileged.end();}
  await control.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',[name]);await control.query(`DROP DATABASE "${name}"`);databases.splice(databases.indexOf(name),1);console.log('PASS',round,'database destroyed');
 }
 if(!process.argv.includes('--bootstrap-only')){
  const runtimeControl=new URL(source);runtimeControl.username=runtimeRole;runtimeControl.password=password;
  await ts('scripts/migration-test.ts',{...baseEnv,DATABASE_URL:runtimeControl.toString(),DATABASE_MIGRATION_URL:source.toString(),TEST_DATABASE_ALLOWLIST:'postgres',DEMO_DATABASE_ALLOWLIST:'postgres'},['--with-integration']);
  console.log('PASS supported populated legacy/runtime-role upgrade and existing integration validation');
 }
}finally{
 for(const child of children)await stop(child);
 for(const name of databases){await control.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',[name]);await control.query(`DROP DATABASE "${name}"`);}
 if(redis){assert.equal(await redis.get('stanza-rehearsal-owner'),tag);const keys=await redis.keys('*');const owned=keys.filter(k=>k==='stanza-rehearsal-owner'||k.startsWith('bull:hr-queue:')||k.startsWith('bull:stanza-communications:'));if(owned.length)await redis.del(...owned);assert.equal(await redis.dbsize(),0,'unexpected keys in task-owned Redis database');redis.disconnect();}
 if(roles){await control.query(`DROP ROLE IF EXISTS "${runtimeRole}"`);await control.query(`DROP ROLE IF EXISTS "${adminRole}"`);}await control.end();assert.equal(path.dirname(root),os.tmpdir());assert(path.basename(root).startsWith('stanza-rehearsal-'));await rm(root,{recursive:true,force:true});console.log('CLEANUP databases/roles/Redis keys/processes/uploads: zero');
}