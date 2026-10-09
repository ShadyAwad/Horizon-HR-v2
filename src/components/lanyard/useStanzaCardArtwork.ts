import {loadCardTypography} from './card-typography';
import {resolveLanyardAppearance} from '../../lib/lanyard-appearance';
import {useEffect,useMemo,useState} from 'react';
import {useTheme} from '../../lib/ThemeContext';
import {normaliseCustomAccent,type LanyardStyle} from '../../lib/custom-theme';
import type {AuthUser} from '../../auth/auth-contract';
import {apiFetch,apiUrl} from '../../lib/api';
import {useLanguage} from '../../lib/LanguageContext';
import {useStanzaPreferences} from '../../lib/StanzaPreferencesContext';
import {buildStanzaBackBadgeSvg,buildStanzaFrontBadgeSvg} from './stanzaBadgeArtwork';
/** Single appearance/artwork source for compact, expanded and mobile identity cards. */
export function useStanzaCardArtwork(user:AuthUser){const {customTheme,lanyardPreview,backgroundPreset,lightIntensity,fontProfile}=useStanzaPreferences();const {theme}=useTheme();const {lang,isRtl}=useLanguage();const selected=lanyardPreview??customTheme.lanyardStyle;const [themeStyle,setThemeStyle]=useState<LanyardStyle>({cardColor:null,accentColor:null,strapColor:null});
 useEffect(()=>{let alive=true;queueMicrotask(()=>{if(!alive)return;const css=getComputedStyle(document.documentElement);const color=(name:string)=>normaliseCustomAccent(css.getPropertyValue('--stanza-'+name));setThemeStyle({cardColor:color('surface')??color('page-bg'),accentColor:color('accent'),strapColor:color('accent')});});return()=>{alive=false;};},[theme,backgroundPreset,customTheme,lightIntensity]);
 const style=resolveLanyardAppearance(selected,themeStyle);const language=lang==='ar'?'ar':'en',direction=isRtl?'rtl':'ltr';const [portrait,setPortrait]=useState<string|null>(null);
 useEffect(()=>{const abort=new AbortController();setPortrait(null);if(user.profileImageUrl)void apiFetch(apiUrl(user.profileImageUrl),{signal:abort.signal,cache:'force-cache'}).then(r=>{if(!r.ok)throw Error('Portrait unavailable');return r.blob();}).then(blob=>new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob);})).then(data=>{if(!abort.signal.aborted)setPortrait(data);}).catch(()=>{});return()=>abort.abort();},[user.profileImageUrl]);
 const [typography,setTypography]=useState({fontCss:'',fontFamily:'system-ui,Segoe UI,Tahoma,Arial,sans-serif'});
 useEffect(()=>{let alive=true;void loadCardTypography(fontProfile).then(value=>{if(alive)setTypography(value);});return()=>{alive=false;};},[fontProfile]);
 const frontImage=useMemo(()=>buildStanzaFrontBadgeSvg({language,direction,style,...typography}),[language,direction,style,typography]);const backImage=useMemo(()=>buildStanzaBackBadgeSvg({...user,profileImageDataUrl:portrait},{language,direction,style,...typography}),[user,portrait,language,direction,style,typography]);return {frontImage,backImage,style};
}
