import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import sharp from 'sharp';
import {BusinessFixtures,type ScenarioActor} from './business-scenario-fixtures';
import {profileImageStorage} from '../src/lib/profile-image-storage';
import {companyFeedImageStorage} from '../src/lib/company-feed-image-storage';
import {QrTokenService} from '../src/server/qr/qr-token-service';
import {getHrQueue} from '../src/lib/hr-background';
const f=new BusinessFixtures(),probe=process.env.ORIGIN_CSRF_PROBE==='true',failures:string[]=[];
let alternate:ReturnType<typeof createServer>|undefined;
const foreign='https://foreign.example.invalid';
async function snapshot(){
 const state:Record<string,unknown>={};
 for(const table of ['assets','leave_requests','support_tickets','company_feed_posts','company_feed_images','communication_messages','audit_logs','outbox_events'])state[table]=(await f.db.query(`SELECT row_to_json(r) value FROM ${table} r WHERE tenant_id=$1 ORDER BY id`,[f.primary])).rows;
 state.profile=(await f.db.query('SELECT id,manager_id,profile_image_url,updated_at FROM employees WHERE tenant_id=$1 ORDER BY id',[f.primary])).rows;
 state.jobs=(await getHrQueue().getJobs(['wait','active','delayed','completed','failed'],0,-1)).filter(j=>j.data?.tenantId===f.primary).map(j=>j.id).sort();
 return JSON.stringify(state);
}
async function rejected(label:string,perform:()=>Promise<any>,expected=403){
 const before=await snapshot(),r=await perform(),after=await snapshot();
 const good=r.status()===expected&&before===after;
 console.log(`${good?'PASS':'FAIL'} ${label}: status=${r.status()}, unchanged=${before===after}`);
 if(!good)failures.push(label);
 if(!probe){assert.equal(r.status(),expected,label);assert.equal(after,before,label+' must not mutate, audit or enqueue');}
 if(r.status()>=400){const text=await r.text();assert(!/password_hash|DATABASE_URL|\bat \S+.*:\d+|C:\\Games/i.test(text),'safe rejection response');}
 return r;
}
const request=(actor:ScenarioActor,url:string,data:unknown,origin:string|null=f.base,method='POST',headers:Record<string,string>={})=>actor.context.request.fetch(f.base+url,{method,headers:{...(origin!==null?{Origin:origin}:{}),...headers},data});
try{
 await f.setup('origin-csrf');const {admin,employee}=f;
 const assetData={assetTag:'CSRF-'+f.tag,name:'Disposable origin fixture',category:'laptop'};
 await rejected('asset JSON foreign Origin',()=>request(admin,'/api/hr/assets',assetData,foreign));
 const asset=(await f.ok(admin,'/api/hr/assets',{...assetData,assetTag:'OWN-'+f.tag})).asset;
 const browserAsset=(await f.ok(admin,'/api/hr/assets',{...assetData,assetTag:'FORM-'+f.tag})).asset;
 alternate=createServer((_req,res)=>{res.setHeader('Content-Type','text/html');res.end(`<form action="${f.base}/api/hr/assets/${browserAsset.id}/retire" method="post"><button>Submit local fixture</button></form>`);});
 alternate.listen(0,'127.0.0.1');await once(alternate,'listening');const second='http://localhost:'+(alternate.address() as any).port;
 const page=await admin.context.newPage();await page.goto(second);
 await rejected('real same-site foreign-port browser form retirement',async()=>{const waiting=page.waitForResponse((r:any)=>new URL(r.url()).pathname.endsWith('/retire'));await page.getByRole('button',{name:'Submit local fixture'}).click();return waiting;});
 // The same bodyless action remains usable from Stanza's own origin.
 assert.equal((await request(admin,`/api/hr/assets/${asset.id}/retire`,{},f.base)).status(),200);
 await rejected('GET cannot invoke asset retirement',()=>admin.context.request.get(f.base+`/api/hr/assets/${browserAsset.id}/retire`,{headers:{Origin:foreign}}),404);
 // Production public issuance correctly requires HTTPS. Prepare the opaque fixture through
 // the existing service; the HTTP loopback production server only performs public resolution.
 const issued=process.env.ORIGIN_TEST_PRODUCTION==='true'
  ?{token:await new QrTokenService().issue({tenantId:f.primary,employeeId:admin.id},{purpose:'asset_lookup',assetId:browserAsset.id})}
  :await f.ok(admin,'/api/qr/tokens',{purpose:'asset_lookup',subjectId:browserAsset.id});
 const publicUrl=new URL(issued.token.encodedUrl);assert.equal(publicUrl.origin,f.base);
 const publicResult=await f.publicContext.request.get(publicUrl.href,{headers:{Origin:foreign}});assert.equal(publicResult.status(),200,'anonymous opaque asset lookup remains public');
 console.log('PASS anonymous opaque public asset lookup remains accessible without session or same-origin credentials');
 const leave={leaveType:'annual',startDate:'2031-05-02',endDate:'2031-05-03',reason:'Disposable origin fixture'};
 await rejected('leave JSON foreign Origin',()=>request(employee,'/api/me/leave-requests',leave,foreign));
 assert.equal((await request(employee,'/api/me/leave-requests',leave)).status(),201);
 const support={issueType:'it_help',urgency:'normal',summary:'Disposable origin fixture',description:'Local fixture only'};
 await rejected('Support JSON foreign Origin',()=>request(employee,'/api/support',support,foreign));
 assert.equal((await request(employee,'/api/support',support)).status(),201);
 const comm={subject:'Disposable origin fixture',body:'Local fixture only',category:'custom',recipientIds:[employee.id]};
 await rejected('Communications draft foreign Origin',()=>request(admin,'/api/communications/drafts',comm,foreign));
 assert.equal((await request(admin,'/api/communications/drafts',comm)).status(),200);
 const feed={title:'Disposable origin fixture',contentText:'Local fixture only',visibility:[{type:'all'}]};
 await rejected('feed publication foreign Origin',()=>request(admin,'/api/company-feed/posts',feed,foreign));
 const posted=await request(admin,'/api/company-feed/posts',{...feed,title:'Own '+f.tag});assert.equal(posted.status(),201);
 await posted.json();
 await rejected('employee reporting-line foreign Origin',()=>request(admin,`/api/hr/organisation/employees/${employee.id}/reporting-line`,{managerId:null},foreign,'PATCH'));
 assert.equal((await request(admin,`/api/hr/organisation/employees/${employee.id}/reporting-line`,{managerId:null},f.base,'PATCH')).status(),200);
 const png=await sharp({create:{width:32,height:32,channels:3,background:'#10b981'}}).png().toBuffer();
 for(const [actor,url,field] of [[employee,'/api/profile/avatar','avatar'],[admin,'/api/company-feed/images','image']] as const){
  const upload=(origin:string|undefined)=>actor.context.request.post(f.base+url,{headers:origin===undefined?{}:{Origin:origin},multipart:{[field]:{name:'owned.png',mimeType:'image/png',buffer:png}}});
  await rejected(url+' foreign multipart Origin',()=>upload(foreign));
  for(const origin of [f.base,undefined]){const r=await upload(origin);assert([200,201].includes(r.status()),url+' legitimate upload');}
 }
 for(const origin of [foreign,f.base.replace('localhost','localhost.malicious.invalid'),f.base.replace('http:','https:'),'http://localhost:1','null','not an origin',f.base+'/',f.base+'/path'])await rejected('Origin parsing '+origin,()=>request(admin,'/api/hr/assets',{...assetData,assetTag:'NEVER-'+f.tag},origin));
 await rejected('cross-site Fetch Metadata without Origin',()=>request(admin,'/api/hr/assets',assetData,null,'POST',{'Sec-Fetch-Site':'cross-site'}));
 const missing=await admin.context.request.post(f.base+'/api/hr/assets',{data:{...assetData,assetTag:'MISSING-'+f.tag}});assert.equal(missing.status(),201,'legitimate client without Origin');
 for(const type of ['application/x-www-form-urlencoded','text/plain','multipart/form-data'])for(const url of ['/api/hr/assets','/api/company-feed/posts','/api/me/leave-requests']){
  const actor=url.includes('leave')?employee:admin;
  await rejected(type+' foreign '+url,()=>request(actor,url,'fixture=local',foreign,'POST',{'Content-Type':type}));
  const r=await request(actor,url,'fixture=local',f.base,'POST',{'Content-Type':type});assert(r.status()>=400&&r.status()<500,'unsupported JSON content type produces controlled 4xx');
 }
 await rejected('foreign Origin logout',()=>request(employee,'/api/auth/logout',{},foreign));
 assert.equal((await f.api(employee,'/api/auth/sessions')).status,200);
 assert.equal((await request(employee,'/api/auth/logout',{})).status(),200);
 assert.equal((await f.api(employee,'/api/auth/sessions')).status,401);
 const cors=await admin.context.request.fetch(f.base+'/api/hr/assets',{method:'OPTIONS',headers:{Origin:foreign,'Access-Control-Request-Method':'POST'}});assert(!cors.headers()['access-control-allow-origin']);
 const allowed=await admin.context.request.fetch(f.base+'/api/hr/assets',{method:'OPTIONS',headers:{Origin:f.base,'Access-Control-Request-Method':'POST'}});assert.equal(allowed.headers()['access-control-allow-origin'],f.base);assert.equal(allowed.headers()['access-control-allow-credentials'],'true');
 const cookie=(await admin.context.cookies()).find((c:any)=>c.name==='stanza_session');assert(cookie.httpOnly);assert.equal(cookie.sameSite,'Lax');assert.equal(cookie.path,'/');assert(!cookie.domain.startsWith('.'));
 if(process.env.ORIGIN_TEST_PRODUCTION==='true'){
  const tls=await admin.context.request.post(f.base+'/api/auth/login',{headers:{Origin:f.base,'X-Forwarded-Proto':'https'},data:{email:admin.email,password:f.password}});assert.equal(tls.status(),200);const header=tls.headers()['set-cookie'];assert.match(header,/Secure/);assert.match(header,/HttpOnly/);assert.match(header,/SameSite=Lax/);assert(!/Domain=/i.test(header));
 }
 const finalAsset=(await f.db.query('SELECT status FROM assets WHERE tenant_id=$1 AND id=$2',[f.primary,browserAsset.id])).rows[0];if(!probe)assert.equal(finalAsset.status,'available');
 assert.deepEqual(failures,probe?failures:[]);
 console.log('PASS valid same-origin writes, absent-Origin API clients, bounded CORS, cookie flags and controlled content-type errors');
}finally{
 if(alternate)await new Promise<void>(r=>alternate!.close(()=>r()));
 for(const row of (await f.db.query('SELECT profile_image_url FROM employees WHERE tenant_id=ANY($1::uuid[]) AND profile_image_url IS NOT NULL',[f.tenants])).rows)await profileImageStorage.remove(row.profile_image_url);
 for(const row of (await f.db.query('SELECT storage_key FROM company_feed_images WHERE tenant_id=ANY($1::uuid[])',[f.tenants])).rows)await companyFeedImageStorage.remove(row.storage_key);
 await f.cleanup();
}
