import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFile,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import os from 'node:os';
import {BusinessFixtures} from './business-scenario-fixtures';

// Real installed library, built application, cookie sessions and disposable database fixtures.
// External basemaps are replaced by a bounded local style, never contacted or attacked.
const f=new BusinessFixtures();
const baseline=process.env.MAPLIBRE_AUDIT_BASELINE==='true';
const externalArtifacts=process.env.MAPLIBRE_TEST_ARTIFACT_DIR;
const artifacts=externalArtifacts||await mkdtemp(path.join(os.tmpdir(),'stanza-map-browser-'));
const phase=baseline?'before':'after';
const require=createRequire(import.meta.url);
const version=JSON.parse(await readFile(require.resolve('maplibre-gl/package.json'),'utf8')).version;
const attribution='<a href="javascript:void(0)" onclick="return false" onfocus="return false">Owned attribution marker</a><script type="application/json">{"owned":true}</script><a href="https://example.invalid/license" target="_blank">Fixture license</a>';
const fc={type:'FeatureCollection',features:[{type:'Feature',properties:{name:'Owned map line',nested:{safe:true}},geometry:{type:'LineString',coordinates:[[31.20,30.04],[31.27,30.05]]}}]};
const style=(unsafe=false)=>({version:8,sources:{owned:{type:'geojson',data:fc,attribution:unsafe?attribution:'Stanza local map fixture'}},layers:[{id:'base',type:'background',paint:{'background-color':'#26343e'}},{id:'owned-road',type:'line',source:'owned',paint:{'line-color':'#8da0a9','line-width':3}}]});
const measurements:any[]=[];
async function diagnostics(context:any){
 await context.addInitScript(()=>{
  const state=(window as any).mapAudit={workers:0,workerStarts:0,webgl2:0,violations:[],errors:[]};
  const OriginalWorker=window.Worker;
  window.Worker=class extends OriginalWorker {
   stopped=false;
   constructor(url:any,options?:any){super(url,options);state.workers++;state.workerStarts++;}
   terminate(){if(!this.stopped){state.workers--;this.stopped=true;}super.terminate();}
  };
  const getContext=HTMLCanvasElement.prototype.getContext;
  (HTMLCanvasElement.prototype as any).getContext=function(...args:any[]){const value=(getContext as any).apply(this,args);if(args[0]==='webgl2'&&value)state.webgl2++;return value;};
  document.addEventListener('securitypolicyviolation',e=>state.violations.push(e.violatedDirective));
 });
 await context.route('https://**/*',async(route:any)=>{
  const url=new URL(route.request().url());
  if(url.hostname==='api.maptiler.com'&&url.pathname.endsWith('/style.json'))await route.fulfill({json:style(),headers:{'access-control-allow-origin':'*'}});
  else await route.abort();
 });
}
async function inspectMap(page:any,label:string){
 const canvas=page.locator('.maplibregl-canvas');await canvas.waitFor();assert.equal(await canvas.count(),1,'one map canvas');
 await page.locator('.maplibregl-marker').waitFor();await page.waitForTimeout(1100);
 const state=await page.evaluate(()=>{const w=window as any;const c=document.querySelector('.maplibregl-canvas') as HTMLCanvasElement;const r=c.getBoundingClientRect();return {...w.mapAudit,width:r.width,height:r.height,overflow:document.documentElement.scrollWidth>innerWidth+1};});
 assert(state.webgl2>0,'real WebGL2 context');assert(state.workers>0,'real map worker');assert(state.width>100&&state.height>100);assert(!state.overflow,'map fits viewport');assert.deepEqual(state.violations,[],'unchanged production CSP');
 const starts=state.workerStarts;await page.waitForTimeout(350);assert.equal(await page.evaluate(()=>(window as any).mapAudit.workerStarts),starts,'no worker recreation at rest');
 await canvas.screenshot({path:path.join(artifacts,`${phase}-${label}.png`)});
 measurements.push({label,width:state.width,height:state.height,workers:state.workers,workerStarts:starts});
}
try {
 await f.setup('maplibre');
 await diagnostics(f.publicContext);await diagnostics(f.admin.context);
 // Local public probe exercises the real package's public APIs and attribution consumer.
 const module=await build({stdin:{contents:`import * as ns from 'maplibre-gl';const lib=${baseline?'ns.default||ns':'ns'};if(${!baseline})lib.setWorkerUrl('/__maplibre_worker.mjs');window.lib=lib;window.probeMap=new lib.Map({container:'map',style:${JSON.stringify(style(true))},center:[31.2357,30.0444],zoom:13,attributionControl:{compact:false}});`,resolveDir:process.cwd()},bundle:true,format:'esm',platform:'browser',target:'es2022',write:false,minify:true});
 await f.publicContext.route('**/__maplibre_probe',async(route:any)=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><link rel="stylesheet" href="/__maplibre_probe.css"></head><body><div id="map" style="width:600px;height:400px"></div><script type="module" src="/__maplibre_probe.mjs"></script></body></html>'}));
 await f.publicContext.route('**/__maplibre_probe.mjs',async(route:any)=>route.fulfill({contentType:'text/javascript',body:module.outputFiles[0].text}));
 await f.publicContext.route('**/__maplibre_probe.css',async(route:any)=>route.fulfill({contentType:'text/css',body:await readFile(require.resolve('maplibre-gl/dist/maplibre-gl.css'),'utf8')}));
 if(!baseline){const worker=await build({entryPoints:[require.resolve('maplibre-gl/dist/maplibre-gl-worker.mjs')],bundle:true,format:'esm',platform:'browser',write:false,minify:true});await f.publicContext.route('**/__maplibre_worker.mjs',async(route:any)=>route.fulfill({contentType:'text/javascript',body:worker.outputFiles[0].text}));}
 const probe=await f.publicContext.newPage();probe.on('pageerror',(e:any)=>console.log('PROBE_ERROR',e.message));probe.on('console',(m:any)=>{if(m.type()==='error')console.log('PROBE_ERROR',m.text());});await probe.goto(f.base+'/__maplibre_probe');
 await probe.waitForFunction(()=>(window as any).probeMap?.loaded());
 const sanitation=await probe.locator('.maplibregl-ctrl-attrib-inner').evaluate((element:HTMLElement)=>({unsafe:[...element.querySelectorAll('*')].flatMap(e=>[...e.attributes].filter(a=>a.name.startsWith('on')||/javascript:|data:/i.test(a.value)).map(a=>a.name)),scripts:element.querySelectorAll('script').length,license:element.querySelector('a[href="https://example.invalid/license"]')?.textContent,marker:element.textContent?.includes('Owned attribution marker')}));
 assert(sanitation.marker&&sanitation.license==='Fixture license');assert.equal(sanitation.scripts,0);
 if(baseline)assert(sanitation.unsafe.length>0,'baseline reproduces adjacent attribute skip with inert handlers');else assert.deepEqual(sanitation.unsafe,[],'all adjacent unsafe attributes removed');
 console.log('PASS attribution actual source consumer',JSON.stringify({version,baseline,remainingUnsafeAttributes:sanitation.unsafe}));
 const geo=await probe.evaluate(async()=>{
  const map=(window as any).probeMap;
  const polygon={type:'Feature',properties:{nested:{safe:true}},geometry:{type:'Polygon',coordinates:[[[31.23,30.04],[31.24,30.04],[31.24,30.05],[31.23,30.04]]]}};
  const loaded=new Promise<void>(resolve=>map.once('idle',()=>resolve()));map.getSource('owned').setData({type:'FeatureCollection',features:[polygon,{type:'Feature',properties:{kind:'point'},geometry:{type:'Point',coordinates:[31.2357,30.0444]}}]});map.addLayer({id:'owned-polygon',type:'fill',source:'owned',paint:{'fill-color':'#10b981'}});map.fitBounds([[31.23,30.04],[31.24,30.05]],{duration:0});await loaded;
  const result={center:map.getCenter().toArray(),features:map.querySourceFeatures('owned').map((feature:any)=>feature.toJSON()),webgl2:map.getCanvas().getContext('webgl2')!==null};
  map.remove();return result;
 });
 assert(geo.webgl2);assert(geo.center[0]>31&&geo.center[1]>30);assert(geo.features.length>0);assert(geo.features.some((x:any)=>x.geometry.type==='Point'),'Point source round-trip');assert(geo.features.some((x:any)=>baseline?typeof x.properties.nested==='string':x.properties.nested?.safe===true),'nested GeoJSON properties round-trip through current API');
 await probe.close();
 const location=(await f.ok(f.admin,'/api/hr/locations',{name:'Owned map qualification',code:'MAP',latitude:30.0444,longitude:31.2357,radius:300,locationType:'branch'})).location;
 const original=(await f.db.query('SELECT ST_AsEWKB(boundary) AS geometry,ST_SRID(boundary) AS srid FROM company_locations WHERE id=$1',[location.id])).rows[0];assert.equal(original.srid,4326);
 assert.equal((await f.api(f.employee,'/api/hr/locations',{name:'Denied',latitude:30,longitude:31,radius:300})).status,403);
 assert.equal((await f.api(f.foreign,'/api/hr/locations/'+location.id)).status,404);
 assert.equal((await f.api(null,'/api/hr/locations')).status,401);
 const matrix=[{width:1440,theme:'dark',lang:'en',preset:'emerald'},{width:820,theme:'dark',lang:'en',preset:'custom'},{width:390,theme:'light',lang:'en',preset:'emerald'},{width:390,theme:'dark',lang:'ar',preset:'emerald'}];
 for(const item of matrix){
  const ar=item.lang==='ar';const label=`${item.width}-${item.theme}-${item.preset}-${item.lang}`;
  const settings={tutorialsAutoStart:false,lanyardEnabled:false,backgroundPreset:item.preset,customTheme:{accent:'#8B5CF6'},customAccent:'#8B5CF6'};
  await f.admin.context.addInitScript(({item,settings}:any)=>{localStorage.setItem('horizon-language',item.lang);localStorage.setItem('horizon-theme',item.theme);localStorage.setItem('stanza.preferences.v1',JSON.stringify(settings));},{item,settings});
  const p=await f.page(f.admin);await p.setViewportSize({width:item.width,height:1000});const errors:string[]=[];p.on('pageerror',(e:any)=>errors.push(e.message));p.on('console',(m:any)=>{if(m.type()==='error'&&!m.text().startsWith('[PWA] Service worker registration failed:'))errors.push(m.text().replace(/https?:\/\/\S+/g,'[URL]'));});
  const start=performance.now();await f.navigate(p,ar?'المواقع':'Locations');await p.getByRole('heading',{name:'Owned map qualification',exact:true}).waitFor();
  await p.getByRole('button',{name:ar?'تعديل':'Edit',exact:true}).first().click();
  const dialog=p.locator('[data-location-modal]');await inspectMap(p,'locations-'+label);measurements.push({label:'locations-'+label,mountMs:performance.now()-start});
  assert.equal(await dialog.getAttribute('dir'),null);assert.equal(await p.locator('section[dir]').filter({has:dialog}).count(),1);
  const lat=dialog.getByLabel(ar?'خط العرض':'Latitude',{exact:true});const lng=dialog.getByLabel(ar?'خط الطول':'Longitude',{exact:true});
  assert.equal(await lat.inputValue(),'30.0444');assert.equal(await lng.inputValue(),'31.2357');
  if(!baseline){const canvas=p.locator('.maplibregl-canvas');const box=await canvas.boundingBox();await canvas.click({position:{x:box.width*.65,y:box.height*.55}});for(let check=0;check<40&&(await lng.inputValue())==='31.2357';check++)await p.waitForTimeout(50);assert.notEqual(await lng.inputValue(),'31.2357','map click updates coordinates');
   if(item.width===1440){await p.locator('.maplibregl-marker').waitFor();const beforeDrag=await lng.inputValue();const markerBox=await p.locator('.maplibregl-marker').boundingBox();await p.mouse.move(markerBox.x+markerBox.width/2,markerBox.y+markerBox.height/2);await p.mouse.down();await p.mouse.move(markerBox.x+markerBox.width/2+30,markerBox.y+markerBox.height/2+10,{steps:5});await p.mouse.up();for(let check=0;check<40&&(await lng.inputValue())===beforeDrag;check++)await p.waitForTimeout(50);assert.notEqual(await lng.inputValue(),beforeDrag,'marker dragend updates coordinates');}
}

  await p.keyboard.press('Escape');await dialog.waitFor({state:'detached'});assert.equal(await p.locator('.maplibregl-canvas').count(),0);const retainedWorkers=await p.evaluate(()=>(window as any).mapAudit.workers);
  // A library-wide dispatcher may retain a shared pool; remounts must not grow it.
  for(let repeat=0;repeat<2;repeat++){await p.getByRole('button',{name:ar?'تعديل':'Edit',exact:true}).first().click();await p.locator('.maplibregl-marker').waitFor();await p.keyboard.press('Escape');await dialog.waitFor({state:'detached'});assert.equal(await p.locator('.maplibregl-canvas').count(),0);assert.equal(await p.evaluate(()=>(window as any).mapAudit.workers),retainedWorkers,'bounded shared worker pool');}
  assert.deepEqual(errors,[],'no map errors');await p.close();
  await f.publicContext.grantPermissions(['geolocation'],{origin:f.base});await f.publicContext.setGeolocation({latitude:30.0444,longitude:31.2357,accuracy:15});
  await f.publicContext.addInitScript(({item,settings}:any)=>{
   localStorage.setItem('horizon-language',item.lang);localStorage.setItem('horizon-theme',item.theme);localStorage.setItem('stanza.preferences.v1',JSON.stringify(settings));
   sessionStorage.setItem('stanza.create-workspace-flow','map-audit');sessionStorage.setItem('stanza.create-workspace-draft.v3.map-audit',JSON.stringify({version:3,currentStep:3,updatedAt:new Date().toISOString(),data:{companyName:'Owned preview',tenantSlug:'owned-preview',adminRole:'hr_admin',currency:'EGP',capacity:'100-500',allowsLoans:false,lat:null,lng:null,radius:300,locations:[{name:'Owned geofence',locationType:'branch',address:'',lat:null,lng:null,radius:300,isPrimary:true}],customRoles:[],selectedLocationIndex:0,welcomeEmailOptions:{sendWelcomeEmail:false,includeWorkspaceName:false,includeLoginEmail:false}}}));
  },{item,settings});
  const signup=await f.publicContext.newPage();await signup.setViewportSize({width:item.width,height:1000});signup.setDefaultTimeout(20000);const signupErrors:string[]=[];signup.on('pageerror',(e:any)=>signupErrors.push(e.message));signup.on('console',(m:any)=>{if(m.type()==='error'&&!m.text().startsWith('[PWA] Service worker registration failed:'))signupErrors.push(m.text().replace(/https?:\/\/\S+/g,'[URL]'));});await signup.goto(f.base);
  await signup.getByRole('button',{name:ar?'تسجيل شركة جديدة':'Register New Company',exact:true}).click();
  await signup.locator('.maplibregl-canvas').waitFor();await signup.waitForTimeout(500);
  await signup.getByRole('button',{name:ar?'استخدم موقعي':'Use My Location',exact:true}).click();
  await inspectMap(signup,'signup-'+label);
  const map=signup.locator('.maplibregl-map');assert.equal(await map.locator('.maplibregl-ctrl-attrib').count(),1);assert.equal(await map.locator('.maplibregl-ctrl-zoom-in').count(),1);
  await map.locator('.maplibregl-ctrl-zoom-in').click();await signup.getByRole('slider').press('ArrowRight');await signup.waitForTimeout(450);
  await signup.getByRole('button',{name:ar?'نوع الموقع: القمر الصناعي':'Location Type: Satellite',exact:true}).click();await signup.waitForTimeout(350);
  assert.equal(await map.locator('.maplibregl-marker').count(),1);await signup.keyboard.press('Tab');assert(await signup.evaluate(()=>document.activeElement!==document.body),'keyboard focus remains available');
  assert.deepEqual(signupErrors,[],'signup map errors');await signup.close();console.log('PASS both map surfaces',label);
 }
 // Normal browser location create/edit/reload, with server-authoritative persisted geometry.
 const p=await f.page(f.admin);await f.navigate(p,'المواقع');
 await p.getByRole('button',{name:'إضافة موقع',exact:true}).click();const dialog=p.locator('[data-location-modal]');
 await dialog.getByLabel('الاسم',{exact:true}).fill('Owned browser-created map');await dialog.getByLabel('خط العرض',{exact:true}).fill('30.045');await dialog.getByLabel('خط الطول',{exact:true}).fill('31.236');await dialog.getByLabel('النطاق (متر)',{exact:true}).fill('450');
 const saved=p.waitForResponse((r:any)=>r.url().endsWith('/api/hr/locations')&&r.request().method()==='POST');await dialog.getByRole('button',{name:'حفظ الموقع',exact:true}).click();assert.equal((await saved).status(),201);await p.reload();await f.navigate(p,'المواقع');await p.getByRole('heading',{name:'Owned browser-created map',exact:true}).waitFor();await p.close();
 if(!baseline){
  const installed=await f.browser.newContext({serviceWorkers:'allow',storageState:await f.admin.context.storageState()});await diagnostics(installed);
  await installed.addInitScript(()=>{localStorage.setItem('horizon-language','en');localStorage.setItem('stanza.preferences.v1',JSON.stringify({tutorialsAutoStart:false,lanyardEnabled:false}));});
  const installedPage=await installed.newPage();installedPage.setDefaultTimeout(20000);await installedPage.goto(f.base);await installedPage.evaluate(()=>navigator.serviceWorker.ready);await installedPage.waitForFunction(()=>!!navigator.serviceWorker.controller);
  await f.navigate(installedPage,'Locations');await installedPage.getByRole('button',{name:'Edit',exact:true}).first().click();await inspectMap(installedPage,'installed-pwa');
  const cached=await installedPage.evaluate(async()=>{const paths:string[]=[];for(const name of await caches.keys())for(const request of await(await caches.open(name)).keys())paths.push(new URL(request.url).pathname);return paths;});
  assert(!cached.some((value:string)=>value.startsWith('/api/')),'location API not cached');assert(cached.some((value:string)=>/maplibre-gl-worker.*\.js$/.test(value)),'new static worker works through active PWA cache');await installed.close();console.log('PASS active PWA map/worker and private location API cache exclusion');
 }
 const unchanged=(await f.db.query('SELECT ST_AsEWKB(boundary) AS geometry FROM company_locations WHERE id=$1',[location.id])).rows[0];assert(original.geometry.equals(unchanged.geometry),'map interactions do not change authoritative PostGIS geometry');
 await writeFile(path.join(artifacts,phase+'-measurements.json'),JSON.stringify({version,measurements},null,2));
 console.log('PASS production CSP, GeoJSON/source updates, attribution, WebGL2, map controls, geolocation, geometry integrity, tenant/permission boundaries and map worker disposal');
} finally {await f.cleanup();if(!externalArtifacts)await rm(artifacts,{recursive:true,force:true});}
