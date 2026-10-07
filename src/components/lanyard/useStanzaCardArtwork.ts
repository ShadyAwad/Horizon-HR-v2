import {useEffect,useMemo,useState} from 'react';
import type {AuthUser} from '../../auth/auth-contract';
import {apiFetch,apiUrl} from '../../lib/api';
import {useLanguage} from '../../lib/LanguageContext';
import {useStanzaPreferences} from '../../lib/StanzaPreferencesContext';
import {buildStanzaBackBadgeSvg,buildStanzaFrontBadgeSvg} from './stanzaBadgeArtwork';
/** Single appearance/artwork source for compact, expanded and mobile identity cards. */
export function useStanzaCardArtwork(user:AuthUser){const {customTheme,lanyardPreview}=useStanzaPreferences();const {lang,isRtl}=useLanguage();const style=lanyardPreview??customTheme.lanyardStyle;const language=lang==='ar'?'ar':'en',direction=isRtl?'rtl':'ltr';const [portrait,setPortrait]=useState<string|null>(null);
 useEffect(()=>{const abort=new AbortController();setPortrait(null);if(user.profileImageUrl)void apiFetch(apiUrl(user.profileImageUrl),{signal:abort.signal,cache:'force-cache'}).then(r=>{if(!r.ok)throw Error('Portrait unavailable');return r.blob();}).then(blob=>new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob);})).then(data=>{if(!abort.signal.aborted)setPortrait(data);}).catch(()=>{});return()=>abort.abort();},[user.profileImageUrl]);
 const frontImage=useMemo(()=>buildStanzaFrontBadgeSvg({language,direction,style}),[language,direction,style]);const backImage=useMemo(()=>buildStanzaBackBadgeSvg({...user,profileImageDataUrl:portrait},{language,direction,style}),[user,portrait,language,direction,style]);return {frontImage,backImage,style};
}
