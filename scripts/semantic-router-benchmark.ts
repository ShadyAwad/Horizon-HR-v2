/** Development only. All corpus and indexes are transaction-scoped temporary objects. */
import 'dotenv/config';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
if(process.env.NODE_ENV==='production')throw Error('ANN benchmarking is development-only');
if(!process.env.DATABASE_URL)throw Error('ANN benchmark requires a development DATABASE_URL with pgvector installed');
const pool=new Pool({connectionString:process.env.DATABASE_URL}),c=await pool.connect();
const dimensions=16, count=1200, k=10;
const vector=(n:number)=>Array.from({length:dimensions},(_,i)=>Math.sin((n+1)*(i+7)*1.31)+Math.cos((n+3)*(i+1)*.71));
const queries=Array.from({length:40},(_,i)=>JSON.stringify(vector(i*23+19)));
const percentile=(v:number[],p:number)=>[...v].sort((a,b)=>a-b)[Math.min(v.length-1,Math.ceil(v.length*p)-1)];
try{
  await c.query('BEGIN');
  assert((await c.query("SELECT 1 FROM pg_extension WHERE extname='vector'")).rowCount,'Install pgvector through migrations first');
  await c.query('CREATE TEMP TABLE router_ann_fixture(id integer PRIMARY KEY,tenant_id integer,embedding vector(16)) ON COMMIT DROP');
  for(let offset=0;offset<count;offset+=100){const params:unknown[]=[];const rows=Array.from({length:Math.min(100,count-offset)},(_,j)=>{const n=offset+j;params.push(n,n%5===0?null:n%7===0?1:2,JSON.stringify(vector(n)));return `($${j*3+1},$${j*3+2},$${j*3+3}::vector)`;});await c.query('INSERT INTO router_ann_fixture VALUES '+rows.join(','),params);}
  await c.query('ANALYZE router_ann_fixture');
  const filters={global:'TRUE',tenant:'tenant_id=1',merged:'(tenant_id IS NULL OR tenant_id=1)',split:'split'};
  const querySql=(filter:string)=>filter==='split'?`WITH system_hits AS (SELECT id,embedding <=> $1::vector AS distance FROM router_ann_fixture WHERE tenant_id IS NULL ORDER BY embedding <=> $1::vector LIMIT $2),tenant_hits AS (SELECT id,embedding <=> $1::vector AS distance FROM router_ann_fixture WHERE tenant_id=1 ORDER BY embedding <=> $1::vector LIMIT $2) SELECT id FROM (SELECT * FROM system_hits UNION ALL SELECT * FROM tenant_hits) h ORDER BY distance LIMIT $2`:`SELECT id FROM router_ann_fixture WHERE ${filter} ORDER BY embedding <=> $1::vector LIMIT $2`;
  const sample=async(filter:string)=>{const ids:number[][]=[],latencies:number[]=[];for(const q of queries){const start=performance.now();const r=await c.query(querySql(filter),[q,k]);latencies.push(performance.now()-start);ids.push(r.rows.map(r=>r.id));}return {ids,latencies};};
  await c.query('SET LOCAL enable_indexscan=off');await c.query('SET LOCAL enable_bitmapscan=off');
  const baseline:Record<string,Awaited<ReturnType<typeof sample>>>={};
  for(const [key,filter] of Object.entries(filters))baseline[key]=await sample(filter);
  const reports:object[]=[];
  for(const [key,b] of Object.entries(baseline))reports.push({strategy:'exact',filter:key,rows:count,buildMs:0,indexBytes:0,p50Ms:percentile(b.latencies,.5),p95Ms:percentile(b.latencies,.95),recallAtK:1});
  await c.query('SET LOCAL enable_indexscan=on');await c.query('SET LOCAL enable_bitmapscan=on');await c.query('SET LOCAL enable_seqscan=off');
  for(const strategy of ['hnsw','ivfflat'] as const){
    const start=performance.now();const lists=32;
    await c.query(`CREATE INDEX router_ann_eval ON router_ann_fixture USING ${strategy}(embedding vector_cosine_ops) WITH (${strategy==='hnsw'?'m=16,ef_construction=64':`lists=${lists}`})`);
    const buildMs=performance.now()-start,indexBytes=Number((await c.query("SELECT pg_relation_size('pg_temp.router_ann_eval') AS size")).rows[0].size);
    for(const tuning of strategy==='hnsw'?[40,100]:[1,8,32]){
      await c.query(`SET LOCAL ${strategy==='hnsw'?'hnsw.ef_search':'ivfflat.probes'}=${tuning}`);
      for(const [key,filter] of Object.entries(filters)){
        const plan=(await c.query('EXPLAIN '+querySql(filter),[queries[0],k])).rows.map(r=>r['QUERY PLAN']).join(' ');
        assert(plan.includes('router_ann_eval'),'Planner did not use benchmark ANN index');
        const measured=await sample(filter);let total=0,found=0;
        measured.ids.forEach((ids,i)=>{total+=baseline[key].ids[i].length;found+=ids.filter(id=>baseline[key].ids[i].includes(id)).length;});
        reports.push({strategy,filter:key,rows:count,lists:strategy==='ivfflat'?lists:'',probes:strategy==='ivfflat'?tuning:'',efSearch:strategy==='hnsw'?tuning:'',buildMs,indexBytes,p50Ms:percentile(measured.latencies,.5),p95Ms:percentile(measured.latencies,.95),recallAtK:found/total});
      }
    }
    await c.query('DROP INDEX pg_temp.router_ann_eval');
  }
  console.table(reports);
  console.log('Synthetic fixture only. Tenant, merged and deliberately split system/tenant searches are compared. Production remains exact; no indexes persist.');
}finally{await c.query('ROLLBACK');c.release();await pool.end();}
