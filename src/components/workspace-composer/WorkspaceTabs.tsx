import {useEffect,useRef,type KeyboardEvent} from 'react';
import {useLanguage} from '../../lib/LanguageContext';
import {StanzaIcon} from '../ui/StanzaIcon';
import {MAX_WORKSPACES,type SavedWorkspace} from './workspace-model';
type Props={workspaces:SavedWorkspace[];activeId:string;panelId:string;onSelect:(id:string)=>void;onCreate:()=>void;onRename:()=>void;onDuplicate:()=>void;onReorder:(direction:-1|1)=>void;onDelete:()=>void;onReset:()=>void};
/** Saved order is reading order; arrows follow the physical direction in RTL. */
export function WorkspaceTabs({workspaces,activeId,panelId,onSelect,onCreate,onRename,onDuplicate,onReorder,onDelete,onReset}:Props){
 const {isRtl}=useLanguage(),text=(en:string,ar:string)=>isRtl?ar:en;
 const tabs=useRef(new Map<string,HTMLButtonElement>()),menu=useRef<HTMLDetailsElement>(null),trigger=useRef<HTMLElement>(null);
 const order=JSON.stringify(workspaces.map(w=>[w.id,w.name]));
 const index=workspaces.findIndex(w=>w.id===activeId);
 useEffect(()=>{tabs.current.get(activeId)?.scrollIntoView({block:'nearest',inline:'nearest'});},[activeId,order]);
 const keyboard=(event:KeyboardEvent<HTMLDivElement>)=>{
  const current=workspaces.findIndex(w=>tabs.current.get(w.id)===event.target);if(current<0)return;
  const direction=event.key==='ArrowRight'?(isRtl?-1:1):event.key==='ArrowLeft'?(isRtl?1:-1):0;
  const next=event.key==='Home'?0:event.key==='End'?workspaces.length-1:direction?(current+direction+workspaces.length)%workspaces.length:null;
  if(next!==null){event.preventDefault();onSelect(workspaces[next].id);tabs.current.get(workspaces[next].id)?.focus();}
 };
 const action=(fn:()=>void)=>{if(menu.current)menu.current.open=false;trigger.current?.focus();fn();};
 return <div className="composer-workspace-navigation">
  <div role="tablist" aria-label={text('Saved workspaces','مساحات العمل المحفوظة')} className="composer-tabs" onKeyDown={keyboard}>
   {workspaces.map(w=><button ref={node=>{if(node)tabs.current.set(w.id,node);else tabs.current.delete(w.id);}} type="button" role="tab" id={`${panelId}-tab-${encodeURIComponent(w.id)}`} aria-controls={panelId} aria-selected={activeId===w.id} tabIndex={activeId===w.id?0:-1} key={w.id} title={w.name} onClick={()=>onSelect(w.id)}><span>{w.name}</span></button>)}
  </div>
  <div className="composer-workspace-actions">
   <button type="button" disabled={workspaces.length>=MAX_WORKSPACES} onClick={()=>{onCreate();requestAnimationFrame(()=>tabs.current.get([...tabs.current.keys()].at(-1)!)?.focus());}}><StanzaIcon name="add"/>{text('New workspace','مساحة جديدة')}</button>
   <details ref={menu} className="composer-workspace-menu" onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))event.currentTarget.open=false;}} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.currentTarget.open=false;trigger.current?.focus();}}}>
    <summary ref={trigger} aria-label={text('Manage workspace','إدارة مساحة العمل')}><StanzaIcon name="settings"/><span>{text('Manage','إدارة')}</span></summary>
    <div className="composer-workspace-menu-content">
     <button type="button" onClick={()=>action(onRename)}>{text('Rename','إعادة تسمية')}</button>
     <button type="button" disabled={workspaces.length>=MAX_WORKSPACES} onClick={()=>action(onDuplicate)}>{text('Duplicate','نسخ')}</button>
     <button type="button" disabled={index===0} onClick={()=>action(()=>onReorder(-1))}>{text('Move earlier','نقل إلى البداية')}</button>
     <button type="button" disabled={index===workspaces.length-1} onClick={()=>action(()=>onReorder(1))}>{text('Move later','نقل إلى النهاية')}</button>
     <button type="button" onClick={()=>action(onReset)}>{text('Reset layout','إفراغ التخطيط')}</button>
     <button type="button" onClick={()=>action(onDelete)}>{text('Delete workspace','حذف المساحة')}</button>
    </div>
   </details>
  </div>
 </div>;
}