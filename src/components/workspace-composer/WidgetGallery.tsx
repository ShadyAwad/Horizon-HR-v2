import type {DashboardNavigationItem} from '../../navigation/navigation-contracts';
import {useState} from 'react';
import type {AuthUser} from '../../auth/auth-contract';
import {useLanguage} from '../../lib/LanguageContext';
import {WIDGETS,canUseWidget,widgetDescription,widgetSizes,type WidgetId} from './widget-catalog';
import {WidgetIcon,WidgetPreview} from './WidgetArtwork';
import {ComposerDialog} from './ComposerDialog';
export function WidgetGallery({initialSearch,modules,user,full,onAdd,onClose}:{initialSearch:string;modules:DashboardNavigationItem[];user:AuthUser;full:boolean;onAdd:(id:WidgetId,width:number,height:number,target?:string)=>void;onClose:()=>void}){
 const {isRtl}=useLanguage(),text=(en:string,ar:string)=>isRtl?ar:en;
 const [search,setSearch]=useState(initialSearch),[group,setGroup]=useState(''),[sizes,setSizes]=useState<Record<string,number>>({});
 const destinations=modules.filter(m=>m.id!=='composer');
 const [destination,setDestination]=useState(destinations[0]?.id??'');
 const allowed=WIDGETS.filter(w=>canUseWidget(user,w)),groups=[...new Set(allowed.map(w=>w.group))];
 const labels:Record<string,string>={Desktop:'سطح المكتب',Support:'الدعم',Attendance:'الحضور',Leave:'الإجازات',Finance:'المالية',Performance:'الأداء',Grievances:'الشكاوى',Hiring:'التوظيف',Communications:'التواصل'};
 const results=allowed.filter(w=>(!group||w.group===group)&&`${w.title} ${w.titleAr} ${widgetDescription(w,isRtl)}`.toLowerCase().includes(search.trim().toLowerCase()));
 return <ComposerDialog title={text('Add widgets','إضافة لوحات')} onClose={onClose}><p className="composer-caption">{text('Choose what belongs in your day. Previews illustrate layout, not live data.','اختر ما تحتاجه في يومك. المعاينات توضح الشكل وليست بيانات مباشرة.')}</p><div className="composer-gallery-filters"><label>{text('Search widgets','البحث عن لوحة')}<input autoFocus value={search} onChange={e=>setSearch(e.target.value)}/></label><label>{text('Category','الفئة')}<select value={group} onChange={e=>setGroup(e.target.value)}><option value="">{text('All categories','كل الفئات')}</option>{groups.map(g=><option key={g} value={g}>{isRtl?labels[g]||g:g}</option>)}</select></label></div><div className="composer-library">{results.map(w=>{const options=widgetSizes(w),selected=sizes[w.id]??1,size=options[selected];return <article className="composer-gallery-card" key={w.id}>
 <WidgetPreview id={w.id}/><div className="composer-gallery-title"><span className="composer-widget-icon"><WidgetIcon id={w.id}/></span><h3>{isRtl?w.titleAr:w.title}</h3></div><p>{widgetDescription(w,isRtl)}</p>
 {w.id==='shortcut'&&<label>{text('Module','القسم')}<select aria-label={text('Module','القسم')} value={destination} onChange={e=>setDestination(e.target.value)}>{destinations.map(m=><option key={m.id} value={m.id}>{m.label}</option>)}</select></label>}
 <label className="composer-size-label">{text('Size','الحجم')}<select aria-label={`${text('Size for','حجم')} ${isRtl?w.titleAr:w.title}`} value={selected} onChange={e=>setSizes(s=>({...s,[w.id]:Number(e.target.value)}))}>{options.map((v,i)=><option value={i} key={v.name}>{isRtl?v.nameAr:v.name}</option>)}</select></label>
 <button className="stanza-secondary-action" type="button" disabled={full||(w.id==='shortcut'&&!destination)} aria-label={`${text('Add','إضافة')} ${isRtl?w.titleAr:w.title}`} onClick={()=>onAdd(w.id,size.width,size.height,w.id==='shortcut'?destination:undefined)}>{text('Add widget','إضافة لوحة')} <span aria-hidden="true">+</span></button></article>;})}</div>{!results.length&&<p role="status">{text('No widgets match. Try another search or category.','لا توجد نتائج. جرب بحثاً أو فئة أخرى.')}</p>}<p className="composer-caption" role={full?'status':undefined}>{full?text('This workspace has 20 widgets. Remove one or choose another workspace.','هذه المساحة بها ٢٠ لوحة. أزل لوحة أو اختر مساحة أخرى.'):text('Only widgets available to you are shown. You can resize and customize them after adding.','تظهر اللوحات المتاحة لصلاحياتك فقط. يمكنك تغيير حجمها وإعدادها بعد الإضافة.')}</p></ComposerDialog>;
}
