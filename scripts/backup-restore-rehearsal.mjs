import assert from 'node:assert/strict';
import {loadDevelopmentEnvironment} from './development-environment.mjs';
import {Pool} from 'pg';
import Redis from 'ioredis';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {randomBytes,createHash} from 'node:crypto';
import {readFile,mkdtemp,rm,mkdir,writeFile,cp,readdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createServer} from 'node:net';
loadDevelopmentEnvironment();
const source=new URL(process.env.DATABASE_MIGRATION_URL);assert(['localhost','127.0.0.1'].includes(source.hostname));source.pathname='/postgres';
const control=new Pool({connectionString:source.toString(),max:2});
const tag=randomBytes(8).toString('hex'),adminRole='stanza_restore_admin_'+tag,runtimeRole='stanza_restore_runtime_'+tag;
const password=randomBytes(32).toString('base64url'),demoPassword='Aa1!'+randomBytes(24).toString('base64url');
const root=await mkdtemp(path.join(os.tmpdir(),'stanza-backup-')),databases=[],children=new Set();let redis,redisDb,roles=false;
const baseEnv={...process.env,NODE_ENV:'test',DATABASE_RUNTIME_ROLE:runtimeRole,DATABASE_RUNTIME_PASSWORD:password,DATABASE_SSL:'false',DATABASE_ALLOW_PLAINTEXT:'true',DATABASE_POOL_MAX:'3',ALLOW_TEST_DATA_MUTATION:'true',ALLOW_DEMO_DATA_MUTATION:'true',STANZA_DEMO_ENV:'false',DEMO_PASSWORD:demoPassword,DEV_AUTH_HEADERS:'false',ALLOW_TRYCLOUDFLARE_DEV_ORIGINS:'false',ALLOW_DOCUMENT_EXTRACTION_FIXTURES:'false',STANZA_ROUTER_AI_MODE:'disabled',STANZA_ROUTER_EMBEDDING_PROVIDER:'local',STANZA_ROUTER_OPENAI_LOCAL_AUTH:'false',RESEND_API_KEY:'',EMAIL_FROM:'',QR_TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('base64'),TRUST_PROXY_HOPS:'0',WEB_REPLICAS:'1',PROFILE_IMAGE_DIRECTORY:path.join(root,'avatars'),COMPANY_FEED_IMAGE_DIRECTORY:path.join(root,'feed'),ASSET_EVIDENCE_DIRECTORY:path.join(root,'assets'),GRIEVANCE_ATTACHMENT_DIRECTORY:path.join(root,'private'),BROWSER_PLAYWRIGHT_MODULE:process.env.BROWSER_PLAYWRIGHT_MODULE||'C:/Users/10/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'};
async function run(args,env,expected=0,executable=process.execPath){const child=spawn(executable,args,{env,windowsHide:true,stdio:['ignore','pipe','pipe']});children.add(child);let output='';for(const stream of [child.stdout,child.stderr])stream.on('data',data=>{output+=data;process.stdout.write(data)});const [code]=await once(child,'exit');children.delete(child);assert.equal(code,expected,args.join(' '));return output;}
const ts=(script,env,args=[])=>run(['--import','tsx',script,...args],env);
async function stop(child){if(child.exitCode!==null)return;const ended=once(child,'exit');child.kill();await ended;children.delete(child);}
async function freePort(){const socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=socket.address().port;await new Promise(r=>socket.close(r));return port;}
async function start(env,worker=false){const child=spawn(process.execPath,[worker?'dist/worker.cjs':'dist/server.cjs'],{env:{...env,NODE_ENV:'production',DATABASE_MIGRATION_URL:'',STANZA_RUNTIME_PROFILE:'production'},windowsHide:true,stdio:['ignore','pipe','pipe']});children.add(child);let logs='';for(const stream of [child.stdout,child.stderr])stream.on('data',data=>{logs+=data;process.stdout.write(data)});for(let i=0;i<100;i++){assert.equal(child.exitCode,null,'first boot exited');if(worker?logs.includes('Redis connection ready.'):await fetch(env.APP_BASE_URL+'/api/system/ready').then(r=>r.ok).catch(()=>false))return child;await new Promise(r=>setTimeout(r,150));}throw Error('First boot not ready');}
async function snapshot(pool){
 const result={tables:{},policies:[],rls:[]};const tables=(await pool.query("SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e') ORDER BY c.relname")).rows;
 for(const {relname} of tables){const quoted='"'+relname.replaceAll('"','""')+'"';result.tables[relname]=(await pool.query(`SELECT count(*)::int n,md5(COALESCE(string_agg(to_jsonb(t)::text,'' ORDER BY to_jsonb(t)::text),'')) hash FROM public.${quoted} t`)).rows[0];}
 result.policies=(await pool.query("SELECT tablename,policyname,permissive,roles,cmd,qual,with_check FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname")).rows;
 result.rls=(await pool.query("SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,c.relacl::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' ORDER BY c.relname")).rows;return result;
}
async function files(directory,relative=''){const result=[];for(const entry of await readdir(path.join(directory,relative),{withFileTypes:true})){const key=path.join(relative,entry.name);if(entry.isDirectory())result.push(...await files(directory,key));else result.push({key,sha256:createHash('sha256').update(await readFile(path.join(directory,key))).digest('hex')});}return result.sort((a,b)=>a.key.localeCompare(b.key));}
function storageEnv(directory){return {PROFILE_IMAGE_DIRECTORY:path.join(directory,'avatars'),COMPANY_FEED_IMAGE_DIRECTORY:path.join(directory,'feed'),ASSET_EVIDENCE_DIRECTORY:path.join(directory,'assets'),GRIEVANCE_ATTACHMENT_DIRECTORY:path.join(directory,'private')};}
const manifest=path.join(root,'dataset.json'),dump=path.join(root,'postgres.dump'),fileBackup=path.join(root,'file-backup'),sourceStorage=path.join(root,'source-files'),restoreStorage=path.join(root,'restored-files');
try{
 await control.query(`CREATE ROLE "${adminRole}" LOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD '${password}'`);roles=true;await control.query(`CREATE ROLE "${runtimeRole}" LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD '${password}'`);await control.query(`GRANT "${runtimeRole}" TO "${adminRole}"`);
 const redisUrl=new URL(process.env.REDIS_URL||'redis://127.0.0.1:6379');for(let index=15;index>=1;index--){const u=new URL(redisUrl);u.pathname='/'+index;const candidate=new Redis(u.toString());if(await candidate.dbsize()===0){redis=candidate;redisDb=index;baseEnv.REDIS_URL=u.toString();break;}candidate.disconnect();}assert(redis);await redis.set('stanza-restore-owner',tag);console.log('Task Redis logical DB',redisDb,'normal Redis untouched');
 let expected,fileExpected;
 for(const stage of ['source','target']){
  const name='stanza_restore_'+tag+'_'+stage;await control.query(`CREATE DATABASE "${name}" OWNER "${adminRole}" TEMPLATE template0`);databases.push(name);
  const privilegedUrl=new URL(source);privilegedUrl.pathname='/'+name;const privileged=new Pool({connectionString:privilegedUrl.toString()});
  const adminUrl=new URL(privilegedUrl);adminUrl.username=adminRole;adminUrl.password=password;const runtimeUrl=new URL(adminUrl);runtimeUrl.username=runtimeRole;const db=new Pool({connectionString:adminUrl.toString()});
  const directory=stage==='source'?sourceStorage:restoreStorage;await mkdir(directory,{recursive:true});for(const dir of Object.values(storageEnv(directory)))await mkdir(dir,{recursive:true});
  const env={...baseEnv,...storageEnv(directory),RESTORE_MANIFEST:manifest,DATABASE_URL:runtimeUrl.toString(),DATABASE_MIGRATION_URL:adminUrl.toString(),TEST_DATABASE_ALLOWLIST:name,DEMO_DATABASE_ALLOWLIST:name,DEMO_DATABASE_NAME:name,DEMO_TENANT_ID:''};
  const pgEnv={...env,PGHOST:adminUrl.hostname,PGPORT:adminUrl.port||'5432',PGUSER:adminRole,PGPASSWORD:password,PGDATABASE:name};
  try{
   assert.equal((await privileged.query("SELECT count(*)::int n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'")).rows[0].n,0);
   for(const extension of ['uuid-ossp','postgis','btree_gist','vector'])await privileged.query(`CREATE EXTENSION "${extension}"`);
   if(stage==='source'){
    await run(['-X','-v','ON_ERROR_STOP=1','-f','src/db/schema.sql'],pgEnv,0,'psql');await run(['dist/migrate.cjs'],env);await ts('scripts/setup-runtime-role.ts',env);await ts('scripts/seed-demo.ts',{...env,STANZA_DEMO_ENV:'true'});await ts('scripts/local-embedding-prepare.ts',env);await ts('scripts/semantic-router-seed.ts',{...env,STANZA_ROUTER_SEED_SYSTEM:'true'});
   }else{
    // File blobs alone have not reconstructed any application table or relationship.
    await cp(fileBackup,directory,{recursive:true});assert.deepEqual(await files(directory),fileExpected);assert.equal((await db.query("SELECT to_regclass('public.employees') table_exists")).rows[0].table_exists,null);
    await run(['--exit-on-error','--dbname',name,dump],{...pgEnv,PGUSER:decodeURIComponent(source.username),PGPASSWORD:decodeURIComponent(source.password)},0,'pg_restore');assert.deepEqual(await snapshot(db),expected);console.log('PASS restored all application table counts/checksums, IDs, relationships, vector data, RLS policies and ACLs:',Object.keys(expected.tables).length,'tables');
   }
   const port=await freePort(),base='http://localhost:'+port;Object.assign(env,{PORT:String(port),APP_BASE_URL:base,WEBAUTHN_ORIGIN:base,WEBAUTHN_RP_ID:'localhost',BROWSER_BASE_URL:base});const web=await start(env);
   try{if(stage==='source')await ts('scripts/backup-restore-dataset-test.ts',env,['create']);else{const worker=await start(env,true);try{await ts('scripts/backup-restore-dataset-test.ts',env,['verify']);await ts('scripts/business-scenarios-runner.mjs',env,['hiring-equipment','attendance-leave']);}finally{await stop(worker);}}}finally{await stop(web);}
   if(stage==='source'){
    expected=await snapshot(db);fileExpected=await files(directory);assert(fileExpected.length>0);await run(['--format=custom','--file',dump,'--dbname',name],pgEnv,0,'pg_dump');await cp(directory,fileBackup,{recursive:true});assert.deepEqual(await files(fileBackup),fileExpected);console.log('PASS quiesced PostgreSQL custom dump and separately backed-up files:',fileExpected.length);
    // Destroy only this task's source files; successful retrieval must use their backup.
    assert(path.dirname(directory)===root);await rm(directory,{recursive:true,force:true});
    const keys=(await redis.keys('*')).filter(k=>k.startsWith('bull:hr-queue:')||k.startsWith('bull:stanza-communications:'));if(keys.length)await redis.del(...keys);assert.deepEqual(await redis.keys('*'),['stanza-restore-owner']);console.log('PASS pre-restore Redis contains no jobs; pending work exists only in database backup');
   }
  }finally{await db.end();await privileged.end();}
  await control.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',[name]);await control.query(`DROP DATABASE "${name}"`);databases.splice(databases.indexOf(name),1);console.log('PASS task',stage,'database destroyed');
 }
}finally{
 for(const child of children)await stop(child);for(const name of databases){await control.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',[name]);await control.query(`DROP DATABASE "${name}"`);}
 if(redis){assert.equal(await redis.get('stanza-restore-owner'),tag);const keys=await redis.keys('*');const owned=keys.filter(k=>k==='stanza-restore-owner'||k.startsWith('bull:hr-queue:')||k.startsWith('bull:stanza-communications:'));if(owned.length)await redis.del(...owned);assert.equal(await redis.dbsize(),0);redis.disconnect();}
 if(roles){await control.query(`DROP ROLE IF EXISTS "${runtimeRole}"`);await control.query(`DROP ROLE IF EXISTS "${adminRole}"`);}await control.end();assert.equal(path.dirname(root),os.tmpdir());assert(path.basename(root).startsWith('stanza-backup-'));await rm(root,{recursive:true,force:true});console.log('CLEANUP task databases/roles/dump/files/Redis keys/processes: zero');
}