import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { validateVector, type EmbeddingProvider } from './providers';
// Pinned ONNX weights; runtime is CPU-only and never downloads during requests.
export const LOCAL_MODEL = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';
export const LOCAL_REVISION = '2c4055b12046f11709e9df2c122e59ffbdc2f900';
export const LOCAL_DIMENSIONS = 384;
export const LOCAL_VERSION = LOCAL_REVISION + '-q8-mean-l2-128-v1';
const workerCode = `
const {parentPort,workerData}=require('node:worker_threads');
(async()=>{
  const {pipeline,env}=await import('@huggingface/transformers');
  env.allowRemoteModels=workerData.download; env.cacheDir=workerData.cache; env.backends.onnx.logLevel='error';
  const extractor=await pipeline('feature-extraction',workerData.model,{revision:workerData.revision,dtype:'q8',device:'cpu',local_files_only:!workerData.download,session_options:{intraOpNumThreads:2,interOpNumThreads:1}});
  parentPort.on('message',async({id,texts})=>{try{
    const output=await extractor(texts,{pooling:'mean',normalize:true,truncation:true,max_length:128});
    parentPort.postMessage({id,vectors:output.tolist()});
  }catch{parentPort.postMessage({id,error:true});}});
  parentPort.postMessage({ready:true});
})().catch(()=>parentPort.postMessage({failed:true}));
`;
/** A worker is an in-process CPU boundary, not another service. Hard deadlines terminate it. */
export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly model=LOCAL_MODEL; readonly dimensions=LOCAL_DIMENSIONS; readonly version=LOCAL_VERSION;
  readonly runtime='transformers.js-3.8.1/onnxruntime-node/cpu';
  private worker?:Worker; private loading?:Promise<void>; private sequence=0; private queue=Promise.resolve();
  private queued=0; private ready=false; private retryAt=0;
  constructor(private readonly options:{download?:boolean;cache?:string;timeoutMs?:number;loadTimeoutMs?:number}={}) {}
  status(){return this.ready?'ready':this.loading?'loading':Date.now()<this.retryAt?'unavailable':'not_loaded';}
  private async initialize() {
    if(this.ready)return;
    if(Date.now()<this.retryAt)throw Error('LOCAL_EMBEDDING_UNAVAILABLE');
    if(!this.loading)this.loading=new Promise<void>((resolve,reject)=>{
      const worker=this.worker=new Worker(workerCode,{eval:true,execArgv:[],workerData:{model:this.model,revision:LOCAL_REVISION,download:this.options.download===true,cache:path.resolve(this.options.cache||'.cache/stanza-embeddings')}});
      const timer=setTimeout(()=>fail(),this.options.loadTimeoutMs??(this.options.download?180_000:30_000));
      const fail=()=>{clearTimeout(timer);this.ready=false;this.retryAt=Date.now()+60_000;void worker.terminate();if(this.worker===worker)this.worker=undefined;reject(Error('LOCAL_EMBEDDING_UNAVAILABLE'));};
      worker.once('error',fail);worker.once('exit',()=>{this.ready=false;});
      worker.on('message',m=>{if(m.failed)fail();if(m.ready){clearTimeout(timer);this.ready=true;worker.unref();resolve();}});
    }).finally(()=>{this.loading=undefined;});
    return this.loading;
  }
  async embed(text:string){return (await this.embedBatch([text]))[0];}
  async embedBatch(texts:readonly string[]):Promise<number[][]> {
    if(!texts.length)return [];
    if(texts.length>16 || texts.some(t=>typeof t!=='string'||!t.trim()||t.length>500))throw Error('INVALID_EMBEDDING_INPUT');
    if(this.queued>=32)throw Error('LOCAL_EMBEDDING_BUSY');
    this.queued++;
    const task=this.queue.then(async()=>{
      await this.initialize(); const worker=this.worker!;const id=++this.sequence;worker.ref();
      return new Promise<number[][]>((resolve,reject)=>{
        const cleanup=()=>{clearTimeout(timer);worker.off('message',message);worker.off('error',fail);worker.off('exit',fail);worker.unref();};
        const fail=()=>{cleanup();reject(Error('LOCAL_EMBEDDING_UNAVAILABLE'));};
        const message=(m:{id?:number;vectors?:unknown[];error?:boolean})=>{if(m.id!==id)return;cleanup();try{if(m.error||!m.vectors||m.vectors.length!==texts.length)throw Error('INVALID_EMBEDDING');resolve(m.vectors.map(v=>validateVector(v,this.dimensions)));}catch{reject(Error('INVALID_EMBEDDING'));}};
        const timer=setTimeout(()=>{this.ready=false;this.worker=undefined;this.retryAt=Date.now()+60_000;void worker.terminate();fail();},this.options.timeoutMs??15_000);
        worker.on('message',message);worker.once('error',fail);worker.once('exit',fail);worker.postMessage({id,texts:[...texts]});
      });
    });
    this.queue=task.then(()=>{},()=>{});try{return await task;}finally{this.queued--;}
  }
  async close(){await this.queue;this.ready=false;await this.worker?.terminate();this.worker=undefined;}
}
