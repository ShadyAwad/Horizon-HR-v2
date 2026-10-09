import {spawn} from 'node:child_process';
import {watch,existsSync} from 'node:fs';
import {resolve,relative} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
export function shouldRestart(file){
 const name=file.replaceAll('\\','/');
 if(['server.ts','.env','.env.development.local','package.json','scripts/development-env.mjs'].includes(name))return true;
 return /^src\/(server|workers|lib|auth|db|navigation)\//.test(name)&&/\.(ts|tsx|json|sql)$/.test(name);
}
export function launch(kind){
 if(!['server','worker'].includes(kind))throw new Error('Expected server or worker');
 const entry=kind==='server'?'server.ts':'src/workers/hr-worker.ts';
 let child,stopping=false,restarting=false,debounce,changed='';const dependencies=new Set();
 const start=()=>{
  dependencies.clear();
  child=spawn(process.execPath,['--import','./scripts/development-env.mjs','--import','tsx',entry],{stdio:['inherit','inherit','inherit','ipc'],env:{...process.env,WATCH_REPORT_DEPENDENCIES:'1'},windowsHide:true});
  child.on('message',message=>{for(const name of [...(message?.['watch:require']||[]),...(message?.['watch:import']||[])])try{const file=name.startsWith('file:')?fileURLToPath(name):resolve(name);if(shouldRestart(relative(process.cwd(),file)))dependencies.add(resolve(file));}catch{}});
  child.once('error',error=>{console.error(`[dev:${kind}] Cannot launch: ${error.message}`);void stop(1);});
  child.once('exit',(code,signal)=>{if(!stopping&&!restarting){console.error(`[dev:${kind}] Child exited unexpectedly (${signal||code}); stopping the stack. Fix the error and rerun npm run dev.`);void stop(code||1);}});
 };
 const terminate=()=>new Promise(done=>{if(!child?.pid||child.exitCode!==null||child.signalCode!==null)return done();const target=child;target.once('exit',done);target.kill('SIGTERM');});
 const stop=async(code=0)=>{if(stopping)return;stopping=true;clearTimeout(debounce);for(const watcher of watchers)watcher.close();await terminate();process.exitCode=code;};
 const restart=async()=>{if(stopping||restarting)return;restarting=true;console.info(`[dev:${kind}] Restarting ${entry} after ${changed}`);await terminate();if(!stopping)start();restarting=false;};
 const changedFile=name=>{if(!shouldRestart(name)||name.startsWith('src/')&&!dependencies.has(resolve(name)))return;changed=name;clearTimeout(debounce);debounce=setTimeout(()=>void restart(),200);};
 const roots=['src/server','src/workers','src/lib','src/auth','src/db','src/navigation','scripts'].filter(existsSync);
 const watchers=[watch(process.cwd(),(_,name)=>{if(name)changedFile(String(name));}),...roots.map(root=>watch(root,{recursive:root!=='scripts'},(_,name)=>{if(name)changedFile(root+'/'+String(name));}))];
 for(const watcher of watchers)watcher.on('error',error=>{console.error(`[dev:${kind}] Watch failed: ${error.message}`);void stop(1);});
 process.once('SIGINT',()=>void stop());process.once('SIGTERM',()=>void stop());start();
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)launch(process.argv[2]);