import { requestContext } from '../../lib/request-context';
const codes=new Set(['OPENAI_STORE_UNAVAILABLE','OPENAI_STORE_BUSY','OPENAI_AUTH_UNAVAILABLE','OPENAI_SESSION_REQUIRED']);
/** Bounded, process-local warning throttle; never includes queries or credential data. */
export class ReasoningStatusDiagnostics {
  private last?:{code:string;at:number};
  constructor(private readonly emit:(value:string)=>void=value=>console.warn(value),private readonly now=Date.now){}
  recovered(){this.last=undefined;}
  unavailable(code:string){
    if(!codes.has(code))return;
    const at=this.now();
    if(this.last?.code===code && at-this.last.at<60_000)return;
    this.last={code,at};
    this.emit(JSON.stringify({level:'warn',operation:'[Router reasoning status]',stage:'reasoning_authorization',code,state:'authorization_unavailable',requestId:requestContext.getStore()?.requestId}));
  }
}
