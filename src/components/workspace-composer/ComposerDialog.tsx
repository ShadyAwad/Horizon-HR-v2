import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useLanguage } from '../../lib/LanguageContext';
export function ComposerDialog({title,children,onClose}:{title:string;children:ReactNode;onClose:()=>void}){
 const ref=useRef<HTMLDialogElement>(null);const {isRtl}=useLanguage();
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null;const dialog=ref.current!;dialog.showModal();return()=>{dialog.close();if(previous?.isConnected)previous.focus();};},[]);
 return createPortal(<dialog ref={ref} aria-label={title} dir={isRtl?'rtl':'ltr'} className="composer-dialog" onCancel={e=>{e.preventDefault();onClose();}} onClick={e=>{if(e.target===e.currentTarget){const r=e.currentTarget.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)onClose();}}}>
 <header><h2>{title}</h2><button type="button" onClick={onClose} aria-label={isRtl?'إغلاق':'Close'}>×</button></header>{children}</dialog>,document.body);
}
