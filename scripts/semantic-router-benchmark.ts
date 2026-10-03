/** Temporary indexes only, using the real local-model corpus with reproducible fixture tenant allocation. */
import './router-env';
import assert from 'node:assert/strict';
import {getMigrationPool} from './migration-pool';
import {routerConfig} from '../src/server/intelligent-router/config';
if(process.env.NODE_ENV==='production')throw Error('Development-only benchmark');
const settings=routerConfig();if(settings.embeddingProvider!=='local')throw Error('Local corpus required');
const pool=getMigrationPool(),c=await pool.connect();
const k=10,percentile=(v:number[],p:number)=>[...v].sort((a,b)=>a-b)[Math.ceil(v.length*p)-1];
try{
 await c.query('BEGIN');
 await c.query('CREATE TEMP TABLE router_ann_fixture(id integer PRIMARY KEY,tenant_id integer,embedding vector('+settings.dimensions+')) ON COMMIT DROP');
 await c.query("WITH corpus AS (SELECT row_number() OVER(ORDER BY id)::int id,embedding FROM router_semantic_examples WHERE approval_state='approved' AND embedding_model=$1 AND embedding_dimensions=$2 AND embedding_version=$3) INSERT INTO router_ann_fixture SELECT id,CASE WHEN id%5=0 THEN 1 WHEN id%7=0 THEN 2 ELSE NULL END,embedding FROM corpus",[settings.embeddingModel,settings.dimensions,settings.version]);
 const count=Number((await c.query('SELECT count(*) n FROM router_ann_fixture')).rows[0].n);assert(count>=100,'Seed the actual corpus first');
 const queries=(await c.query('SELECT embedding::text vector FROM router_ann_fixture ORDER BY id LIMIT 40')).rows.map(r=>r.vector);
 await c.query('ANALYZE router_ann_fixture');
 const filters={all:'TRUE',tenant:'tenant_id=1',merged:'(tenant_id IS NULL OR tenant_id=1)',split:'split'};
 const sql=(filter:string)=>filter==='split'?`WITH s AS (SELECT id,embedding <=> $1::vector distance FROM router_ann_fixture WHERE tenant_id IS NULL ORDER BY embedding <=> $1::vector LIMIT $2),t AS (SELECT id,embedding <=> $1::vector distance FROM router_ann_fixture WHERE tenant_id=1 ORDER BY embedding <=> $1::vector LIMIT $2) SELECT id FROM (SELECT * FROM s UNION ALL SELECT * FROM t) h ORDER BY distance LIMIT $2`:`SELECT id FROM router_ann_fixture WHERE ${filter} ORDER BY embedding <=> $1::vector LIMIT $2`;
 const sample=async(filter:string)=>{const ids:number[][]=[],times:number[]=[];for(const q of queries){const t=performance.now();const r=await c.query(sql(filter),[q,k]);times.push(performance.now()-t);ids.push(r.rows.map(r=>r.id));}return {ids,times};};
 await c.query('SET LOCAL enable_indexscan=off');await c.query('SET LOCAL enable_bitmapscan=off');
 const baseline:Record<string,Awaited<ReturnType<typeof sample>>>={},reports:object[]=[];
 for(const [name,filter] of Object.entries(filters)){baseline[name]=await sample(filter);reports.push({strategy:'exact',filter:name,rows:count,buildMs:0,indexBytes:0,p50Ms:percentile(baseline[name].times,.5),p95Ms:percentile(baseline[name].times,.95),recallAtK:1});}
 await c.query('SET LOCAL enable_indexscan=on');await c.query('SET LOCAL enable_bitmapscan=on');await c.query('SET LOCAL enable_seqscan=off');
 for(const strategy of ['hnsw','ivfflat']){
  const lists=Math.max(4,Math.floor(Math.sqrt(count))),start=performance.now();
  await c.query(`CREATE INDEX router_ann_eval ON router_ann_fixture USING ${strategy}(embedding vector_cosine_ops) WITH (${strategy==='hnsw'?'m=16,ef_construction=64':'lists='+lists})`);
  const buildMs=performance.now()-start,indexBytes=Number((await c.query("SELECT pg_relation_size('pg_temp.router_ann_eval') size")).rows[0].size);
  for(const tuning of strategy==='hnsw'?[40,100]:[1,Math.min(8,lists),lists]){
   await c.query(`SET LOCAL ${strategy==='hnsw'?'hnsw.ef_search':'ivfflat.probes'}=${tuning}`);
   for(const [name,filter] of Object.entries(filters)){
    const plan=(await c.query('EXPLAIN '+sql(filter),[queries[0],k])).rows.map(r=>r['QUERY PLAN']).join(' ');
    const annUsed=plan.includes('router_ann_eval');
    if(strategy==='hnsw'||tuning<lists)assert(annUsed,'Expected ANN benchmark index');
    const measured=await sample(filter);let total=0,found=0;
    measured.ids.forEach((ids,i)=>{total+=baseline[name].ids[i].length;found+=ids.filter(id=>baseline[name].ids[i].includes(id)).length;});
    reports.push({strategy,filter:name,rows:count,tuning,annUsed,buildMs,indexBytes,p50Ms:percentile(measured.times,.5),p95Ms:percentile(measured.times,.95),recallAtK:found/total});
   }
  }
  await c.query('DROP INDEX pg_temp.router_ann_eval');
 }
 console.table(reports);console.log('Real local vectors; fixture tenant allocation. No persistent indexes. Exact remains default.');
}finally{await c.query('ROLLBACK');c.release();await pool.end();}
