import {useStanzaPreferences} from '../../lib/StanzaPreferencesContext';
import {useLanguage} from '../../lib/LanguageContext';
import {BACKGROUND_STYLES,type BackgroundIntensity,type ThemeTransitionMode} from '../../lib/appearance-options';
export function AppearancePatternControls(){
 const {isRtl}=useLanguage();const text=(en:string,ar:string)=>isRtl?ar:en;
 const {backgroundStyle,backgroundIntensity,themeTransition,setAppearanceOptions}=useStanzaPreferences();
 return <section className="stanza-appearance-options" aria-label={text('Background and transitions','الخلفية والانتقالات')}>
 <fieldset><legend>{text('Background style','نمط الخلفية')}</legend><p>{text('Static patterns follow your theme and accent.','أنماط ثابتة تتبع الثيم ولون التمييز.')}</p>
 <div className="stanza-pattern-choices" role="group" aria-label={text('Background style','نمط الخلفية')}>
 {BACKGROUND_STYLES.map(style=><button key={style.id} type="button" aria-label={isRtl?style.ar:style.en} aria-pressed={backgroundStyle===style.id} onClick={()=>setAppearanceOptions({backgroundStyle:style.id})} className="stanza-pattern-choice">
 <span className="stanza-pattern-preview" data-pattern={style.id} aria-hidden="true"/><span>{isRtl?style.ar:style.en}</span>{backgroundStyle===style.id&&<span className="stanza-pattern-selected" aria-label={text('Selected','محدد')}>✓</span>}
 </button>)}
 </div></fieldset>
 <fieldset disabled={backgroundStyle==='plain'}><legend>{text('Background intensity','كثافة الخلفية')}</legend><div className="stanza-option-segments">
 {([['quiet','Quiet','هادئ'],['normal','Normal','عادي'],['expressive','Expressive','بارز']] as const).map(([id,en,ar])=><button className="stanza-interactive-control" type="button" key={id} aria-pressed={backgroundIntensity===id} onClick={()=>setAppearanceOptions({backgroundIntensity:id as BackgroundIntensity})}>{text(en,ar)}</button>)}
 </div>{backgroundStyle==='plain'&&<p>{text('Plain has no pattern.','الخلفية البسيطة بلا نمط.')}</p>}</fieldset>
 <fieldset><legend>{text('Theme transition','انتقال الثيم')}</legend><div className="stanza-option-segments">
 {([['subtle','Subtle','خفيف'],['circle','Circle','دائرة'],['sweep','Sweep','مسح'],['none','None','بلا انتقال']] as const).map(([id,en,ar])=><button className="stanza-interactive-control" type="button" key={id} aria-pressed={themeTransition===id} onClick={()=>setAppearanceOptions({themeTransition:id as ThemeTransitionMode})}>{text(en,ar)}</button>)}
 </div><p>{text('Reduced motion and unsupported browsers switch instantly.','مع تقليل الحركة أو في المتصفحات غير المدعومة يتغير الثيم فورًا.')}</p></fieldset>
 </section>;
}
