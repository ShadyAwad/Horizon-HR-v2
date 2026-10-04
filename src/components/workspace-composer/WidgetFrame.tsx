import { Suspense, useEffect, useRef, type PointerEvent, type ReactNode } from 'react';
import { useLanguage } from '../../lib/LanguageContext';
import { boundGeometry, type WidgetInstance, type Surface } from './workspace-model';
import type { WidgetDefinition } from './widget-catalog';
type Props={widget:WidgetInstance;definition:WidgetDefinition;editing:boolean;maximized:boolean;surface:Surface;allowed:boolean;children:ReactNode;onUpdate:(patch:Partial<WidgetInstance>)=>void;onMaximize:()=>void;onRemove:()=>void;onConfigure:()=>void;onOpen:()=>void};
export function WidgetFrame({widget,definition,editing,maximized,surface,allowed,children,onUpdate,onMaximize,onRemove,onConfigure,onOpen}:Props){
 const {isRtl}=useLanguage();const text=(en:string,ar:string)=>isRtl?ar:en;const ref=useRef<HTMLElement>(null);
 const gesture=useRef<{target:HTMLElement;pointer:number;startX:number;startY:number;step:number;scale:number;mode:'move'|'resize';next:WidgetInstance;cleanup:()=>void}|null>(null);
 const cancel=()=>{const g=gesture.current;if(!g)return;gesture.current=null;g.cleanup();if(g.target.hasPointerCapture(g.pointer))g.target.releasePointerCapture(g.pointer);const node=ref.current;if(node){node.style.removeProperty('transform');node.style.removeProperty('width');node.style.removeProperty('height');node.removeAttribute('data-dragging');}};
 useEffect(()=>cancel,[]);
 useEffect(()=>{cancel();},[editing,maximized,widget]);
 const begin=(event:PointerEvent<HTMLButtonElement>,mode:'move'|'resize')=>{
  if(gesture.current||!event.isPrimary||!editing||maximized||event.button!==0||!matchMedia('(min-width: 900px)').matches)return;
  const grid=ref.current!.parentElement!;const rect=grid.getBoundingClientRect();event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);
  const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();cancel();}};const hidden=()=>{if(document.hidden)cancel();};
  document.addEventListener('keydown',escape);document.addEventListener('visibilitychange',hidden);
  gesture.current={target:event.currentTarget,pointer:event.pointerId,startX:event.clientX,startY:event.clientY,step:(grid.clientWidth+12)/12,scale:rect.width/grid.clientWidth,mode,next:widget,cleanup:()=>{document.removeEventListener('keydown',escape);document.removeEventListener('visibilitychange',hidden);}};
  ref.current!.dataset.dragging='true';
 };
 const move=(event:PointerEvent<HTMLButtonElement>)=>{
  const g=gesture.current;if(!g||g.pointer!==event.pointerId)return;
  const dx=(event.clientX-g.startX)/g.scale,dy=(event.clientY-g.startY)/g.scale;
  const maxRow=Math.max(0,Math.floor(ref.current!.parentElement!.clientHeight/64)-widget.height);
  const next=boundGeometry(g.mode==='move'?{...widget,x:widget.x+Math.round(dx/g.step),y:Math.min(maxRow,widget.y+Math.round(dy/64))}:{...widget,width:Math.min(12-widget.x,widget.width+Math.round(dx/g.step)),height:widget.height+Math.round(dy/64)});
  g.next=next;
  if(g.mode==='move')ref.current!.style.transform=`translate(${(next.x-widget.x)*g.step}px, ${(next.y-widget.y)*64}px)`;
  else{ref.current!.style.width=`${next.width*g.step-12}px`;ref.current!.style.height=`${next.height*64-12}px`;}
 };
 const finish=(event:PointerEvent<HTMLButtonElement>)=>{const g=gesture.current;if(!g||g.pointer!==event.pointerId)return;const next=g.next;cancel();onUpdate({x:next.x,y:next.y,width:next.width,height:next.height});};
 const handlers={onPointerMove:move,onPointerUp:finish,onPointerCancel:cancel,onLostPointerCapture:cancel};
 const keyboard=(action:string)=>{
  const changes:Record<string,Partial<WidgetInstance>>={left:{x:widget.x-1},right:{x:widget.x+1},up:{y:widget.y-1},down:{y:widget.y+1},wider:{width:Math.min(12-widget.x,widget.width+1)},narrower:{width:widget.width-1},taller:{height:widget.height+1},shorter:{height:widget.height-1}};
  if(changes[action])onUpdate(changes[action]);
 };
 const title=isRtl?definition.titleAr:definition.title;
 return <article ref={ref} className="composer-widget stanza-surface" data-surface={surface} data-maximized={maximized||undefined} dir={isRtl?'rtl':'ltr'} aria-label={title} style={maximized?undefined:{gridColumn:`${widget.x+1} / span ${widget.width}`,gridRow:`${widget.y+1} / span ${widget.height}`}}>
 <header><h3>{editing&&!maximized?<button type="button" className="composer-drag" aria-label={`${text('Drag','سحب')} ${title}`} onPointerDown={e=>begin(e,'move')} {...handlers}>⠿ {title}</button>:title}</h3><button type="button" onClick={onMaximize} aria-label={`${maximized?text('Restore','استعادة'):text('Maximize','تكبير')} ${title}`}>{maximized?'↙':'↗'}</button></header>
 {editing&&<div className="composer-tools"><select aria-label={`${text('Move or resize','نقل أو تغيير حجم')} ${title}`} value="" onChange={e=>keyboard(e.target.value)} disabled={maximized}><option value="">{text('Move / resize…','نقل / حجم…')}</option>{[['left','Move left','يسار'],['right','Move right','يمين'],['up','Move up','أعلى'],['down','Move down','أسفل'],['wider','Make wider','توسيع'],['narrower','Make narrower','تضييق'],['taller','Make taller','زيادة الارتفاع'],['shorter','Make shorter','تقليل الارتفاع']].map(([id,en,ar])=><option key={id} value={id}>{text(en,ar)}</option>)}</select><button type="button" onClick={onConfigure}>{text('Configure','إعداد')}</button><button type="button" onClick={onRemove}>{text('Remove','إزالة')}</button></div>}
 <div className="composer-widget-body"><Suspense fallback={<p>{text('Loading…','جار التحميل…')}</p>}>{allowed?children:<p role="status">{text('This widget is unavailable with your current permissions.','هذه اللوحة غير متاحة لصلاحياتك الحالية.')}</p>}</Suspense></div>
 <footer>{allowed&&<button type="button" onClick={onOpen}>{text('Open module','فتح القسم')} →</button>}{editing&&!maximized&&<button type="button" className="composer-resize" aria-label={`${text('Resize','تغيير حجم')} ${title}`} onPointerDown={e=>begin(e,'resize')} {...handlers}>{text('Resize ↘','تغيير الحجم ↘')}</button>}</footer>
 </article>;
}
