import './router-env';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {Queue,Worker} from 'bullmq';
import {getRedisConnection} from '../src/lib/background-connections';
import {backupCaseHistory,readCaseHistory,backupDemoFiles,restoreDemoFiles,removeDemoFiles,assertDemoFileOwnership,type DemoFile} from './demo/files';
import {inspectDemoJobs,finishRecoveryCleanup} from './demo/reconcile';
import type {PoolClient} from 'pg';
const root=await mkdtemp(path.join(os.tmpdir(),'stanza-demo-files-'));
process.env.DEMO_RECOVERY_DIRECTORY=path.join(root,'baseline');process.env.GRIEVANCE_ATTACHMENT_DIRECTORY=path.join(root,'private');
const {mkdir}=await import('node:fs/promises');await mkdir(process.env.GRIEVANCE_ATTACHMENT_DIRECTORY,{recursive:true});
const t=randomUUID(),foreign=randomUUID(),file:DemoFile={kind:'grievance',key:randomUUID()+'.bin'};
let worker:Worker|undefined,release:(()=>void)|undefined;
const q=new Queue('stanza-demo-audit-'+randomUUID(),{connection:{...getRedisConnection(),maxRetriesPerRequest:1}});q.on('error',()=>{});
try{
 const history={grievance_messages:[{tenant_id:t,body:'Fictional private recovery fixture'}]};const checksum=await backupCaseHistory(t,history);assert.deepEqual(await readCaseHistory(t,checksum),history);await assert.rejects(()=>readCaseHistory(t,'wrong'),/checksum/);
 const target=path.join(process.env.GRIEVANCE_ATTACHMENT_DIRECTORY,file.key);await writeFile(target,'Fictional baseline');await backupDemoFiles([file],t);await writeFile(target,'Changed fixture');await restoreDemoFiles([file],t);assert.equal(await readFile(target,'utf8'),'Fictional baseline');await removeDemoFiles([file],t);await assert.rejects(()=>readFile(target),(e:any)=>e.code==='ENOENT');await restoreDemoFiles([file],t);assert.equal(await readFile(target,'utf8'),'Fictional baseline');
 await assert.rejects(()=>restoreDemoFiles([{...file,checksum:'wrong'}],t),/checksum/);await assert.rejects(()=>removeDemoFiles([{kind:'feed',key:foreign+'/'+randomUUID()+'.webp'}],t),/Foreign/);
 const foreignReference={query:async()=>({rowCount:1,rows:[]})} as unknown as PoolClient;await assert.rejects(()=>assertDemoFileOwnership(foreignReference,[file],t),/foreign tenant/);
 const baseline=await q.add('owned',{tenantId:t}),added=await q.add('owned',{tenantId:t}),other=await q.add('foreign',{tenantId:foreign});
 assert.equal((await inspectDemoJobs(q,t)).length,2);
 let pending=true,fail=true;const plan={id:randomUUID(),metadata:{cleanupFiles:[file],protectedJobs:[q.name+'/'+baseline.id]}};
 const client={query:async(sql:string)=>{if(sql.startsWith('SELECT id,metadata'))return {rows:pending?[plan]:[]};if(sql.startsWith('SELECT 1'))return {rowCount:0,rows:[]};if(sql.startsWith('UPDATE')){if(fail)throw Error('Owned cleanup failure');pending=false;}return {rows:[],rowCount:0};}} as unknown as PoolClient;
 await assert.rejects(()=>finishRecoveryCleanup(client,[q],t),/Owned cleanup failure/);assert(pending);fail=false;await finishRecoveryCleanup(client,[q],t);assert(!pending);await finishRecoveryCleanup(client,[q],t);
 assert(await q.getJob(baseline.id!));assert(await q.getJob(other.id!));assert.equal(await q.getJob(added.id!),undefined);
 let started!:()=>void;const ready=new Promise<void>(resolve=>{started=resolve;});const blocked=new Promise<void>(resolve=>{release=resolve;});worker=new Worker(q.name,async job=>{if(job.id===baseline.id){started();await blocked;}return true;},{connection:{...getRedisConnection(),maxRetriesPerRequest:null}});worker.on('error',()=>{});let timeout:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([ready,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('Task worker did not start')),5000);})]);await assert.rejects(()=>inspectDemoJobs(q,t),/active/);}finally{clearTimeout(timeout);release();await worker.close();worker=undefined;}
 console.log('PASS real private file backup/checksum/restore/removal; foreign-key protection; real task Redis jobs; post-commit cleanup retry/idempotency; foreign/baseline jobs retained');
}finally{release?.();await worker?.close();for(const job of await q.getJobs(['waiting','delayed','completed','failed'],0,100))await job.remove();assert.equal(await q.count(),0);await q.obliterate();await q.close();assert.equal(path.dirname(root),os.tmpdir());await rm(root,{recursive:true,force:true});console.log('PASS task queue, Redis keys and private file directory removed');}
