import type {Queue} from 'bullmq';
import type {PoolClient} from 'pg';
import {assertDemoFileOwnership,listDemoFiles,removeDemoFiles,type DemoFile} from './files';
/** Bounded inspection; never flush Redis or remove a foreign tenant job. */
export async function inspectDemoJobs(queue:Queue,tenantId:string){
 const counts=await queue.getJobCounts('active','wait','delayed','failed','completed','paused','prioritized','waiting-children');
 if(Object.values(counts).reduce((total,count)=>total+count,0)>10000)throw Error('Queue inventory exceeds bounded demo inspection.');
 const jobs=await queue.getJobs(['active','waiting','delayed','failed','completed','paused','prioritized','waiting-children'],0,9999);
 const owned=jobs.filter(job=>job.data?.tenantId===tenantId);
 for(const job of owned)if(await job.getState()==='active')throw Error('A demo job is active. Pause the demo worker before recovery.');
 return owned;
}
export async function finishRecoveryCleanup(client:PoolClient,queues:Queue[],tenantId:string){
 const plans=(await client.query("SELECT id,metadata FROM audit_logs WHERE tenant_id=$1 AND action='demo.recovered' AND metadata->>'cleanupPending'='true' ORDER BY created_at",[tenantId])).rows;
 let filesRemoved=0,jobsRemoved=0;
 for(const plan of plans){
  const files=plan.metadata.cleanupFiles as DemoFile[],protectedJobs=plan.metadata.protectedJobs as string[];
  if(!Array.isArray(files)||!Array.isArray(protectedJobs))throw Error('Invalid recovery cleanup plan.');
  const current=new Set((await listDemoFiles(client,tenantId)).map(f=>f.kind+':'+f.key));
  if(files.some(file=>current.has(file.kind+':'+file.key)))throw Error('A cleanup file is still referenced; recovery stopped safely.');
  await assertDemoFileOwnership(client,files,tenantId);await removeDemoFiles(files,tenantId);filesRemoved+=files.length;
  for(const queue of queues)for(const job of await inspectDemoJobs(queue,tenantId))if(job.id&&!protectedJobs.includes(queue.name+'/'+job.id)){await job.remove();jobsRemoved++;}
  await client.query("UPDATE audit_logs SET metadata=metadata||'{\"cleanupPending\":false}'::jsonb WHERE tenant_id=$1 AND id=$2",[tenantId,plan.id]);
 }
 return {filesRemoved,jobsRemoved};
}
