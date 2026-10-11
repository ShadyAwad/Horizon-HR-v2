import assert from 'node:assert/strict';
import {mkdtemp,readdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {LocalOpenAIProfileStore} from '../src/server/intelligent-router/openai-profile-store';
assert.equal(process.platform,'win32','real DPAPI verification requires Windows');
const base=await mkdtemp(path.join(os.tmpdir(),'stanza-release-vault-'));
const host='disposable-release-'+Date.now(),actor={tenantId:'fixture-tenant',employeeId:'fixture-employee',sessionId:'fixture-session'};
let dualOwners=0;
try{
 const seed=new LocalOpenAIProfileStore(host,base);
 await seed.write(actor,{registration:{clientId:'fixture-client',subject:'fixture-subject'}});await seed.close();
 const root=path.join(base,(await readdir(base))[0]);
 for(let iteration=0;iteration<5;iteration++){
  await writeFile(path.join(root,'runtime.lock'),JSON.stringify({pid:process.pid,id:'stale-fixture',startedAt:'old-process-start'}));
  const stores=[new LocalOpenAIProfileStore(host,base),new LocalOpenAIProfileStore(host,base)];
  try{
   const results=await Promise.allSettled(stores.map(s=>s.read(actor)));
   const owners=results.filter(r=>r.status==='fulfilled').length;
   console.log(`Stale lease concurrency iteration ${iteration+1}: ${owners} owners`);
   if(owners===2)dualOwners++;
  }finally{for(const s of stores)await s.close().catch(()=>undefined);}
 }
 console.log(`Observed dual ownership: ${dualOwners}/5`);
 if(process.env.RELEASE_SECURITY_PROBE!=='true')assert.equal(dualOwners,0,'stale lease recovery must preserve exclusive ownership');
}finally{
 assert(base.startsWith(path.join(os.tmpdir(),'stanza-release-vault-')));
 await rm(base,{recursive:true,force:true});
}
