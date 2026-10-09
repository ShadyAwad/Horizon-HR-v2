import {FONT_PROFILES,type FontProfileId} from '../../lib/typography';
// SVG image/texture documents cannot inherit the page's @font-face definitions.
// Reuse the existing local fonts once per profile, embedded in both card faces.
const profiles=new Map<FontProfileId,Promise<{fontCss:string;fontFamily:string}>>();
let stylesheet:Promise<string>|undefined;
export function loadCardTypography(profile:FontProfileId){
 if(profiles.has(profile))return profiles.get(profile)!;
 const entry=FONT_PROFILES.find(p=>p.id===profile)!;
 const promise=profile==='system'?Promise.resolve({fontCss:'',fontFamily:'system-ui,Segoe UI,Tahoma,Arial,sans-serif'}):(async()=>{
  stylesheet??=fetch('/fonts/fonts.css').then(r=>{if(!r.ok)throw Error('Font stylesheet unavailable');return r.text();});
  const blocks=(await stylesheet).match(/@font-face\s*\{[^}]+\}/g)||[];
  const chosen=blocks.filter(block=>block.includes(`font-family: '${entry.latin}'`)||block.includes(`font-family: '${entry.arabic}'`)&&(!block.includes("IBM Plex")||block.includes('font-weight: 600;')));
  const css=await Promise.all(chosen.map(async block=>{
   const path=block.match(/url\(([^)]+)\)/)![1];const response=await fetch(path);if(!response.ok)throw Error('Card font unavailable');
   const blob=await response.blob();const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob);});
   return block.replace(`url(${path})`,`url(${data})`);
  }));return {fontCss:css.join(''),fontFamily:`${entry.latin},${entry.arabic},system-ui,Tahoma,Arial,sans-serif`};
 })().catch(()=>({fontCss:'',fontFamily:'system-ui,Segoe UI,Tahoma,Arial,sans-serif'}));
 profiles.set(profile,promise);return promise;
}
