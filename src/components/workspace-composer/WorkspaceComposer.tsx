import {lazy} from 'react';
import type {DashboardNavigationItem} from '../../navigation/navigation-contracts';
import {RefreshButton} from '../ui/RefreshButton';
import {WidgetGallery} from './WidgetGallery';
import {WidgetIcon} from './WidgetArtwork';
import {SurfaceSelector} from '../ui/SurfaceSelector';
import {StanzaIcon} from '../ui/StanzaIcon';
import { useId, useState, useRef, useEffect } from 'react';
import type { AuthUser } from '../../auth/auth-contract';
import type { DashboardWorkspaceId } from '../../navigation/workspace-registry';
import { useLanguage } from '../../lib/LanguageContext';
import { useComposerPreferences } from './ComposerPreferences';
import { ComposerDialog } from './ComposerDialog';
import { WorkspaceTabs } from './WorkspaceTabs';
import { WIDGET_REGISTRY } from './widget-registry';
import { canUseWidget, widgetPath, widgetDescription, widgetSizes } from './widget-catalog';
import { createWidget, newId, nextWorkspaceName, MAX_WIDGETS, MAX_WORKSPACES, WIDGET_ACCENTS, layoutHeight, stackedOrder, type Surface } from './workspace-model';
import { useWidgetData } from './useWidgetData';
import { WidgetFrame } from './WidgetFrame';
import './composer.css';
const DeskItem=lazy(()=>import('./DeskItem'));
function dataPath(widget:ReturnType<typeof createWidget>){
 return widgetPath(widget.widgetId==='chart'&&widget.config.source==='equipment'?'equipment':widget.widgetId);
}
export default function WorkspaceComposer({modules,user,onOpen}:{modules:DashboardNavigationItem[];user:AuthUser;onOpen:(id:DashboardWorkspaceId,widgetId?:string)=>void}){
 const {state,dispatch,saveError,editingId,setEditingId}=useComposerPreferences();const editing=editingId===state.activeId;const setEditing=(value:boolean)=>setEditingId(value?state.activeId:null);const {isRtl}=useLanguage();const text=(en:string,ar:string)=>isRtl?ar:en;
 const [dialog,setDialog]=useState<'library'|'rename'|'delete'|'reset'|null>(null),[name,setName]=useState(''),[maximized,setMaximized]=useState<string|null>(null),[configId,setConfigId]=useState<string|null>(null),[refresh,setRefresh]=useState(0);
 const panelId=useId();const root=useRef<HTMLElement>(null),focusAfterChange=useRef<string|null>(null);
 const workspace=state.workspaces.find(w=>w.id===state.activeId)!;
 useEffect(()=>{const target=focusAfterChange.current;if(!target)return;focusAfterChange.current=null;root.current?.querySelector<HTMLButtonElement>(target==='toolbar'?'[data-add-widgets]':`[data-instance-id="${CSS.escape(target)}"] .composer-drag`)?.focus();},[workspace.widgets]);
 const selectedMax=workspace.widgets.find(w=>w.instanceId===maximized);
 const visible=selectedMax?[selectedMax]:stackedOrder(workspace.widgets);
 const allowed=visible.filter(w=>canUseWidget(user,WIDGET_REGISTRY.find(d=>d.id===w.widgetId)!));
 const identity=JSON.stringify([user.tenantId,user.id,user.role,user.permissions]);
 const results=useWidgetData(allowed.map(dataPath).filter(Boolean),identity,refresh);
 const configure=workspace.widgets.find(w=>w.instanceId===configId);
 const selectWorkspace=(id:string)=>{dispatch({type:'select',id});setMaximized(null);setConfigId(null);setEditing(false);setDialog(null);};
 const [librarySearch,setLibrarySearch]=useState('');
 const openLibrary=()=>{setLibrarySearch('');setDialog('library');};
 const createWorkspace=()=>{dispatch({type:'create',id:newId(),name:nextWorkspaceName(state.workspaces,text('Workspace','مساحة العمل'))});setMaximized(null);setConfigId(null);setEditing(false);setDialog(null);};
 const controls=<>{editing?<><span className="composer-edit-state">{text('Customizing','وضع التخصيص')}</span><button data-add-widgets className="stanza-primary-action" type="button" onClick={openLibrary} disabled={workspace.widgets.length>=MAX_WIDGETS}><StanzaIcon name="add"/>{text('Add widgets','إضافة لوحات')}</button><button className="stanza-quiet-action" type="button" onClick={()=>setDialog('reset')} disabled={!workspace.widgets.length}>{text('Reset layout','إفراغ التخطيط')}</button><button className="stanza-secondary-action" type="button" onClick={()=>setEditing(false)}>{text('Done','تم')}</button></>:<><button data-add-widgets className="stanza-primary-action" type="button" onClick={openLibrary} disabled={workspace.widgets.length>=MAX_WIDGETS}><StanzaIcon name="add"/>{text('Add widgets','إضافة لوحات')}</button><button className="stanza-secondary-action" type="button" aria-pressed={editing} onClick={()=>setEditing(true)}><StanzaIcon name="settings"/>{text('Customize','تخصيص المساحة')}</button><RefreshButton onClick={()=>setRefresh(v=>v+1)}>{text('Refresh data','تحديث البيانات')}</RefreshButton></>}</>;
 return <section ref={root} className="composer" data-editing={editing||undefined} dir={isRtl?'rtl':'ltr'} aria-label={text('Workspace Composer','منشئ مساحات العمل')}>
 <div className="composer-heading"><div><h2>{workspace.name}</h2><p>{text('Personal desktop','سطح المكتب الشخصي')} · {workspace.widgets.length} / {MAX_WIDGETS}</p></div></div>
 <WorkspaceTabs workspaces={state.workspaces} activeId={workspace.id} panelId={panelId} onSelect={selectWorkspace} onCreate={createWorkspace} onRename={()=>{setName(workspace.name);setDialog('rename');}} onDuplicate={()=>{dispatch({type:'duplicate',id:workspace.id,newId:newId()});setMaximized(null);setEditing(false);}} onReorder={direction=>dispatch({type:'reorder',id:workspace.id,direction})} onDelete={()=>setDialog('delete')} onReset={()=>setDialog('reset')} />
 <div className="composer-toolbar">{controls}
 {workspace.widgets.length>0&&<label className="desk-window-picker"><StanzaIcon name="workspace"/><select aria-label={text('Switch window','تبديل النافذة')} value={selectedMax?.instanceId??''} onChange={e=>{
   const window=workspace.widgets.find(w=>w.instanceId===e.target.value);
   if(window?.collapsed)dispatch({type:'update',id:workspace.id,instanceId:window.instanceId,patch:{collapsed:false}});
   setMaximized(window?.instanceId??null);
 }}><option value="">{text('Desktop overview','عرض سطح المكتب')}</option>{workspace.widgets.map(w=>{
   const def=WIDGET_REGISTRY.find(d=>d.id===w.widgetId)!;
   const label=w.config.title || (w.widgetId==='shortcut'&&modules.find(m=>m.id===w.config.target)?.label) || (isRtl?def.titleAr:def.title);
   return <option key={w.instanceId} value={w.instanceId}>{label}</option>;
 })}</select></label>}<SurfaceSelector value={state.surface} onChange={value=>dispatch({type:'surface',value})} /></div>
 <p className="composer-caption">{editing?<><span className="composer-desktop-instruction">{text('Drag a grip to move. Use a corner to resize, or open Widget controls for keyboard options. Escape cancels.','اسحب المقبض للنقل والزاوية لتغيير الحجم، أو افتح أدوات اللوحة لاستخدام لوحة المفاتيح. Escape يلغي السحب.')}</span><span className="composer-mobile-instruction">{text('Cards stack to fit this screen. Open Widget controls for saved order, size and settings.','تُرتب اللوحات رأسياً على هذه الشاشة. افتح أدوات اللوحة لتعديل الترتيب والحجم والإعدادات المحفوظة.')}</span></>:text('Layout locked. Customize to move, resize, configure or remove widgets.','التخطيط مقفل. خصص المساحة لنقل اللوحات وتغيير حجمها وإعدادها.')}</p>
 {saveError&&<p role="alert">{text('Could not save this change. Check browser storage or reduce the size of the layout.','تعذر حفظ التغيير. تحقق من تخزين المتصفح أو قلّل حجم التخطيط.')}</p>}
 <div key={workspace.id} id={panelId} role="tabpanel" aria-labelledby={`${panelId}-tab-${encodeURIComponent(workspace.id)}`} tabIndex={0} className="composer-panel">
 <div className="desktop-shelf" role="group" aria-label={text('Desktop tools','أدوات سطح المكتب')}>
 {(['shortcut','chart','note','sketch'] as const).map(kind=>{
   const item=WIDGET_REGISTRY.find(entry=>entry.id===kind)!;
   if(!canUseWidget(user,item))return null;
   const label=isRtl?item.titleAr:item.title;
   return <button type="button" key={kind} disabled={workspace.widgets.length>=MAX_WIDGETS} onClick={()=>{setLibrarySearch(label);setDialog('library');}}><span><WidgetIcon id={kind}/></span>{label}</button>;
 })}
 </div>
 {!workspace.widgets.length?<div className="composer-empty"><h3>{text('Build your workspace','ابنِ مساحتك')}</h3><p>{text('Choose the information you want close at hand. Make room for your day.','اختر المعلومات التي تحتاجها باستمرار ورتب يومك بطريقتك.')}</p><button className="stanza-primary-action" type="button" onClick={openLibrary}>{text('Add widgets','إضافة لوحات')}</button></div>:<div className="composer-grid" data-editing={editing||undefined} dir="ltr" data-maximized={Boolean(selectedMax)||undefined} style={{minHeight:selectedMax?'min(75dvh, 850px)':`${Math.max(8,...workspace.widgets.map(w=>w.y+layoutHeight(w))) *64+(editing?256:0)}px`}}>
 {visible.map(widget=>{const definition=WIDGET_REGISTRY.find(w=>w.id===widget.widgetId)!;const Component=definition.component;const destination=modules.find(m=>m.id===widget.config.target&&m.id!=='composer');
 const authorized=canUseWidget(user,definition)&&(widget.widgetId!=='shortcut'||Boolean(destination));
 const personal=['note','sketch','shortcut','chart'].includes(widget.widgetId);return <WidgetFrame key={widget.instanceId} widget={widget} definition={definition} editing={editing} maximized={Boolean(selectedMax)} surface={widget.surfaceOverride==='auto'?state.surface:widget.surfaceOverride} allowed={authorized} onUpdate={patch=>dispatch({type:'update',id:workspace.id,instanceId:widget.instanceId,patch})} onRemove={()=>{focusAfterChange.current='toolbar';dispatch({type:'remove',id:workspace.id,instanceId:widget.instanceId});setMaximized(null);}} onConfigure={()=>setConfigId(widget.instanceId)} onMaximize={()=>setMaximized(selectedMax?null:widget.instanceId)} onOpen={()=>onOpen(widget.widgetId==='chart'&&widget.config.source==='equipment'?'profile':definition.module,widget.widgetId)}> {authorized&&personal&&<DeskItem widget={widget} module={destination} onLaunch={()=>{if(destination)onOpen(destination.id as DashboardWorkspaceId);}} result={results[dataPath(widget)]} onSave={config=>dispatch({type:'update',id:workspace.id,instanceId:widget.instanceId,patch:{config}})}/>}
 {authorized&&!personal&&<Component widget={widget} result={results[dataPath(widget)]} onRefresh={()=>setRefresh(v=>v+1)}/>}</WidgetFrame>;})}
 </div>}
 </div>
 {dialog==='library'&&<WidgetGallery initialSearch={librarySearch} modules={modules} user={user} full={workspace.widgets.length>=MAX_WIDGETS} onClose={()=>setDialog(null)} onAdd={(id,width,height,target)=>{const widget={...createWidget(id),width,height};if(target)widget.config.target=target;focusAfterChange.current=widget.instanceId;dispatch({type:'add',id:workspace.id,widget});setDialog(null);setEditing(true);}}/>}
 {dialog==='rename'&&<ComposerDialog title={text('Rename workspace','إعادة تسمية المساحة')} onClose={()=>setDialog(null)}><form onSubmit={e=>{e.preventDefault();if(!name.trim())return;dispatch({type:'rename',id:workspace.id,name});setDialog(null);}}><label>{text('Name','الاسم')}<input autoFocus required maxLength={60} value={name} onChange={e=>setName(e.target.value)} aria-describedby={!name.trim()?'composer-name-error':undefined}/></label>{!name.trim()&&<p id="composer-name-error" role="alert">{text('Enter a workspace name.','أدخل اسماً لمساحة العمل.')}</p>}<div className="composer-dialog-actions"><button type="button" onClick={()=>setDialog(null)}>{text('Cancel','إلغاء')}</button><button type="submit" disabled={!name.trim()}>{text('Save','حفظ')}</button></div></form></ComposerDialog>}
 {(dialog==='delete'||dialog==='reset')&&<ComposerDialog title={text('Confirm layout change','تأكيد تغيير التخطيط')} onClose={()=>setDialog(null)}><p>{text(`This will ${dialog==='delete'?'delete':'empty'} “${workspace.name}”. Only its layout configuration will be removed. Domain records will not change.`,`سيتم ${dialog==='delete'?'حذف':'إفراغ'} «${workspace.name}». سيُزال تخطيطها فقط. لن تتغير سجلات النظام.`)}</p>{dialog==='delete'&&state.workspaces.length===1&&<p>{text('A new empty default workspace will remain.','ستبقى مساحة افتراضية جديدة وفارغة.')}</p>}<div className="composer-dialog-actions"><button type="button" onClick={()=>setDialog(null)}>{text('Cancel','إلغاء')}</button><button type="button" onClick={()=>{dispatch({type:dialog,id:workspace.id});setDialog(null);setMaximized(null);}}>{text('Confirm','تأكيد')}</button></div></ComposerDialog>}
 {configure&&<ComposerDialog title={text('Customize widget','تخصيص اللوحة')} onClose={()=>setConfigId(null)}><div className="composer-config-identity"><span className="composer-widget-icon"><WidgetIcon id={configure.widgetId}/></span><div><h3>{isRtl?WIDGET_REGISTRY.find(w=>w.id===configure.widgetId)!.titleAr:WIDGET_REGISTRY.find(w=>w.id===configure.widgetId)!.title}</h3><p>{widgetDescription(WIDGET_REGISTRY.find(w=>w.id===configure.widgetId)!,isRtl)}</p></div></div><label>{text('Window title','عنوان النافذة')}<input key={configure.instanceId} maxLength={60} defaultValue={configure.config.title??''} onBlur={e=>dispatch({type:'update',id:workspace.id,instanceId:configure.instanceId,patch:{config:{...configure.config,title:e.target.value.trim()}}})}/></label><label>{text('Widget size','حجم اللوحة')}<select aria-label={text('Widget size','حجم اللوحة')} value={widgetSizes(WIDGET_REGISTRY.find(w=>w.id===configure.widgetId)!).findIndex(s=>s.width===configure.width&&s.height===configure.height)} onChange={e=>{const size=widgetSizes(WIDGET_REGISTRY.find(w=>w.id===configure.widgetId)!)[Number(e.target.value)];if(size)dispatch({type:'update',id:workspace.id,instanceId:configure.instanceId,patch:{width:size.width,height:size.height}});}}><option value={-1} disabled>{text('Custom size','حجم مخصص')}</option>{widgetSizes(WIDGET_REGISTRY.find(w=>w.id===configure.widgetId)!).map((size,i)=><option value={i} key={i}>{isRtl?size.nameAr:size.name}</option>)}</select></label><p>{text('Auto inherits the workspace default.','تلقائي يستخدم سطح المساحة الافتراضي.')}</p><SurfaceSelector value={configure.surfaceOverride} onChange={surfaceOverride=>dispatch({type:'update',id:workspace.id,instanceId:configure.instanceId,patch:{surfaceOverride}})} /><label>{text('Workflow color','لون سير العمل')}<select aria-label={text('Workflow color','لون سير العمل')} value={configure.accent??'default'} onChange={e=>dispatch({type:'update',id:workspace.id,instanceId:configure.instanceId,patch:{accent:e.target.value as typeof configure.accent}})}>{WIDGET_ACCENTS.map((v,i)=><option key={v} value={v}>{isRtl?['افتراضي','أخضر','أزرق','بنفسجي','كهرماني','أحمر','محايد'][i]:v}</option>)}</select></label>{configure.widgetId==='attendance'?<label><input type="checkbox" checked={!!configure.config.compact} onChange={e=>dispatch({type:'update',id:workspace.id,instanceId:configure.instanceId,patch:{config:{...configure.config,compact:e.target.checked}}})}/>{text('Compact status','حالة مختصرة')}</label>:['note','chart','sketch','shortcut'].includes(configure.widgetId)?null:<label>{text('Maximum visible items','أقصى عدد للعناصر')}<select value={configure.config.limit||5} onChange={e=>dispatch({type:'update',id:workspace.id,instanceId:configure.instanceId,patch:{config:{...configure.config,limit:Number(e.target.value)}}})}>{[2,5,10].map(n=><option key={n}>{n}</option>)}</select></label>}<p>{text('The service may return fewer items. Scope is always enforced by the server.','قد تعيد الخدمة عدداً أقل. يفرض الخادم نطاق الصلاحيات دائماً.')}</p></ComposerDialog>}
 </section>;
}
