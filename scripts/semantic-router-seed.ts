import 'dotenv/config';
import { INTENTS,normalizeQuery } from '../src/lib/intelligent-router';
import { createEmbedding,routerConfig } from '../src/server/intelligent-router/config';
import { getDbPool } from '../src/lib/hr-background';
const provider=createEmbedding(routerConfig());
if(!provider)throw Error('Set a server-side embedding provider key before seeding approved system aliases');
if(process.env.STANZA_ROUTER_SEED_SYSTEM!=='true')throw Error('System corpus provisioning requires STANZA_ROUTER_SEED_SYSTEM=true and a database migration administrator');
const pool=getDbPool(),c=await pool.connect();
try{
  const privilege=(await c.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];
  if(!privilege?.rolsuper&&!privilege?.rolbypassrls)throw Error('System corpus is writable only by a migration administrator; tenant APIs cannot insert global examples');
  let inserted=0;
  for(const intent of INTENTS)for(const phrase of intent.aliases){
    const text=normalizeQuery(phrase);
    if((await c.query('SELECT 1 FROM router_semantic_examples WHERE tenant_id IS NULL AND normalized_text=$1 AND embedding_model=$2 AND embedding_dimensions=$3 AND embedding_version=$4',[text,provider.model,provider.dimensions,provider.version])).rowCount)continue;
    const vector=await provider.embed(text);
    const r=await c.query(`INSERT INTO router_semantic_examples(intent_key,example_text,normalized_text,embedding,embedding_model,embedding_dimensions,embedding_version,source,approval_state) VALUES($1,$2,$3,$4::vector,$5,$6,$7,'system','approved') ON CONFLICT DO NOTHING`,[intent.key,phrase,text,JSON.stringify(vector),provider.model,provider.dimensions,provider.version]);inserted+=r.rowCount??0;
  }
  console.log('Approved system examples inserted:',inserted,'space:',provider.model,provider.dimensions,provider.version);
}finally{c.release();await pool.end();}
