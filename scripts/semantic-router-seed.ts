import './router-env';
import {INTENTS,normalizeQuery} from '../src/lib/intelligent-router';
import {INTENT_EXAMPLES} from '../src/lib/router-examples';
import {createEmbedding,routerConfig} from '../src/server/intelligent-router/config';
import {getMigrationPool as getDbPool, migrationUrl} from './migration-pool';
export function approvedCorpus(){
 const unique=new Map<string,{intent:string;phrase:string;text:string}>();
 for(const intent of INTENTS)for(const phrase of [...intent.aliases,...(INTENT_EXAMPLES[intent.key]??[])]){
  const text=normalizeQuery(phrase),old=unique.get(text);
  if(old&&old.intent!==intent.key)throw Error('CONTRADICTORY_SYSTEM_EXAMPLE');
  unique.set(text,{intent:intent.key,phrase,text});
 }
 return [...unique.values()];
}
const provider=createEmbedding(routerConfig());
if(!provider)throw Error('Configure the embedding provider before seeding');
if(process.env.STANZA_ROUTER_SEED_SYSTEM!=='true')throw Error('System corpus provisioning requires STANZA_ROUTER_SEED_SYSTEM=true and a database migration administrator');
const pool=getDbPool();
try{
 const privilege=(await pool.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];
 if(!privilege?.rolsuper&&!privilege?.rolbypassrls)throw Error('Only a migration administrator may provision shared system examples');
 const corpus=approvedCorpus(),existing=new Set((await pool.query('SELECT normalized_text FROM router_semantic_examples WHERE tenant_id IS NULL AND embedding_model=$1 AND embedding_dimensions=$2 AND embedding_version=$3',[provider.model,provider.dimensions,provider.version])).rows.map(r=>r.normalized_text));
 const pending=corpus.filter(row=>!existing.has(row.text));let inserted=0;
 for(let offset=0;offset<pending.length;offset+=8){
  const batch=pending.slice(offset,offset+8),vectors=provider.embedBatch?await provider.embedBatch(batch.map(r=>r.text)):await Promise.all(batch.map(r=>provider.embed(r.text)));
  for(let i=0;i<batch.length;i++)inserted+=(await pool.query("INSERT INTO router_semantic_examples(intent_key,example_text,normalized_text,embedding,embedding_model,embedding_dimensions,embedding_version,source,approval_state) VALUES($1,$2,$3,$4::vector,$5,$6,$7,'system','approved') ON CONFLICT DO NOTHING",[batch[i].intent,batch[i].phrase,batch[i].text,JSON.stringify(vectors[i]),provider.model,provider.dimensions,provider.version])).rowCount??0;
 }
 console.log({inserted,expectedExamples:corpus.length,intents:INTENTS.length,model:provider.model,dimensions:provider.dimensions,version:provider.version});
}finally{await provider.close?.();await pool.end();}
