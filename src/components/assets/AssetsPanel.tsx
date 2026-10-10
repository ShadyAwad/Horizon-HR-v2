import {useCallback,useEffect,useRef,useState} from 'react';
import type {AuthUser} from '../../auth/auth-contract';
import {apiFetch} from '../../lib/api';
import {useLanguage} from '../../lib/LanguageContext';
import {ASSET_CATEGORIES} from '../../lib/asset-categories';
import {assetAttention,assetDate,assetLabel,ASSET_STATUSES} from '../../lib/asset-presentation';
import {StanzaIcon} from '../ui/StanzaIcon';
import {AssetFormDialog,type AssetFormRecord} from './AssetFormDialog';
import {canUseAssetLabelExtraction} from './asset-prefill-state';
import {AssetDetail} from './AssetDetail';
type Asset=AssetFormRecord&{status:string;assignedEmployee?:string|null;warrantyExpiresAt?:string|null};
type License={id:string;name:string;vendor?:string|null;seatCount?:number|null;seatsUsed:number;expiresAt?:string|null};
type AssetResponse={assets:Asset[];page:number;pageSize:number;total:number;summary:Record<string,number>};
type LicenseResponse={licenses:License[];page:number;pageSize:number;total:number;summary:Record<string,number>};
export function AssetsPanel({user,openCreateSignal=0}:{user:AuthUser;openCreateSignal?:number}){
 const {t,isRtl}=useLanguage(),text=(en:string,ar:string)=>isRtl?ar:en;
 const [view,setView]=useState<'hardware'|'software'>('hardware'),[hardware,setHardware]=useState<AssetResponse|null>(null),[licenses,setLicenses]=useState<LicenseResponse|null>(null);
 const [search,setSearch]=useState(''),[status,setStatus]=useState(''),[category,setCategory]=useState(''),[page,setPage]=useState(1);
 const [loading,setLoading]=useState(true),[error,setError]=useState(''),[showCreate,setShowCreate]=useState(false),[submitting,setSubmitting]=useState(false);
 const [assetDialogOpen,setAssetDialogOpen]=useState(false),[editAsset,setEditAsset]=useState<Asset|null>(null),[selected,setSelected]=useState<string|null>(null),[revision,setRevision]=useState(0);
 const [licenseForm,setLicenseForm]=useState({name:'',seatCount:''});
 const canManageAssets=Boolean(user.permissions?.includes('assets.manage')),canManageAssetQr=Boolean(user.permissions?.includes('assets.manage')&&user.permissions?.includes('qr.asset_label.manage'));
 const canExtractAssetLabels=canUseAssetLabelExtraction(user.permissions),handledCreateSignal=useRef(0),sequence=useRef(0),returnFocus=useRef<HTMLButtonElement|null>(null),panelRef=useRef<HTMLElement|null>(null);
 const load=useCallback(async()=>{
 const seq=++sequence.current;setLoading(true);setError('');
 try{
 const params=new URLSearchParams({page:String(page),pageSize:'20',search});
 if(view==='hardware'){if(status)params.set('status',status);if(category)params.set('category',category);}
 const response=await apiFetch((view==='hardware'?'/api/hr/assets?':'/api/hr/software-licenses?')+params),data=await response.json();
 if(!response.ok)throw Error(data.error||t('assets.loadError'));
 if(seq===sequence.current){if(view==='hardware')setHardware(data);else setLicenses(data);}
 }catch(e){if(seq===sequence.current)setError((e as Error).message);}finally{if(seq===sequence.current)setLoading(false);}
 },[page,search,status,category,view,t]);
 // Existing bounded search debounce; no polling or work after settling.
 useEffect(()=>{const handle=window.setTimeout(()=>void load(),120);return()=>{window.clearTimeout(handle);sequence.current++;};},[load]);
 useEffect(()=>{if(!openCreateSignal||handledCreateSignal.current===openCreateSignal)return;handledCreateSignal.current=openCreateSignal;if(!canManageAssets)return;setView('hardware');setPage(1);setEditAsset(null);setAssetDialogOpen(true);},[canManageAssets,openCreateSignal]);
 const reset=()=>{setSearch('');setStatus('');setCategory('');setPage(1);};
 const saved=async()=>{setRevision(v=>v+1);await load();};
 const createLicense=async(e:React.FormEvent)=>{e.preventDefault();setSubmitting(true);setError('');try{
 const response=await apiFetch('/api/hr/software-licenses',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:licenseForm.name,seatCount:licenseForm.seatCount===''?null:Number(licenseForm.seatCount)})}),d=await response.json();if(!response.ok)throw Error(d.error||t('assets.saveError'));setShowCreate(false);setLicenseForm({name:'',seatCount:''});await load();
 }catch(e){setError((e as Error).message);}finally{setSubmitting(false);}};
 const current=view==='hardware'?hardware:licenses,total=current?.total||0,filtered=Boolean(search||(view==='hardware'&&(status||category)));
 return <section ref={panelRef} className="assets-panel" dir={isRtl?'rtl':'ltr'}>
 <header className="assets-heading"><div><h2>{t('assets.title')}</h2><p className="assets-secondary">{t('assets.subtitle')}</p></div><div className="assets-actions">{canManageAssets&&<button className="assets-control assets-primary" onClick={()=>{if(view==='hardware'){setEditAsset(null);setAssetDialogOpen(true);}else setShowCreate(v=>!v);}}><StanzaIcon name="add"/>{view==='hardware'?t('assets.createAsset'):t('assets.createLicense')}</button>}<button className="assets-control" onClick={()=>void load()} disabled={loading} aria-label={t('assets.retry')}><StanzaIcon name="restore"/></button></div></header>
 <div className="assets-modes" aria-label={text('Inventory type','نوع المخزون')}>{(['hardware','software'] as const).map(v=><button key={v} type="button" aria-pressed={view===v} onClick={()=>{setView(v);setPage(1);setSelected(null);}}>{t(v==='hardware'?'assets.hardware':'assets.software')}</button>)}</div>
 {showCreate&&view==='software'&&<form className="assets-dialog assets-section" onSubmit={createLicense}><label>{t('assets.licenseName')}<input className="stanza-form-control" required disabled={submitting} value={licenseForm.name} onChange={e=>setLicenseForm(f=>({...f,name:e.target.value}))}/></label><label>{t('assets.seatCount')}<input className="stanza-form-control" type="number" min="0" disabled={submitting} value={licenseForm.seatCount} onChange={e=>setLicenseForm(f=>({...f,seatCount:e.target.value}))}/></label><div className="assets-actions"><button className="assets-control assets-primary" disabled={submitting} type="submit">{t('assets.save')}</button><button className="assets-control" type="button" disabled={submitting} onClick={()=>setShowCreate(false)}>{t('assets.cancel')}</button></div></form>}
 <div className="assets-filters"><label>{text('Search','البحث')}<input className="stanza-form-control" value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}} placeholder={view==='hardware'?text('Asset name or tag','اسم الأصل أو رقمه'):t('assets.search')}/></label>{view==='hardware'&&<><label>{t('assets.status')}<select className="stanza-form-control" value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}}><option value="">{text('All statuses','كل الحالات')}</option>{ASSET_STATUSES.map(s=><option value={s} key={s}>{assetLabel(s,isRtl)}</option>)}</select></label><label>{t('assets.category')}<select className="stanza-form-control" value={category} onChange={e=>{setCategory(e.target.value);setPage(1);}}><option value="">{text('All categories','كل الفئات')}</option>{ASSET_CATEGORIES.map(c=><option value={c} key={c}>{assetLabel(c,isRtl)}</option>)}</select></label></>}</div>
 {filtered&&<p className="assets-filter-state">{text('Filtered inventory','مخزون مُصفى')}: {[search,status&&assetLabel(status,isRtl),category&&view==='hardware'&&assetLabel(category,isRtl)].filter(Boolean).join(' · ')} <button className="assets-control" onClick={reset}>{text('Reset filters','مسح المرشحات')}</button></p>}
 {error&&<p role="alert">{error} <button className="assets-control" onClick={()=>void load()}>{t('assets.retry')}</button></p>}
 {current&&<dl className="assets-summary" aria-label={text('Whole inventory totals','إجمالي المخزون بالكامل')}>{(view==='hardware'?['total','available','assigned','maintenance','lost','warranties']:['totalLicenses','totalSeats','seatsUsed','expiringSoon']).map(key=><div key={key}><dt>{t(('assets.'+key) as never)}</dt><dd>{current.summary[key==='warranties'?'warrantiesExpiringSoon':key]??0}</dd></div>)}</dl>}
 <div className="assets-layout" data-detail={!!selected&&view==='hardware'}><div>
 {loading?<p role="status">{text('Loading inventory…','جار تحميل المخزون…')}</p>:view==='hardware'?<ul className="assets-list" aria-label={text('Asset inventory','مخزون الأصول')}>{hardware?.assets.map(asset=><li key={asset.id}>
 <button ref={node=>{if(node&&selected===asset.id)returnFocus.current=node;}} type="button" className="assets-row" aria-pressed={selected===asset.id} onClick={e=>{returnFocus.current=e.currentTarget;setSelected(asset.id);}}>
 <span className="assets-row-identity"><strong>{asset.name}</strong><bdi className="assets-identifier" dir="ltr">{asset.assetTag}</bdi><span className="assets-secondary">{assetLabel(asset.category,isRtl)}</span></span>
 <span className="assets-row-owner"><span className="assets-secondary">{t('assets.assignedTo')}</span><strong>{asset.assignedEmployee||t('assets.unassigned')}</strong></span>
 <span className="assets-row-state"><span>{t('assets.status')}: <strong>{assetLabel(asset.status,isRtl)}</strong></span><span>{t('assets.condition')}: {assetLabel(asset.condition,isRtl)}</span>{assetAttention(asset)&&<span className="assets-attention">{text('Needs attention','يحتاج متابعة')}</span>}</span>
 <StanzaIcon name="forward" className="assets-direction"/>
 </button></li>)}</ul>:<ul className="assets-list">{licenses?.licenses.map(license=><li className="assets-license" key={license.id}><strong>{license.name}</strong><span>{license.vendor||'—'} · {t('assets.seats')}: {license.seatsUsed}/{license.seatCount??'∞'}</span><span className="assets-secondary">{assetDate(license.expiresAt,isRtl)}</span></li>)}</ul>}
 {!loading&&total===0&&<p className="assets-empty">{filtered?(view==='hardware'?text('No assets match these filters.','لا توجد أصول تطابق هذه المرشحات.'):text('No licenses match this search.','لا توجد تراخيص تطابق هذا البحث.')):view==='hardware'?text('No assets yet.','لا توجد أصول بعد.'):t('assets.empty')}</p>}
 {!loading&&total>0&&<nav className="assets-pagination" aria-label={text('Inventory pagination','صفحات المخزون')}><span role="status">{(page-1)*20+1}–{Math.min(page*20,total)} {text('of','من')} {total}</span><button className="assets-control" type="button" aria-label={text('Previous page','الصفحة السابقة')} disabled={page<=1} onClick={()=>setPage(p=>p-1)}><StanzaIcon name="back" className="assets-direction"/></button><button className="assets-control" type="button" aria-label={text('Next page','الصفحة التالية')} disabled={page*20>=total} onClick={()=>setPage(p=>p+1)}><StanzaIcon name="forward" className="assets-direction"/></button></nav>}
 </div>{view==='hardware'&&selected&&<AssetDetail key={selected} id={selected} user={user} revision={revision} onClose={()=>{setSelected(null);if(returnFocus.current?.isConnected)returnFocus.current.focus();else panelRef.current?.querySelector<HTMLInputElement>('.assets-filters input')?.focus();}} onEdit={asset=>{setEditAsset(asset);setAssetDialogOpen(true);}} onChanged={()=>void saved()}/>}</div>
 {assetDialogOpen&&<AssetFormDialog asset={editAsset} canExtract={canExtractAssetLabels} canManageQr={canManageAssetQr} onClose={()=>setAssetDialogOpen(false)} onSaved={saved}/>}
 </section>;
}
