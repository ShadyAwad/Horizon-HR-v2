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
 const [chosen,setChosen]=useState(widgetId);const options=(widgetIds??[widgetId]).filter(id=>canUseWidget(user,widgetDefinition(id)!));
 const def=widgetDefinition(widgetId)!;if(!canUseWidget(user,def))return null;
 return <><button type="button" className="composer-launch" onClick={()=>{setNotice('');setChosen(widgetId);setOpen(true);}}>{isRtl?'إضافة إلى مساحة مخصصة':'Add to Workspace'}</button><span role="status" className="text-xs">{notice}</span>{open&&<ComposerDialog title={isRtl?'اختر مساحة مخصصة':'Choose a saved workspace'} onClose={()=>setOpen(false)}>{options.length>1&&<label>{isRtl?'اللوحة':'Widget'}<select value={chosen} onChange={e=>setChosen(e.target.value as WidgetId)}>{options.map(id=><option key={id} value={id}>{isRtl?widgetDefinition(id)!.titleAr:widgetDefinition(id)!.title}</option>)}</select></label>}<div className="composer-library">{state.workspaces.map(w=><button type="button" key={w.id} disabled={w.widgets.length>=MAX_WIDGETS||!options.includes(chosen)} onClick={()=>{dispatch({type:'add',id:w.id,widget:createWidget(chosen)});setOpen(false);setNotice(isRtl?'تمت إضافة اللوحة':`Added to ${w.name}`);}}>{w.name}</button>)}</div></ComposerDialog>}</>;
}
