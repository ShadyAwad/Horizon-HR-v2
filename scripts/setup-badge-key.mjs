import {randomBytes} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {parse} from 'dotenv';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
export function validBadgeKey(value){if(typeof value!=='string')return false;const bytes=Buffer.from(value.trim(),'base64');return bytes.length===32&&bytes.toString('base64')===value.trim();}
export async function setupBadgeKey(directory=process.cwd(),environment=process.env){
 if(environment.NODE_ENV==='production')throw Error('Local badge setup refuses production.');
 const file=path.join(directory,'.env.development.local');
 const read=async p=>{try{return await readFile(p,'utf8');}catch(e){if(e.code==='ENOENT')return '';throw e;}};
 const base=parse(await read(path.join(directory,'.env'))),content=await read(file),local=parse(content);
 if(base.NODE_ENV==='production'||local.NODE_ENV==='production')throw Error('Local badge setup refuses production configuration.');
 const current=local.QR_TOKEN_ENCRYPTION_KEY||environment.QR_TOKEN_ENCRYPTION_KEY||base.QR_TOKEN_ENCRYPTION_KEY;
 if(current){if(!validBadgeKey(current))throw Error('Existing QR_TOKEN_ENCRYPTION_KEY is invalid; correct it explicitly.');return {created:false};}
 const key=randomBytes(32).toString('base64');
 const line='QR_TOKEN_ENCRYPTION_KEY='+key;
 const next=/^QR_TOKEN_ENCRYPTION_KEY=.*$/m.test(content)?content.replace(/^QR_TOKEN_ENCRYPTION_KEY=.*$/m,line):content.replace(/\s*$/,'')+'\n'+line+'\n';
 await writeFile(file,next,{mode:0o600});return {created:true};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const result=await setupBadgeKey();console.log(result.created?'Saved a persistent local badge key in ignored .env.development.local. Restart the local server.':'Existing badge key is valid and preserved.');
}
