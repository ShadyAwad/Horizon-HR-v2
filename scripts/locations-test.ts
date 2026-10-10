import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile('src/db/migrations/20260728_add_company_location_management.sql', 'utf8');
const routes = await readFile('src/server/locations/location-routes.ts', 'utf8');
const panel = await readFile('src/components/locations/LocationsPanel.tsx', 'utf8');
const registry = await readFile('src/server/organisation/permission-registry.ts', 'utf8');
const dashboard = await readFile('src/pages/Dashboard.tsx', 'utf8');
const css = await readFile('src/index.css', 'utf8');

assert.match(migration, /ADD COLUMN IF NOT EXISTS code/);
assert.match(migration, /archived_at/);
assert.match(migration, /company_locations_created_by_tenant_fk/);
assert.match(migration, /company_locations_active_name_unique/);
assert.match(migration, /company_locations_active_code_unique/);
assert.match(migration, /'locations\.view'/);
assert.match(migration, /'geofences\.manage'/);
assert.match(routes, /\/api\/hr\/locations/);
assert.match(routes, /locations\.manage/);
assert.match(routes, /geofences\.manage/);
assert.match(routes, /ST_SetSRID\(ST_MakePoint\(\$7::double precision,\$6::double precision\),4326\)/);
assert.match(routes, /latitude=\$7::numeric,longitude=\$8::numeric,radius_meters=\$9::integer/);
assert.match(routes, /Latitude must be between -90 and 90/);
assert.match(routes, /Longitude must be between -180 and 180/);
assert.match(routes, /Radius must be between 25 and 5000/);
assert.match(routes, /FOR UPDATE/);
assert.match(routes, /Location is still in active use/);
assert.match(routes, /tenant_id=\$1/);
assert.match(routes, /location\.archived/);
assert.match(routes, /location\.restored/);
assert.match(registry, /geofences\.manage/);
assert.match(panel, /MapPreview/);
assert.match(panel, /Use my current location/);
assert.match(panel, /data-location-preview-empty/);
assert.match(panel, /enableHighAccuracy: true/);
assert.match(panel, /position\.coords\.latitude/);
assert.match(panel, /position\.coords\.longitude/);
assert.match(panel, /Latitude/);
assert.match(panel, /dir=\{isRtl/);
assert.match(panel, /data-location-modal/);
assert.match(panel, /data-location-type-select/);
assert.match(panel, /Location type/);
assert.match(panel, /نوع الموقع/);
assert.match(panel, /stanza-select relative z-10 touch-manipulation pointer-events-auto/);
assert.match(panel, /relative z-0 mt-3 h-44 isolate/);
assert.match(panel, /sm:h-56/);
assert.match(panel, /z-\[90\]/);
assert.match(panel, /safe-area-inset-top/);
assert.match(panel, /safe-area-inset-bottom/);
assert.match(panel, /document\.body\.style\.overflow = 'hidden'/);
assert.match(panel, /min-h-0 overflow-y-auto overscroll-contain/);
assert.match(panel, /focus\(\{ preventScroll: true \}\)/);
assert.match(panel, /locationType: event\.target\.value/);
assert.match(panel, /JSON\.stringify\(\{[\s\S]*\.\.\.form/);
assert.doesNotMatch(panel, /departmentId|department_id/, 'the Location form must not invent a department relationship');
assert.doesNotMatch(routes, /departmentId|department_id/, 'the Location API remains limited to its real model');
assert.match(dashboard, /stanza-dashboard h-screen/);
assert.match(css, /\.stanza-dashboard select/);
assert.match(css, /--stanza-menu-bg/);
assert.match(css, /padding-inline-end/);
console.log('Location management and mobile form contracts passed: 45');


// Opt-in real API/database regression using owned fixtures, never demo records.
// Run: npm run test:locations -- --integration.
if (process.argv.includes('--integration')) {
  await import('./router-env');
  const { assertDatabaseMutationSafety, assertHttpMutationSafety } = await import('./mutation-safety');
  const { getMigrationPool } = await import('./migration-pool');
  const { withTenant, getDbPool, closeHrResources } = await import('../src/lib/background-connections');
  const { createRequire } = await import('node:module');
  const { randomUUID, randomBytes } = await import('node:crypto');
  const { default: bcrypt } = await import('bcryptjs');
  const base = assertHttpMutationSafety(process.env.BROWSER_BASE_URL || 'http://localhost:3001', 'Location integration');
  assertDatabaseMutationSafety(process.env.DATABASE_URL, 'Location integration');
  const { chromium } = createRequire(import.meta.url)(process.env.BROWSER_PLAYWRIGHT_MODULE || 'playwright');
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const db = getMigrationPool(), tag = randomUUID(), password = randomBytes(24).toString('base64url');
  const tenants: string[] = [];
  try {
    async function tenant(label: string) {
      const id = (await db.query('INSERT INTO tenants(slug,company_name) VALUES($1,$2) RETURNING id', ['location-regression-'+label+'-'+tag, 'Location regression fixture'])).rows[0].id;
      tenants.push(id); return id;
    }
    const primary = await tenant('primary'), foreign = await tenant('foreign');
    const all = (await db.query('SELECT permission_key FROM tenant_permissions')).rows.map(row => row.permission_key);
    async function actor(tenantId: string, name: string, keys: string[]) {
      const email = 'location-'+name+'-'+tag+'@example.invalid';
      const id = (await db.query("INSERT INTO employees(tenant_id,full_name,email,password_hash,role) VALUES($1,$2,$3,$4,'employee') RETURNING id", [tenantId, 'Location fixture '+name, email, await bcrypt.hash(password, 10)])).rows[0].id;
      const roleId = (await db.query('INSERT INTO tenant_roles(tenant_id,name,is_system) VALUES($1,$2,false) RETURNING id', [tenantId,name])).rows[0].id;
      for (const key of keys) await db.query('INSERT INTO tenant_role_permissions(tenant_id,role_id,permission_key) VALUES($1,$2,$3)', [tenantId,roleId,key]);
      await db.query("INSERT INTO employee_role_assignments(tenant_id,employee_id,role_id,scope_type) VALUES($1,$2,$3,'company')", [tenantId,id,roleId]);
      const context = await browser.newContext({ viewport: { width:1440, height:1000 } });
      await context.addInitScript(() => {
        localStorage.setItem('stanza.preferences.v1',JSON.stringify({tutorialsAutoStart:false,lanyardEnabled:false}));
        localStorage.setItem('horizon-language','en'); localStorage.setItem('stanza-demo-notice-seen','true');
      });
      assert.equal((await context.request.post(base+'/api/auth/login',{headers:{Origin:base},data:{email,password}})).status(),200);
      return { id, context };
    }
    const admin = await actor(primary,'admin',all), reader = await actor(primary,'reader',['locations.view']);
    const outsider = await actor(foreign,'foreign',all);
    const payload = { name:'Regression Cairo worksite',code:'CREATE',latitude:30.0444,longitude:31.2357,radius:300,locationType:'branch' };
    async function request(path: string, data?: unknown, method = data ? 'POST' : 'GET', context = admin.context) {
      const response = await context.request.fetch(base+path,{method,headers:{Origin:base},...(data ? {data} : {})});
      return { status:response.status(), body:await response.json(), requestId:response.headers()['x-request-id'] };
    }
    const first = await request('/api/hr/locations',payload);
    console.log('POST /api/hr/locations',JSON.stringify({expected:201,actual:first.status,requestId:first.requestId,shape:Object.keys(payload)}));
    assert.equal(first.status,201); assert.equal(first.body.success,true);
    const location = first.body.location;
    assert.equal(location.latitude,payload.latitude); assert.equal(location.longitude,payload.longitude);
    assert.equal(location.radius,300); assert.equal(location.locationType,'branch'); assert.equal(location.isActive,true);
    assert(!('boundary' in location)); assert(!('tenant_id' in location));
    const row = await withTenant(primary,async client => (await client.query('SELECT tenant_id,created_by,ST_SRID(boundary) AS srid,GeometryType(boundary) AS type,ST_IsValid(boundary) AS valid,ST_DWithin(boundary::geography,ST_SetSRID(ST_MakePoint($2,$3),4326)::geography,1) AS contains_center FROM company_locations WHERE id=$1',[location.id,payload.longitude,payload.latitude])).rows[0]);
    assert.equal(row.tenant_id,primary); assert.equal(row.created_by,admin.id); assert.equal(row.srid,4326); assert.equal(row.type,'POLYGON'); assert.equal(row.valid,true); assert.equal(row.contains_center,true);
    assert.equal((await request('/api/hr/locations',payload)).status,409);
    for (const invalid of [{latitude:30,longitude:31,radius:300},{...payload,name:''},{...payload,latitude:true},{...payload,latitude:[]},{...payload,latitude:'bad'},{...payload,latitude:null},{...payload,longitude:''},{...payload,latitude:91},{...payload,radius:0},{...payload,locationType:'invalid'}]) assert.equal((await request('/api/hr/locations',invalid)).status,400);
    assert.equal((await request('/api/hr/locations',{...payload,name:'Denied'},'POST',reader.context)).status,403);
    assert.equal((await request('/api/hr/locations/'+location.id,undefined,'GET',outsider.context)).status,404);
    assert.equal((await request('/api/hr/locations/'+location.id,{name:'Foreign edit'},'PATCH',outsider.context)).status,404);
    assert.equal((await request('/api/hr/locations',undefined,'GET',outsider.context)).body.total,0);
    const anonymous = await browser.newContext();
    assert.equal((await request('/api/hr/locations',payload,'POST',anonymous)).status,401); await anonymous.close();
    // Client-supplied tenant/creator fields are not relationships in this API;
    // existing semantics select both from the authenticated session.
    const spoof = await request('/api/hr/locations',{...payload,name:'Session-owned',code:'SESSION',tenantId:foreign,createdBy:outsider.id});
    assert.equal(spoof.status,201);
    const owner = (await db.query('SELECT tenant_id,created_by FROM company_locations WHERE id=$1',[spoof.body.location.id])).rows[0];
    assert.equal(owner.tenant_id,primary); assert.equal(owner.created_by,admin.id);
    const insertSql = "INSERT INTO company_locations(tenant_id,name,latitude,longitude,radius_meters,boundary,created_by) VALUES($1,'Denied relationship',30,31,300,ST_Buffer(ST_SetSRID(ST_MakePoint(31,30),4326)::geography,300)::geometry,$2)";
    await assert.rejects(withTenant(primary,client=>client.query(insertSql,[foreign,outsider.id])),{code:'42501'});
    await assert.rejects(withTenant(primary,client=>client.query(insertSql,[primary,outsider.id])),{code:'23503'});
    await assert.rejects(withTenant('',client=>client.query(insertSql,[primary,admin.id])),{code:'42501'});
    assert.equal((await withTenant(foreign,client=>client.query('SELECT id FROM company_locations WHERE id=$1',[location.id]))).rowCount,0);
    assert.equal((await withTenant('',client=>client.query('SELECT id FROM company_locations'))).rowCount,0);
    const runtime = (await getDbPool().query('SELECT current_user,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];
    assert.equal(runtime.rolsuper,false); assert.equal(runtime.rolbypassrls,false);
    assert.equal((await request('/api/hr/locations/'+location.id,{latitude:30.05,longitude:31.24,radius:350},'PATCH')).status,200);
    const audit = (await db.query("SELECT action,actor_employee_id,metadata FROM audit_logs WHERE tenant_id=$1 AND entity_id=$2 ORDER BY created_at",[primary,location.id])).rows;
    assert.deepEqual(audit.map(row=>row.action),['location.created','location.updated']);
    assert.equal(audit[0].actor_employee_id,admin.id); assert.equal(audit[0].metadata.locationId,location.id);
    assert.equal(Number((await db.query("SELECT count(*) FROM audit_logs WHERE tenant_id=$1 AND action='location.created'",[primary])).rows[0].count),2,'invalid and denied creates produce neither rows nor audit events');
    const page = await admin.context.newPage(); const errors: string[] = [], failedApi: string[] = [];
    page.on('pageerror',(error:Error)=>errors.push(error.message));
    page.on('console',(message:any)=>{if(message.type()==='error') errors.push(message.text());});
    page.on('response',(response:any)=>{if(response.url().startsWith(base+'/api/')&&response.status()>=500)failedApi.push(new URL(response.url()).pathname);});
    await page.goto(base);
    async function navigate() { await page.locator('[data-tutorial-target=stanza-launcher]').click(); await page.locator('#stanza-navigation-panel .stanza-navigation-item').filter({hasText:'Locations'}).last().click(); }
    await navigate(); await page.getByRole('button',{name:'Create location',exact:true}).click();
    const dialog = page.getByRole('dialog',{name:'Create location',exact:true});
    await dialog.getByLabel('Name',{exact:true}).fill('Browser regression location');
    await dialog.getByLabel('Latitude',{exact:true}).fill('30.0444'); await dialog.getByLabel('Longitude',{exact:true}).fill('31.2357');
    let submissions = 0; page.on('request',(req:any)=>{if(req.method()==='POST'&&new URL(req.url()).pathname==='/api/hr/locations')submissions++;});
    const saved = page.waitForResponse((res:any)=>new URL(res.url()).pathname==='/api/hr/locations'&&res.request().method()==='POST');
    await dialog.getByRole('button',{name:'Save location',exact:true}).click(); assert.equal((await saved).status(),201);
    await dialog.waitFor({state:'detached'}); await page.getByRole('heading',{name:'Browser regression location',exact:true}).waitFor(); assert.equal(submissions,1);
    await page.reload(); await navigate(); await page.getByRole('heading',{name:'Browser regression location',exact:true}).waitFor();
    assert.deepEqual(failedApi,[]); assert.deepEqual(errors,[]);
    console.log('PASS real create/update/projection/PostGIS/audit/400/409/401/403/404/runtime RLS/foreign FK/browser single submission/reload');
  } finally {
    await browser.close();
    for (const tenantId of tenants) {
      assert.equal((await db.query("SELECT id FROM tenants WHERE id=$1 AND slug LIKE 'location-regression-%'",[tenantId])).rowCount,1);
      await db.query('DELETE FROM company_locations WHERE tenant_id=$1',[tenantId]);
      await db.query('DELETE FROM tenants WHERE id=$1',[tenantId]);
    }
    assert.equal((await db.query("SELECT count(*)::int AS count FROM tenants WHERE slug LIKE $1",['location-regression-%'+tag])).rows[0].count,0);
    await db.end(); await closeHrResources(); console.log('PASS owned fixture cleanup');
  }
}
