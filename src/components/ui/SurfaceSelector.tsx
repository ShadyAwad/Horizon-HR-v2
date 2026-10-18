import {useEffect,useId,useRef,useState,type CSSProperties} from 'react';
import {useLanguage} from '../../lib/LanguageContext';
import {X} from 'lucide-react';
import {StanzaIcon} from './StanzaIcon';
import type {SurfaceVariant} from './Surface';
const choices=[['auto','Auto','تلقائي'],['solid','Solid','مصمت'],['glass','Glass','زجاجي'],['transparent','Transparent','شفاف']] as const;
export function SurfaceSelector({value,onChange,label}:{value:SurfaceVariant;onChange:(v:SurfaceVariant)=>void;label?:string}) {
 const {isRtl}=useLanguage(),[open,setOpen]=useState(false),[closing,setClosing]=useState(false),id=useId();
 const [tray,setTray]=useState({kind:'row',left:0,width:500});
 const root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null),items=useRef<(HTMLButtonElement|null)[]>([]);
 const title=label??(isRtl?'سطح اللوحات':'Panel surface');
 const closeTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const place=()=>{
  const rect=trigger.current?.getBoundingClientRect();if(!rect)return;
  const width=Math.min(34*parseFloat(getComputedStyle(document.documentElement).fontSize),innerWidth-24);
  const preferred=isRtl?rect.right-width:rect.left;
  setTray({kind:'row',left:Math.max(12,Math.min(preferred,innerWidth-width-12))-rect.left,width});
 };
 const show=()=>{if(closeTimer.current)clearTimeout(closeTimer.current);closeTimer.current=null;place();setClosing(false);setOpen(true);};
 const close=(restore=false)=>{
  if(!open||closing||closeTimer.current)return;
  if(restore)trigger.current?.focus();
  if(matchMedia('(prefers-reduced-motion: reduce)').matches){setOpen(false);return;}
  setClosing(true);closeTimer.current=setTimeout(()=>{closeTimer.current=null;setOpen(false);setClosing(false);},290);
 };
 useEffect(()=>()=>{if(closeTimer.current)clearTimeout(closeTimer.current);},[]);
 useEffect(()=>{if(!open||closing||closeTimer.current)return;items.current[choices.findIndex(c=>c[0]===value)]?.focus();
  const outside=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))close();};
  document.addEventListener('pointerdown',outside);window.addEventListener('resize',place);
  return()=>{document.removeEventListener('pointerdown',outside);window.removeEventListener('resize',place);};
 },[open,closing,value,isRtl]);
 return <div ref={root} className="stanza-surface-selector" data-layout={tray.kind} data-phase={closing?'closing':open?'open':'closed'} dir={isRtl?'rtl':'ltr'} onKeyDown={e=>{if(e.key==='Escape'&&open){e.preventDefault();e.stopPropagation();close(true);}}}>
  <button ref={trigger} type="button" className="stanza-interactive-control stanza-surface-trigger" aria-label={title} title={title} aria-haspopup="menu" aria-expanded={open&&!closing} aria-controls={open?id:undefined} onClick={()=>{if(!open||closing)show();}} onKeyDown={e=>{if(['ArrowDown','ArrowUp','ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();show();}}}><StanzaIcon name="auto"/></button>
  {open&&<div id={id} role="menu" aria-label={title} aria-orientation="horizontal" className="stanza-surface-menu" style={{'--surface-tray-left':`${tray.left}px`,'--surface-tray-width':`${tray.width}px`} as CSSProperties} onKeyDown={e=>{
   const index=items.current.indexOf(document.activeElement as HTMLButtonElement),step=1;
   const next=e.key==='Home'?0:e.key==='End'?3:e.key==='ArrowRight'?(index+(isRtl?3:1))%4:e.key==='ArrowLeft'?(index+(isRtl?1:3))%4:e.key==='ArrowDown'?(index+step)%4:e.key==='ArrowUp'?(index+4-step)%4:null;
   if(next!==null){e.preventDefault();items.current[next]?.focus();}
  }}><div className="stanza-surface-options" role="none">{choices.map(([mode,en,ar],index)=><button ref={el=>{items.current[index]=el;}} key={mode} type="button" role="menuitemradio" style={{'--surface-option-index':index} as CSSProperties} aria-checked={value===mode} tabIndex={value===mode?0:-1} className="stanza-interactive-control" onClick={()=>onChange(mode)}><StanzaIcon name={mode}/><span>{isRtl?ar:en}</span><span aria-hidden="true">{value===mode?'✓':''}</span></button>)}</div><button type="button" className="stanza-surface-close stanza-icon-action" aria-label={isRtl?'إغلاق محدد السطح':'Close surface selector'} onClick={()=>close(true)}><X aria-hidden="true"/></button></div>}
 </div>;
}
