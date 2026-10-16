import './router-env';
import {Queue} from 'bullmq';
import {getRedisConnection,HR_QUEUE_NAME} from '../src/lib/background-connections';
import {getMigrationPool,migrationUrl} from './migration-pool';
import {assertDatabaseMutationSafety,requireDestructiveConfirmation} from './mutation-safety';
import {DEMO_SLUG} from './demo/core';
import {lockRecovery,prepareRecovery,recoverDemo} from './demo/recovery';
import {inspectDemoJobs,finishRecoveryCleanup} from './demo/reconcile';
async function run(){
 if(process.env.STANZA_DEMO_ENV!=='true'||process.env.ALLOW_DEMO_DATA_MUTATION!=='true')throw Error('Recovery requires explicit demo mutation flags.');
 assertDatabaseMutationSafety(migrationUrl(),'Demo recovery',true,true);await requireDestructiveConfirmation(DEMO_SLUG,'demo recovery');
 if(!process.argv.includes('--initialize')&&process.env.DEMO_RESET_MAINTENANCE!=='true')throw Error('Pause the demo web/worker before reset and set DEMO_RESET_MAINTENANCE=true.');
 const pool=getMigrationPool(),client=await pool.connect(),queues=[HR_QUEUE_NAME,'stanza-communications'].map(name=>new Queue(name,{connection:{...getRedisConnection(),maxRetriesPerRequest:1,connectTimeout:1500,retryStrategy:()=>null}}));
 let committed=false;for(const queue of queues)queue.on('error',()=>{});
 try{await client.query('BEGIN');const tenant=await lockRecovery(client),jobs:string[]=[];for(const queue of queues)for(const job of await inspectDemoJobs(queue,tenant.id))jobs.push(queue.name+'/'+job.id);if(process.argv.includes('--initialize'))await prepareRecovery(client,tenant.id,jobs);else await recoverDemo(client,tenant,name=>console.log('Demo recovery phase:',name));await client.query('COMMIT');committed=true;if(!process.argv.includes('--initialize'))console.log('Recovery cleanup:',await finishRecoveryCleanup(client,queues,tenant.id));console.log(process.argv.includes('--initialize')?'Demo recovery checkpoint registered; existing unowned records protected.':'Demo recovered. All demo users must sign in again.');}catch(error){if(!committed)await client.query('ROLLBACK');else console.error('Database restored; file/queue cleanup pending. Rerun the same guarded command.');throw error;}finally{client.release();await pool.end();await Promise.all(queues.map(queue=>queue.close()));}
}
run().catch(()=>{console.error('Demo recovery failed. Check target, checkpoint, maintenance and infrastructure; no credentials or private file keys logged.');process.exitCode=1;});
