import {useRef,useState} from 'react';
import type {AuthUser} from '../../auth/auth-contract';
import {useLanguage} from '../../lib/LanguageContext';
import {useStanzaCardArtwork} from './useStanzaCardArtwork';
import {LanyardDetails} from './LanyardDetails';
import {StanzaIcon} from '../ui/StanzaIcon';
export function DigitalCardPreviewButton({user}:{user:AuthUser}){const {isRtl}=useLanguage();const [open,setOpen]=useState(false);const ref=useRef<HTMLButtonElement>(null);const artwork=useStanzaCardArtwork(user);return <><button type="button" ref={ref} className="stanza-support-button" onClick={()=>setOpen(true)}><StanzaIcon name="badge"/>{isRtl?'عرض بطاقة الهوية':'View employee ID'}</button>{open&&<LanyardDetails user={user} {...artwork} onClose={()=>setOpen(false)} returnFocus={ref.current}/>}</>;}
