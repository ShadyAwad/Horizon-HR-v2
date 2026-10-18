import './router-env';
import {getMigrationPool,migrationUrl} from './migration-pool';
import {assertDatabaseMutationSafety} from './mutation-safety';
import {identifyDemo,context,DEMO_SLUG} from './demo/core';
import {seedDemoTenantAdmin} from './demo/admin-persona';
if(process.env.STANZA_DEMO_ENV!=='true'||process.env.ALLOW_DEMO_DATA_MUTATION!=='true')throw Error('Explicit demo mutation flags required');
assertDatabaseMutationSafety(migrationUrl(),'Demo Admin provisioning',true,true);
const pool=getMigrationPool(),client=await pool.connect();
try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['demo-seed:'+DEMO_SLUG]);const t=await identifyDemo(client);if(!t||t.id!==process.env.DEMO_TENANT_ID)throw Error('Exact existing DEMO_TENANT_ID required');await client.query("SELECT set_config('app.current_tenant',$1,true)",[t.id]);await seedDemoTenantAdmin(context(client,t,'required'));await client.query('COMMIT');console.log('PASS Full Demo tenant role provisioned idempotently; other accounts and curated data preserved');}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();await pool.end();}
