import assert from 'node:assert/strict';
import { mkdtemp,readFile,readdir,writeFile,rm } from 'node:fs/promises';
import path from 'node:path';
import { LocalOpenAIProfileStore } from '../src/server/intelligent-router/openai-profile-store';
import type { OpenAICredentials } from '../src/server/intelligent-router/openai-local-auth';
if(process.platform!=='win32'){console.log('SKIP real Windows DPAPI fixture on this platform');process.exit(0);}
await (await import('node:fs/promises')).mkdir('.cache',{recursive:true});
const base=await mkdtemp(path.resolve('.cache','stanza-vault-test-')),host='urn:uuid:11111111-1111-4111-8111-111111111111',actor={tenantId:'tenant',employeeId:'user',sessionId:'session'};
const credentials={actor,clientId:'issued-client',subject:'verified-subject',access:'fixture-access-secret',refresh:'fixture-refresh-secret',scopes:['resource.invoke','chatgpt.tokens.use.direct'],expires:Date.now()+3600_000,idleExpiry:Date.now()+3600_000} as OpenAICredentials;
let store=new LocalOpenAIProfileStore(host,base);
try {
  await store.write(actor,{registration:{clientId:credentials.clientId,subject:credentials.subject},credentials});
  assert.equal((await store.read(actor))?.credentials?.access,credentials.access);
  assert.equal((await new LocalOpenAIProfileStore(host,base).snapshot(actor)).credentials?.access,credentials.access,'read-only snapshot can diagnose a fresh grant without refreshing or taking the runtime lease');
  assert.equal(await store.read({...actor,tenantId:'another'}),null);
  const root=path.join(base,(await readdir(base))[0]),file=(await readdir(root)).find(f=>f.endsWith('.enc'))!;
  assert(!(await readFile(path.join(root,file),'utf8')).includes('fixture'));
  const competing=new LocalOpenAIProfileStore(host,base);await assert.rejects(()=>competing.read(actor),/OPENAI_STORE_BUSY/);await competing.close();
  await store.close();store=new LocalOpenAIProfileStore(host,base);
  assert.equal((await store.read(actor))?.credentials?.refresh,credentials.refresh,'real encrypted state survives store restart');
  await store.write(actor,{registration:{clientId:credentials.clientId,subject:credentials.subject}});assert.equal((await store.read(actor))?.credentials,undefined,'disconnect removes token material while retaining client registration');
  await writeFile(path.join(root,file),'v1.tampered.invalid.data');await assert.rejects(()=>store.read(actor),/OPENAI_STORE_UNAVAILABLE/);
  console.log('PASS real Windows DPAPI + AES-GCM: encrypted roundtrip, restart, owner isolation, process lease, token removal, tamper rejection. Fixture credentials only.');
}finally{await store.close();assert(base.startsWith(path.resolve('.cache')+path.sep));await rm(base,{recursive:true,force:true});}
