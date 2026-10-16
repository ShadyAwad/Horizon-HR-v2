import {createHash} from 'node:crypto';
import {readFile,mkdir,writeFile,unlink} from 'node:fs/promises';
import path from 'node:path';
import type {PoolClient} from 'pg';
import {companyFeedImageStorage} from '../../src/lib/company-feed-image-storage';
import {assetEvidenceStorage} from '../../src/lib/asset-evidence-storage';
import {profileImageStorage} from '../../src/lib/profile-image-storage';
import {PrivateExtractionStorage} from '../../src/server/document-extraction/extraction-storage';
export type DemoFile={kind:'feed'|'asset'|'grievance'|'resume'|'avatar'|'extraction';key:string;checksum?:string};
function location(file:DemoFile,tenantId:string){
 if(!['feed','asset','grievance','resume','avatar','extraction'].includes(file.kind)||typeof file.key!=='string')throw Error('Invalid demo file kind or key.');
 if(!/^[0-9a-f-]{36}$/i.test(tenantId))throw Error('Invalid demo file tenant.');
 const privateRoot=process.env.GRIEVANCE_ATTACHMENT_DIRECTORY||'uploads/private-grievances';
 if(file.kind==='feed'||file.kind==='asset'){
  if(!new RegExp('^'+tenantId+'/[0-9a-f-]{36}\\.webp$','i').test(file.key))throw Error('Foreign demo image key.');
  return path.join(file.kind==='feed'?companyFeedImageStorage.directory:assetEvidenceStorage.directory,file.key);
 }
 if(file.kind==='avatar'){
  if(!/^\/profile-images\/[0-9a-f-]{36}\.webp$/i.test(file.key))throw Error('Invalid demo avatar key.');
  return path.join(profileImageStorage.directory,path.basename(file.key));
 }
 if(!/^[0-9a-f-]{36}\.bin$/i.test(file.key))throw Error('Invalid demo private file key.');
 return path.join(file.kind==='extraction'?new PrivateExtractionStorage().directory:file.kind==='resume'?path.join(privateRoot,'hiring'):privateRoot,file.key);
}
function backupLocation(file:DemoFile,tenantId:string){location(file,tenantId);return path.resolve(process.env.DEMO_RECOVERY_DIRECTORY||'uploads/demo-recovery',tenantId,createHash('sha256').update(file.kind+':'+file.key).digest('hex')+'.bin');}
export async function listDemoFiles(client:PoolClient,tenantId:string):Promise<DemoFile[]>{
 const files:DemoFile[]=[];
 for(const [table,column,kind] of [['company_feed_images','storage_key','feed'],['asset_condition_reports','evidence_url','asset'],['grievance_attachments','storage_key','grievance'],['hiring_applicants','resume_key','resume'],['employees','profile_image_url','avatar'],['document_extraction_jobs','storage_key','extraction']] as const)
  for(const row of(await client.query(`SELECT ${column} AS key FROM ${table} WHERE tenant_id=$1 AND ${column} IS NOT NULL`,[tenantId])).rows){const file={kind,key:row.key};location(file,tenantId);files.push(file);}
 return [...new Map(files.map(f=>[f.kind+':'+f.key,f])).values()];
}
export async function assertDemoFileOwnership(client:PoolClient,files:DemoFile[],tenantId:string){
 const sources={feed:['company_feed_images','storage_key'],asset:['asset_condition_reports','evidence_url'],grievance:['grievance_attachments','storage_key'],resume:['hiring_applicants','resume_key'],avatar:['employees','profile_image_url'],extraction:['document_extraction_jobs','storage_key']} as const;
 for(const file of files){location(file,tenantId);const [table,column]=sources[file.kind];if((await client.query(`SELECT 1 FROM ${table} WHERE tenant_id<>$1 AND ${column}=$2 LIMIT 1`,[tenantId,file.key])).rowCount)throw Error('Recovery file is referenced by a foreign tenant; stopped safely.');}
}
export async function backupDemoFiles(files:DemoFile[],tenantId:string){
 for(const file of files){const data=await readFile(location(file,tenantId));if(data.length>10*1024*1024)throw Error('Demo baseline file exceeds supported limit.');file.checksum=createHash('sha256').update(data).digest('hex');const target=backupLocation(file,tenantId);await mkdir(path.dirname(target),{recursive:true,mode:0o700});await writeFile(target,data,{mode:0o600});}
}
export async function restoreDemoFiles(files:DemoFile[],tenantId:string){
 for(const file of files){const data=await readFile(backupLocation(file,tenantId));if(!file.checksum||createHash('sha256').update(data).digest('hex')!==file.checksum)throw Error('Demo baseline file checksum mismatch.');const target=location(file,tenantId);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,data,{flag:'w'});}
}
export async function removeDemoFiles(files:DemoFile[],tenantId:string){
 for(const file of files){location(file,tenantId);if(file.kind==='feed')await companyFeedImageStorage.remove(file.key);else if(file.kind==='asset')await assetEvidenceStorage.remove(file.key);else if(file.kind==='avatar')await profileImageStorage.remove(file.key);else await new PrivateExtractionStorage(file.kind==='extraction'?new PrivateExtractionStorage().directory:file.kind==='resume'?path.join(process.env.GRIEVANCE_ATTACHMENT_DIRECTORY||'uploads/private-grievances','hiring'):process.env.GRIEVANCE_ATTACHMENT_DIRECTORY||'uploads/private-grievances',Infinity).remove(file.key);}
}

export async function backupCaseHistory(tenantId:string,history:Record<string,Record<string,unknown>[]>){
 const file:DemoFile={kind:'grievance',key:tenantId+'.bin'},target=backupLocation(file,tenantId)+'.history';const data=Buffer.from(JSON.stringify(history));
 if(data.length>10*1024*1024)throw Error('Recovery case history exceeds supported limit.');await mkdir(path.dirname(target),{recursive:true,mode:0o700});await writeFile(target,data,{mode:0o600});return createHash('sha256').update(data).digest('hex');
}
export async function readCaseHistory(tenantId:string,checksum:string):Promise<Record<string,Record<string,unknown>[]>>{
 const data=await readFile(backupLocation({kind:'grievance',key:tenantId+'.bin'},tenantId)+'.history');if(createHash('sha256').update(data).digest('hex')!==checksum)throw Error('Recovery case history checksum mismatch.');return JSON.parse(data.toString('utf8'));
}

export async function verifyDemoBackups(files:DemoFile[],tenantId:string){for(const file of files){const data=await readFile(backupLocation(file,tenantId));if(!file.checksum||createHash('sha256').update(data).digest('hex')!==file.checksum)throw Error('Demo baseline backup checksum mismatch.');}}
