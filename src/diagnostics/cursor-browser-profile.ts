import {beginCursorProfile,finishCursorProfile} from '../lib/cursor-profile';
import {cursorSchedulingState} from '../lib/custom-cursor';
// Explicit local diagnostic. Observers, sampling RAF and timers stop after each bounded capture.
export function installCursorBrowserProfile(){
 if(new URLSearchParams(location.search).get('cursorProfile')!=='1')return;
 const panel=document.createElement('aside');panel.setAttribute('aria-label','Browser performance capture');panel.style.cssText='position:fixed;z-index:99999;right:12px;bottom:12px;max-width:460px;max-height:50vh;overflow:auto;padding:12px;background:#fff;color:#111;border:2px solid #666;font:12px monospace';
 const result=document.createElement('pre');result.style.whiteSpace='pre-wrap';result.setAttribute('role','status');
 let capturing=false;
 const add=(name:string,run:()=>void)=>{const b=document.createElement('button');b.textContent=name;b.style.cssText='margin:4px;padding:8px;border:1px solid #666';b.onclick=run;panel.append(b);};
 const capture=(phase:string,ms:number)=>{
  if(capturing)return;capturing=true;result.textContent='Capturing '+phase+' - '+ms+'ms';beginCursorProfile();
  const entries:PerformanceEntry[]=[],observers:PerformanceObserver[]=[];const supported=PerformanceObserver.supportedEntryTypes;
  for(const type of ['longtask','long-animation-frame'])if(supported.includes(type)){const o=new PerformanceObserver(list=>entries.push(...list.getEntries()));o.observe({type});observers.push(o);}
  const gaps:number[]=[],start=performance.now();let last=start,raf=0;
  const sample=(now:number)=>{gaps.push(now-last);last=now;if(now-start<ms)raf=requestAnimationFrame(sample);};raf=requestAnimationFrame(sample);
  window.setTimeout(()=>{
   cancelAnimationFrame(raf);for(const o of observers){entries.push(...o.takeRecords());o.disconnect();}
   const cursor=finishCursorProfile();const loaf=entries.filter(e=>e.entryType==='long-animation-frame') as Array<PerformanceEntry & {renderStart:number;scripts:Array<{duration:number}>}>;
   gaps.sort((a,b)=>a-b);const percentile=(p:number)=>gaps[Math.min(gaps.length-1,Math.floor(gaps.length*p))]??0;
   result.textContent=JSON.stringify({phase,elapsedMs:performance.now()-start,cursor,pending:cursorSchedulingState(),frameGapP50:percentile(.5),frameGapP95:percentile(.95),longTasks:entries.filter(e=>e.entryType==='longtask').length,longFrames:loaf.length,longFrameScriptMs:loaf.reduce((sum,e)=>sum+e.scripts.reduce((n,s)=>n+s.duration,0),0),longFrameRenderMs:loaf.reduce((sum,e)=>sum+(e.renderStart?e.startTime+e.duration-e.renderStart:0),0),reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches,supported,gpuTime:'Not exposed by Performance API'},null,2);capturing=false;
  },ms);
 };
 add('Measure foreground idle',()=>capture('foreground idle',2000));add('Measure pointer movement',()=>capture('pointer movement',4000));add('Measure after stopping',()=>capture('after stopping',2000));
 add('Startup request counts',()=>{const counts:Record<string,number>={};for(const entry of performance.getEntriesByType('resource')){const url=new URL(entry.name);if(url.pathname.startsWith('/api/'))counts[url.pathname]=(counts[url.pathname]??0)+1;}result.textContent=JSON.stringify(counts,null,2);});
 panel.append(result);document.body.append(panel);
}
