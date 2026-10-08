import {useEffect,useId,useRef,useState} from 'react';
import {useLanguage} from '../../lib/LanguageContext';
import {StanzaIcon} from './StanzaIcon';
import type {SurfaceVariant} from './Surface';
const choices=[['auto','Auto','تلقائي'],['solid','Solid','مصمت'],['glass','Glass','زجاجي'],['transparent','Transparent','شفاف']] as const;
export function SurfaceSelector({value,onChange,label}:{value:SurfaceVariant;onChange:(v:SurfaceVariant)=>void;label?:string}) {
 const {isRtl}=useLanguage(),[open,setOpen]=useState(false),id=useId();
 const root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null),items=useRef<(HTMLButtonElement|null)[]>([]);
 const title=label??(isRtl?'سطح اللوحات':'Panel surface');
 const close=(restore=false)=>{setOpen(false);if(restore)trigger.current?.focus();};
 useEffect(()=>{if(!open)return;items.current[choices.findIndex(c=>c[0]===value)]?.focus();
  const outside=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))setOpen(false);};
  document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);
 },[open,value]);
 return <div ref={root} className="stanza-surface-selector" dir={isRtl?'rtl':'ltr'} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))setOpen(false);}}>
  <button ref={trigger} type="button" className="stanza-interactive-control stanza-surface-trigger" aria-label={title} title={title} aria-haspopup="menu" aria-expanded={open} aria-controls={open?id:undefined} onClick={()=>setOpen(v=>!v)} onKeyDown={e=>{if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();setOpen(true);}}}><StanzaIcon name="auto"/></button>
  {open&&<div id={id} role="menu" aria-label={title} className="stanza-surface-menu" onKeyDown={e=>{
   if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close(true);return;}
   const index=items.current.indexOf(document.activeElement as HTMLButtonElement);
   const next=e.key==='Home'?0:e.key==='End'?3:e.key==='ArrowDown'?(index+1)%4:e.key==='ArrowUp'?(index+3)%4:null;
   if(next!==null){e.preventDefault();items.current[next]?.focus();}
  }}>{choices.map(([mode,en,ar],index)=><button ref={el=>{items.current[index]=el;}} key={mode} type="button" role="menuitemradio" aria-checked={value===mode} tabIndex={value===mode?0:-1} className="stanza-interactive-control" onClick={()=>{onChange(mode);close(true);}}><StanzaIcon name={mode}/><span>{isRtl?ar:en}</span><span aria-hidden="true">{value===mode?'✓':''}</span></button>)}</div>}
 </div>;
}
