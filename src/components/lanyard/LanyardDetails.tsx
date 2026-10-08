import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import type {AuthUser} from '../../auth/auth-contract';
import {useLanguage} from '../../lib/LanguageContext';
import {IdentityCardArtwork,IDENTITY_CARD_ASPECT,IDENTITY_CARD_RADIUS} from './IdentityCardArtwork';
import {StanzaIcon} from '../ui/StanzaIcon';
/** The exact SVG artwork supplied to the compact WebGL card is reused here. */
export function LanyardDetails({user,frontImage,backImage,onClose,returnFocus}:{user:AuthUser;frontImage:string;backImage:string;onClose:()=>void;returnFocus:HTMLElement|null}){
 const ref=useRef<HTMLDialogElement>(null);const [flipped,setFlipped]=useState(false);const {isRtl,t}=useLanguage();
 useEffect(()=>{const dialog=ref.current!;dialog.showModal();return()=>{dialog.close();if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true});};},[returnFocus]);
 return createPortal(<dialog ref={ref} className="stanza-id-dialog stanza-expanded-id" dir={isRtl?'rtl':'ltr'} aria-label={isRtl?'هوية الموظف '+user.name:'Employee ID '+user.name} onCancel={e=>{e.preventDefault();onClose();}} onClick={e=>{if(e.target===e.currentTarget){const r=e.currentTarget.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)onClose();}}}>
 <div className="stanza-id-controls"><button type="button" className="stanza-interactive-control" aria-pressed={flipped} onClick={()=>setFlipped(v=>!v)}><StanzaIcon name="flip"/>{isRtl?'قلب البطاقة':'Flip card'}</button><button autoFocus type="button" className="stanza-close-action" aria-label={t('lanyard.close')} onClick={onClose}><StanzaIcon name="close"/></button></div>
 <div className="stanza-card-perspective"><div className="stanza-card-faces" style={{aspectRatio:IDENTITY_CARD_ASPECT,borderRadius:IDENTITY_CARD_RADIUS}} data-flipped={flipped}><IdentityCardArtwork face="front" svg={frontImage} label={isRtl?'واجهة بطاقة ستانزا':'Stanza card front'} hidden={flipped}/><IdentityCardArtwork face="back" svg={backImage} label={isRtl?'هوية الموظف '+user.name:'Employee identity '+user.name} hidden={!flipped}/></div></div>
 <p className="stanza-id-caption" role="status">{flipped?user.name:'Stanza'} · {isRtl?'بطاقة الهوية الرقمية؛ ليست وسيلة لتسجيل الدخول':'Digital identity card; not a sign-in credential'}</p>
 </dialog>,document.body);
}
