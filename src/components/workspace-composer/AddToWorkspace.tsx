import {StanzaIcon} from '../ui/StanzaIcon';
import { useState } from 'react';
import type { AuthUser } from '../../auth/auth-contract';
import { useLanguage } from '../../lib/LanguageContext';
import { useComposerPreferences } from './ComposerPreferences';
import { ComposerDialog } from './ComposerDialog';
import { canUseWidget, widgetDefinition, type WidgetId } from './widget-catalog';
import { createWidget, MAX_WIDGETS } from './workspace-model';
import './composer.css';
export function AddToWorkspace({widgetId,widgetIds,user}:{widgetId:WidgetId;widgetIds?:WidgetId[];user:AuthUser}){
 const {state,dispatch}=useComposerPreferences();const {isRtl}=useLanguage();const [open,setOpen]=useState(false);const [notice,setNotice]=useState('');
 const [destination,setDestination]=useState(state.activeId);const [chosen,setChosen]=useState(widgetId);const options=(widgetIds??[widgetId]).filter(id=>canUseWidget(user,widgetDefinition(id)!));
 const def=widgetDefinition(widgetId)!;if(!canUseWidget(user,def))return null;
 return <><button type="button" className="composer-launch" onClick={()=>{setNotice('');setChosen(widgetId);setDestination(state.activeId);setOpen(true);}}><StanzaIcon name="add"/>{isRtl?'إضافة إلى مساحة مخصصة':'Add to Workspace'}</button><span role="status" className="text-xs">{notice}</span>{open&&<ComposerDialog title={isRtl?'اختر مساحة مخصصة':'Choose a saved workspace'} onClose={()=>setOpen(false)}>{options.length>1&&<label>{isRtl?'اللوحة':'Widget'}<select aria-label={isRtl?'اللوحة':'Widget'} value={chosen} onChange={e=>setChosen(e.target.value as WidgetId)}>{options.map(id=><option key={id} value={id}>{isRtl?widgetDefinition(id)!.titleAr:widgetDefinition(id)!.title}</option>)}</select></label>}<label>{isRtl?'مساحة العمل':'Workspace'}<select aria-label={isRtl?'مساحة العمل':'Workspace'} value={destination} onChange={e=>setDestination(e.target.value)}>{state.workspaces.map(w=><option key={w.id} value={w.id}>{w.name}{w.id===state.activeId?(isRtl?' (الحالية)':' (active)'):''}</option>)}</select></label><p className="composer-caption">{isRtl?'المساحة الحالية محددة تلقائياً. يمكنك اختيار مساحة أخرى.':'Your active workspace is selected. You can choose another destination.'}</p>{state.workspaces.find(w=>w.id===destination)?.widgets.length===MAX_WIDGETS&&<p role="status">{isRtl?'هذه المساحة ممتلئة. اختر مساحة أخرى.':'This workspace is full. Choose another workspace.'}</p>}<button type="button" disabled={!state.workspaces.some(w=>w.id===destination&&w.widgets.length<MAX_WIDGETS)||!options.includes(chosen)} onClick={()=>{const target=state.workspaces.find(w=>w.id===destination);if(!target||target.widgets.length>=MAX_WIDGETS||!options.includes(chosen))return;dispatch({type:'add',id:target.id,widget:createWidget(chosen)});setOpen(false);setNotice(isRtl?`تمت الإضافة إلى ${target.name}`:`Added to ${target.name}`);}}>{isRtl?'إضافة لوحة':'Add widget'}</button></ComposerDialog>}</>;
}
