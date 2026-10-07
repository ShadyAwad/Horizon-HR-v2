import './router-env';import {createEmbedding,routerConfig} from '../src/server/intelligent-router/config';
const p=createEmbedding(routerConfig());if(!p)throw Error('Embedding provider required');
const texts=['when is payday','when do we get paid','what date is salary paid','when is the next payday','show my last payslip','how much salary did I receive','what is my leave balance'];
try{const vectors=[];for(const t of texts)vectors.push(await p.embed(t));const rows=texts.slice(1).map((text,i)=>({a:texts[0],b:text,cosine:vectors[0].reduce((n,v,j)=>n+v*vectors[i+1][j],0)}));console.log(JSON.stringify({model:p.model,revision:p.version,dimensions:p.dimensions,pairs:rows}));}finally{await p.close?.();}
