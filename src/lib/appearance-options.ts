export const BACKGROUND_STYLES = [
 {id:'plain',en:'Plain',ar:'بسيط'}, {id:'topographic',en:'Topographic',ar:'طبوغرافي'},
 {id:'grid',en:'Precision grid',ar:'شبكة دقيقة'}, {id:'dots',en:'Dot matrix',ar:'مصفوفة نقاط'},
 {id:'contours',en:'Contour waves',ar:'موجات كنتورية'}, {id:'radial',en:'Radial field',ar:'مجال شعاعي'},
 {id:'ambient',en:'Ambient',ar:'محيط هادئ'},
] as const;
export type BackgroundStyle = typeof BACKGROUND_STYLES[number]['id'];
export type BackgroundIntensity = 'quiet'|'normal'|'expressive';
export type ThemeTransitionMode = 'subtle'|'circle'|'sweep'|'none';
export type AppearanceOptions = {backgroundStyle:BackgroundStyle;backgroundIntensity:BackgroundIntensity;themeTransition:ThemeTransitionMode};
export function normaliseBackgroundStyle(value:unknown):BackgroundStyle {return BACKGROUND_STYLES.some(style=>style.id===value)?value as BackgroundStyle:'topographic';}
export function normaliseBackgroundIntensity(value:unknown):BackgroundIntensity {return value==='quiet'||value==='expressive'?value:'normal';}
export function normaliseThemeTransition(value:unknown):ThemeTransitionMode {return value==='circle'||value==='sweep'||value==='none'?value:'subtle';}
export function applyAppearanceOptions(options:AppearanceOptions) {
 if(typeof document==='undefined')return;
 document.documentElement.dataset.backgroundStyle=options.backgroundStyle;
 document.documentElement.dataset.backgroundIntensity=options.backgroundIntensity;
 document.documentElement.dataset.themeTransition=options.themeTransition;
}
