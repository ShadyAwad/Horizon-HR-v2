import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {BusinessFixtures} from './business-scenario-fixtures';
import {STANZA_FINGERPRINT_GROOVES} from '../src/components/stanzaFingerprintGeometry';
const f=new BusinessFixtures();
try{
 await f.setup('asset-release');
 const missing:string[]=[],errors:string[]=[];
 const observe=(p:any)=>{p.on('pageerror',(e:Error)=>errors.push(e.message));p.on('response',(r:any)=>{const u=new URL(r.url());if(u.origin===f.base&&!u.pathname.startsWith('/api/')&&r.status()>=400)missing.push(`${r.status()} ${u.pathname}`);});};
 const publicPage=await f.publicContext.newPage();observe(publicPage);await publicPage.goto(f.base);await publicPage.getByRole('button',{name:'Log In',exact:true}).waitFor();
 const links=await publicPage.locator('link[rel=icon],link[rel=apple-touch-icon],link[rel=manifest]').evaluateAll((nodes:Element[])=>nodes.map(n=>n.getAttribute('href')!));
 for(const url of links){const r=await f.publicContext.request.get(f.base+url);assert.equal(r.status(),200,url);assert(!r.headers()['content-type']?.includes('text/html'),url+' must not be SPA fallback');}
 const manifest=await (await f.publicContext.request.get(f.base+'/manifest.webmanifest')).json();assert.equal(manifest.scope,'/');assert.equal(manifest.start_url,'/');
 for(const icon of manifest.icons){const r=await f.publicContext.request.get(f.base+icon.src);assert.equal(r.status(),200);assert(r.headers()['content-type'].includes('image/png'));}
 for(const tag of ['og:image','twitter:image']){const url=await publicPage.locator(`meta[property="${tag}"],meta[name="${tag}"]`).getAttribute('content');assert.equal((await f.publicContext.request.get(f.base+new URL(url!).pathname)).status(),200);}
 // Every repository public file is served literally, including font licenses and generator SVG inputs.
 async function checkPublic(dir:string){for(const entry of await readdir(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())await checkPublic(file);else{const url='/'+path.relative('public',file).split(path.sep).join('/');const r=await f.publicContext.request.get(f.base+url);assert.equal(r.status(),200,url);if(url!=='/service-worker.js')assert.deepEqual(Buffer.from(await r.body()),await readFile(file),url+' bytes');}}}
 await checkPublic('public');
 const p=await f.page(f.admin);observe(p);await p.locator('[data-tutorial-target=stanza-launcher]').waitFor();
 assert.deepEqual(await p.locator('[data-tutorial-target=stanza-launcher] svg path').evaluateAll((nodes:Element[])=>nodes.map(n=>n.getAttribute('d'))),[...STANZA_FINGERPRINT_GROOVES]);
 for(const module of ['Workspace Composer','Geo-Operations','Company Feed','Locations']){await f.navigate(p,module);if(module==='Workspace Composer'){await p.locator('.composer-empty button').click();await p.locator('.composer-gallery-card').first().waitFor();await p.locator('.composer-dialog').getByRole('button',{name:'Close',exact:true}).click();}await p.waitForTimeout(200);}
 const installed=await f.browser.newContext({serviceWorkers:'allow'});const ip=await installed.newPage();observe(ip);await ip.goto(f.base);await ip.waitForFunction(()=>Boolean(navigator.serviceWorker.controller),undefined,{timeout:15000});await ip.waitForTimeout(1000);await ip.reload();
 const cdp=await installed.newCDPSession(ip);const info=await cdp.send('Page.getAppManifest');assert.equal(info.errors.length,0,'Chromium manifest validation');
 await installed.setOffline(true);const offline=await ip.evaluate(async()=>{const r=await fetch('/offline.html');return {ok:r.ok,text:await r.text()};});assert(offline.ok&&offline.text.includes('Stanza Offline'));
 assert.deepEqual(missing,[],'No local static-resource failures');assert.deepEqual(errors,[],'No browser exceptions');await installed.close();
 console.log('PASS real Edge Login/Dashboard/launcher/Workspace gallery/Attendance/Feed/Locations, every public asset byte, favicons/social/Apple/manifest icons, Chromium manifest validation, active worker reload and offline shell; zero missing static assets');
}finally{await f.cleanup();}
