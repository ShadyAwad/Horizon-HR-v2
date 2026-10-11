import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {getMigrationPool,migrationUrl} from './migration-pool';
import {getDbPool,closeHrResources} from '../src/lib/hr-background';
import {applyMigrations} from './migration-order';
import {LocalEmbeddingProvider} from '../src/server/intelligent-router/local-embedding';
assert.match(new URL(process.env.DATABASE_URL!).pathname,/^\/stanza_rehearsal_[a-f0-9]{16}_/);
const root=await mkdtemp(path.join(tmpdir(),'stanza-fresh-failures-')),db=getMigrationPool();
try{
 await writeFile(path.join(root,'01_failure.sql'),'BEGIN; CREATE TABLE public.fresh_failure_probe(id int); SELECT 1/0; COMMIT;');
 for(let i=0;i<2;i++){await assert.rejects(applyMigrations(db,root),(e:any)=>e.code==='22012');assert.equal((await db.query("SELECT to_regclass('public.fresh_failure_probe') exists")).rows[0].exists,null);}console.log('PASS migration transaction rollback and repeat failure leave zero partial objects; runner has no applied ledger');
 const saved=process.env.DATABASE_URL;try{process.env.DATABASE_URL='';assert.throws(()=>getDbPool(),/DATABASE_URL is required/);}finally{process.env.DATABASE_URL=saved;}
 const admin=process.env.DATABASE_MIGRATION_URL;try{process.env.DATABASE_MIGRATION_URL='';assert.throws(()=>migrationUrl(),/never used as a fallback/);}finally{process.env.DATABASE_MIGRATION_URL=admin;}
 const runtime=getDbPool();for(const sql of ['CREATE SCHEMA fresh_runtime_must_not_create','ALTER TABLE employees ADD COLUMN fresh_runtime_must_not_alter int','DROP SCHEMA public'])await assert.rejects(runtime.query(sql),(e:any)=>e.code==='42501');
 for(const patch of [{DATABASE_URL:''},{REDIS_URL:'',REDIS_HOST:''}]){const result=spawnSync(process.execPath,['dist/server.cjs'],{env:{...process.env,NODE_ENV:'production',...patch},encoding:'utf8',timeout:10000});assert.equal(result.status,1);assert((result.stderr+result.stdout).includes('Production configuration invalid'));assert(!(result.stderr+result.stdout).includes(saved!));}
 console.log('PASS non-owner DDL denied, explicit runtime/migration separation and missing DB/Redis startup failures');
 for(const patch of [{DATABASE_URL:'postgres://invalid:invalid@127.0.0.1:1/unavailable'},{REDIS_URL:'redis://127.0.0.1:1'}]){
  const socket=createServer();await new Promise<void>(r=>socket.listen(0,'127.0.0.1',r));const port=(socket.address() as any).port;await new Promise<void>(r=>socket.close(()=>r()));const base='http://localhost:'+port;
  const child=spawn(process.execPath,['dist/server.cjs'],{env:{...process.env,NODE_ENV:'production',DATABASE_MIGRATION_URL:'',PORT:String(port),APP_BASE_URL:base,WEBAUTHN_ORIGIN:base,...patch},windowsHide:true,stdio:'ignore'});
  try{let ready=false;for(let i=0;i<50;i++){try{if((await fetch(base+'/api/system/live')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}assert(ready);const response=await fetch(base+'/api/system/ready');assert.equal(response.status,503);const body=await response.text();assert(!/invalid|postgres:|redis:|password|127\.0\.0\.1/.test(body));assert.equal((await fetch(base+'/api/system/live')).status,200);}finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}}
 }
 console.log('PASS wrong PostgreSQL/Redis dependencies produce private readiness503 while liveness remains healthy');
 const modelRoot=path.join(root,'absent-model');await import('node:fs/promises').then(fs=>fs.mkdir(modelRoot));const model=new LocalEmbeddingProvider({cache:modelRoot,loadTimeoutMs:3000});try{await assert.rejects(model.embed('owned missing model fixture'),/LOCAL_EMBEDDING_UNAVAILABLE/);assert.equal((await readdir(modelRoot)).length,0);}finally{await model.close();}console.log('PASS unprepared local model fails boundedly without downloading files');
}finally{await db.end();await closeHrResources();assert.equal(path.dirname(root),tmpdir());assert(path.basename(root).startsWith('stanza-fresh-failures-'));await rm(root,{recursive:true,force:true});}