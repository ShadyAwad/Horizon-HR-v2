import type {ButtonHTMLAttributes} from 'react';
import {StanzaFingerprintMark} from '../StanzaFingerprintMark';
import {useLanguage} from '../../lib/LanguageContext';
export function LogoutControl({className='',...props}:ButtonHTMLAttributes<HTMLButtonElement>){const {isRtl}=useLanguage();return <button type="button" className={'stanza-interactive-control stanza-destructive-action stanza-logout '+className} {...props}><StanzaFingerprintMark size={20}/><span>{isRtl?'تسجيل الخروج':'Logout'}</span></button>;}
