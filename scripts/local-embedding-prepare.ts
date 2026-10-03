import './router-env';
import {LocalEmbeddingProvider} from '../src/server/intelligent-router/local-embedding';
if(process.env.NODE_ENV==='production')throw Error('Prepare the local model cache before production deployment');
const p=new LocalEmbeddingProvider({download:true});
try{const vectors=await p.embedBatch(['show my payslip','رصيد اجازاتي كام']);console.log({ready:true,model:p.model,version:p.version,dimensions:vectors[0].length,runtime:p.runtime});}finally{await p.close();}
