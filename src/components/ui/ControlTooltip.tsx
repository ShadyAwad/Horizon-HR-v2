import {cloneElement,useEffect,useId,useRef,useState,type ButtonHTMLAttributes,type ReactElement} from 'react';
import {createPortal} from 'react-dom';
/** Bounded hover/focus tooltip in the top layer of the app; no pointer tracking. */
export function ControlTooltip({label,children,className=''}:{label:string;className?:string;children:ReactElement<ButtonHTMLAttributes<HTMLButtonElement>>}){
 const id=useId(),anchor=useRef<HTMLSpanElement>(null),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 const [point,setPoint]=useState<{left:number;top:number}|null>(null);
 const cancel=()=>{clearTimeout(timer.current);};
 useEffect(()=>()=>clearTimeout(timer.current),[]);
 const show=()=>{cancel();const box=anchor.current?.getBoundingClientRect();if(box)setPoint({left:Math.max(8,Math.min(box.x,innerWidth-228)),top:box.bottom+68<innerHeight?box.bottom+6:Math.max(8,box.top-64)});};
 const hide=()=>{cancel();setPoint(null);};
 return <span ref={anchor} className={`stanza-tooltip-anchor ${className}`} onMouseEnter={()=>{cancel();timer.current=setTimeout(show,110);}} onMouseLeave={()=>{cancel();timer.current=setTimeout(hide,120);}} onFocus={show} onBlur={hide} onKeyDown={event=>{if(event.key==='Escape'&&point){hide();event.stopPropagation();}}}>
 {cloneElement(children,{'aria-describedby':point?[children.props['aria-describedby'],id].filter(Boolean).join(' '):children.props['aria-describedby']})}
 {point&&createPortal(<span id={id} role="tooltip" className="stanza-tooltip" style={point} onMouseEnter={cancel} onMouseLeave={hide}>{label}</span>,document.body)}
 </span>;
}
