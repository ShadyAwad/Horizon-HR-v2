import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, lstat, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { RouterActor, OpenAICredentials } from './openai-local-auth';
export type StoredOpenAIProfile = { registration: { clientId: string; subject: string }; credentials?: OpenAICredentials };
export interface OpenAIProfileStore {
  read(actor: RouterActor): Promise<StoredOpenAIProfile | null>;
  write(actor: RouterActor, profile: StoredOpenAIProfile): Promise<void>;
  close(): Promise<void>;
}
function windows(script: string, input: unknown): Promise<string> {
  return new Promise((resolve,reject)=>{
    const child=spawn(path.join(process.env.SystemRoot || 'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop'; "+script],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    let output='';child.stdout.on('data',b=>output+=b);child.stderr.resume();
    child.on('error',()=>reject(Error('OPENAI_STORE_UNAVAILABLE')));child.on('close',code=>code===0?resolve(output.trim()):reject(Error('OPENAI_STORE_UNAVAILABLE')));
    child.stdin.end(JSON.stringify(input));
  });
}
/** Local Windows vault: AES-256-GCM records, DPAPI CurrentUser-wrapped key, private ACL.
 * Same cryptographic primitive as Stanza QR encryption, with a separate key and owner AAD.
 * A process lease prevents two preview processes racing renewable credentials.
 */
export class LocalOpenAIProfileStore implements OpenAIProfileStore {
  private ready?: Promise<void>;
  private encryptionKey?: Buffer;
  private readonly lease=randomUUID();
  private owned=false;
  private writes=Promise.resolve();
  private readonly root: string;
  constructor(private readonly hostId: string, base=path.resolve('.cache','stanza-openai')) {
    this.root=path.join(base,createHash('sha256').update(hostId).digest('hex'));
  }
  private owner(actor: RouterActor) {return JSON.stringify([this.hostId,actor.tenantId,actor.employeeId]);}
  private file(actor: RouterActor) {return path.join(this.root,createHash('sha256').update(this.owner(actor)).digest('hex')+'.enc');}
  private async initialize() {
    if(process.platform!=='win32')throw Error('OPENAI_STORE_UNAVAILABLE'); // No unprotected key fallback.
    await mkdir(this.root,{recursive:true,mode:0o700});
    for(const p of [path.dirname(this.root),this.root])if((await lstat(p)).isSymbolicLink())throw Error('OPENAI_STORE_UNAVAILABLE');
    await windows("$p=([Console]::In.ReadToEnd()|ConvertFrom-Json).path; $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; & icacls.exe $p /inheritance:r /grant:r ('*'+$sid+':(OI)(CI)F') | Out-Null; if($LASTEXITCODE -ne 0){throw 'ACL unavailable'}",{path:this.root});
    const leasePath=path.join(this.root,'runtime.lock');
    // PID reuse must not turn an unrelated process into a permanent vault owner.
    // Uninspectable owners still fail closed; no credential reads bypass the lease.
    const identity=async(pid:number):Promise<{executable?:string;startedAt?:string}>=>JSON.parse(await windows("$x=[Console]::In.ReadToEnd()|ConvertFrom-Json; $p=Get-Process -Id $x.pid -ErrorAction Stop; @{executable=$p.Path; startedAt=$p.StartTime.ToUniversalTime().ToString('o')} | ConvertTo-Json -Compress",{pid}));
    const own=await identity(process.pid);
    const leaseRecord=JSON.stringify({pid:process.pid,id:this.lease,startedAt:own.startedAt});
    try {await writeFile(leasePath,leaseRecord,{flag:'wx',mode:0o600});}
    catch(e) {
      if((e as NodeJS.ErrnoException).code!=='EEXIST')throw Error('OPENAI_STORE_UNAVAILABLE');
      const old=JSON.parse(await readFile(leasePath,'utf8'));let alive=true;
      try{process.kill(old.pid,0);}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')alive=false;}
      if(alive){
        try{const current=await identity(old.pid);
          if(current.executable && own.executable && path.basename(current.executable).toLowerCase()!==path.basename(own.executable).toLowerCase() || old.startedAt && current.startedAt && old.startedAt!==current.startedAt)alive=false;
        }catch{/* An inaccessible live owner retains its lease. */}
      }
      if(alive)throw Error('OPENAI_STORE_BUSY');
      await unlink(leasePath);await writeFile(leasePath,leaseRecord,{flag:'wx',mode:0o600});
    }
    this.owned=true;
    try {
      const keyFile=path.join(this.root,'key.dpapi');let protectedKey:string;
      try {protectedKey=await readFile(keyFile,'utf8');}
      catch(e) {
        if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;
        const generated=randomBytes(32);
        protectedKey=await windows("Add-Type -AssemblyName System.Security; $x=[Console]::In.ReadToEnd()|ConvertFrom-Json; [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect([Convert]::FromBase64String($x.data),[Text.Encoding]::UTF8.GetBytes($x.entropy),[Security.Cryptography.DataProtectionScope]::CurrentUser))",{data:generated.toString('base64'),entropy:this.hostId});
        generated.fill(0);await writeFile(keyFile,protectedKey,{flag:'wx',mode:0o600});
      }
      const key=await windows("Add-Type -AssemblyName System.Security; $x=[Console]::In.ReadToEnd()|ConvertFrom-Json; [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($x.data),[Text.Encoding]::UTF8.GetBytes($x.entropy),[Security.Cryptography.DataProtectionScope]::CurrentUser))",{data:protectedKey,entropy:this.hostId});
      this.encryptionKey=Buffer.from(key,'base64');if(this.encryptionKey.length!==32)throw Error('OPENAI_STORE_UNAVAILABLE');
    }catch{await this.release();throw Error('OPENAI_STORE_UNAVAILABLE');}
  }
  private init() {
    return this.ready ??= this.initialize().catch(error=>{this.ready=undefined;throw error;});
  }
  async read(actor: RouterActor) {
    await this.init();await this.writes;
    let blob:string;try{blob=await readFile(this.file(actor),'utf8');}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw Error('OPENAI_STORE_UNAVAILABLE');}
    try {
      const [version,iv,tag,data,extra]=blob.split('.');if(version!=='v1'||extra||!iv||!tag||!data||blob.length>128_000)throw Error();
      const decipher=createDecipheriv('aes-256-gcm',this.encryptionKey!,Buffer.from(iv,'base64url'));
      decipher.setAAD(Buffer.from(this.owner(actor)));decipher.setAuthTag(Buffer.from(tag,'base64url'));
      return JSON.parse(Buffer.concat([decipher.update(Buffer.from(data,'base64url')),decipher.final()]).toString('utf8')) as StoredOpenAIProfile;
    }catch{throw Error('OPENAI_STORE_UNAVAILABLE');}
  }
  /** Read-only diagnostics: no lease, writes, refresh or token rotation. Caller must validate Stanza session and fresh expiry. */
  async snapshot(actor: RouterActor) {
    for(const p of [path.dirname(this.root),this.root])if((await lstat(p)).isSymbolicLink())throw Error('OPENAI_STORE_UNAVAILABLE');
    const protectedKey=await readFile(path.join(this.root,'key.dpapi'),'utf8');
    const unwrapped=await windows("Add-Type -AssemblyName System.Security; $x=[Console]::In.ReadToEnd()|ConvertFrom-Json; [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($x.data),[Text.Encoding]::UTF8.GetBytes($x.entropy),[Security.Cryptography.DataProtectionScope]::CurrentUser))",{data:protectedKey,entropy:this.hostId});
    const key=Buffer.from(unwrapped,'base64');
    try {
      const blob=await readFile(this.file(actor),'utf8'),[version,iv,tag,data,extra]=blob.split('.');
      if(key.length!==32 || version!=='v1' || extra || !iv || !tag || !data || blob.length>128_000)throw Error();
      const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(iv,'base64url'));decipher.setAAD(Buffer.from(this.owner(actor)));decipher.setAuthTag(Buffer.from(tag,'base64url'));
      return JSON.parse(Buffer.concat([decipher.update(Buffer.from(data,'base64url')),decipher.final()]).toString('utf8')) as StoredOpenAIProfile;
    }catch{throw Error('OPENAI_STORE_UNAVAILABLE');}finally{key.fill(0);}
  }
  async write(actor: RouterActor, profile: StoredOpenAIProfile) {
    await this.init();
    const task=this.writes.then(async()=>{
      const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.encryptionKey!,iv);
      cipher.setAAD(Buffer.from(this.owner(actor)));
      const data=Buffer.concat([cipher.update(JSON.stringify(profile),'utf8'),cipher.final()]);
      const target=this.file(actor),temporary=target+'.tmp.'+randomUUID();
      try{await writeFile(temporary,['v1',iv.toString('base64url'),cipher.getAuthTag().toString('base64url'),data.toString('base64url')].join('.'),{flag:'wx',mode:0o600});await rename(temporary,target);}
      finally{await unlink(temporary).catch(e=>{if(e.code!=='ENOENT')throw e;});}
    });this.writes=task.catch(()=>{});await task;
  }
  private async release() {
    if(!this.owned)return;const leasePath=path.join(this.root,'runtime.lock');
    if(JSON.parse(await readFile(leasePath,'utf8')).id===this.lease)await unlink(leasePath);
    this.owned=false;
  }
  async close() {await this.ready?.catch(()=>{});await this.writes;await this.release();this.encryptionKey?.fill(0);}
}
