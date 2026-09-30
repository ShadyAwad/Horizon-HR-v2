import { useState } from 'react';
import type { AuthUser } from '../../auth/auth-contract';
import { useLanguage } from '../../lib/LanguageContext';
import { useComposerPreferences } from './ComposerPreferences';
import { ComposerDialog } from './ComposerDialog';
import { canUseWidget, widgetDefinition, type WidgetId } from './widget-catalog';
import { createWidget, MAX_WIDGETS } from './workspace-model';
import './composer.css';
export function AddToWorkspace({widgetId,user}:{widgetId:WidgetId;user:AuthUser}){
 const {state,dispatch}=useComposerPreferences();const {isRtl}=useLanguage();const [open,setOpen]=useState(false);const [notice,setNotice]=useState('');
 const def=widgetDefinition(widgetId)!;if(!canUseWidget(user,def))return null;
 return <><button type="button" className="composer-launch" onClick={()=>{setNotice('');setOpen(true);}}>{isRtl?'إضافة إلى مساحة مخصصة':'Add to Workspace'}</button><span role="status" className="text-xs">{notice}</span>{open&&<ComposerDialog title={isRtl?'اختر مساحة مخصصة':'Choose a saved workspace'} onClose={()=>setOpen(false)}><div className="composer-library">{state.workspaces.map(w=><button type="button" key={w.id} disabled={w.widgets.length>=MAX_WIDGETS} onClick={()=>{dispatch({type:'add',id:w.id,widget:createWidget(widgetId)});setOpen(false);setNotice(isRtl?'تمت إضافة اللوحة':`Added to ${w.name}`);}}>{w.name}</button>)}</div></ComposerDialog>}</>;
}
