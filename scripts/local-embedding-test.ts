import './router-env';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {LocalEmbeddingProvider,LOCAL_DIMENSIONS} from '../src/server/intelligent-router/local-embedding';
import {createEmbedding,routerConfig} from '../src/server/intelligent-router/config';
const settings=routerConfig({STANZA_ROUTER_EMBEDDING_KEY:'fixture-ignored',STANZA_ROUTER_EMBEDDING_MODEL:'old-openai-model',STANZA_ROUTER_EMBEDDING_DIMENSIONS:'1536'});
const p=createEmbedding(settings,{STANZA_ROUTER_EMBEDDING_KEY:'fixture-ignored'})!;
assert(p instanceof LocalEmbeddingProvider);assert.equal(settings.dimensions,384);assert.equal(p.dimensions,LOCAL_DIMENSIONS);
try{
 const texts=['My employee equipment','رصيد اجازاتي كام','عايز شيفتي بكره','my PTO balance كام'];
 const first=await p.embedBatch!(texts),second=await p.embedBatch!(texts);
 for(let i=0;i<first.length;i++){assert.equal(first[i].length,384);assert(first[i].every(Number.isFinite));assert(Math.abs(first[i].reduce((s,v)=>s+v*v,0)-1)<1e-4);assert(Math.max(...first[i].map((v,j)=>Math.abs(v-second[i][j])))<1e-5);}
 await assert.rejects(p.embed(''),/INVALID_EMBEDDING_INPUT/);await assert.rejects(p.embed('a'.repeat(501)),/INVALID_EMBEDDING_INPUT/);await assert.rejects(p.embedBatch!(Array(17).fill('test')),/INVALID_EMBEDDING_INPUT/);
 const missing=new LocalEmbeddingProvider({cache:'.cache/missing-router-test-'+randomUUID(),loadTimeoutMs:1});
 try{await assert.rejects(missing.embed('test'),/LOCAL_EMBEDDING_UNAVAILABLE/);assert.equal(missing.status(),'unavailable');}finally{await missing.close();}
 console.log('PASS actual offline local multilingual vectors, reproducibility, normalization, fixed model space, ignored external key, batch/input bounds and hard load timeout');
}finally{await p.close?.();}
