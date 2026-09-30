import { widgetDefinition, type WidgetId, type WidgetConfig } from './widget-catalog';
export const COLUMNS=12, MAX_WIDGETS=20, MAX_WORKSPACES=10;
export type Surface='auto'|'solid'|'glass';
export type WidgetInstance={instanceId:string;widgetId:WidgetId;x:number;y:number;width:number;height:number;config:WidgetConfig;surfaceOverride:Surface};
export type SavedWorkspace={id:string;name:string;widgets:WidgetInstance[]};
export type ComposerPreferences={version:1;activeId:string;surface:Surface;workspaces:SavedWorkspace[]};
export const newId=()=>crypto.randomUUID();
export const defaultPreferences=():ComposerPreferences=>({version:1,activeId:'my-workspace',surface:'auto',workspaces:[{id:'my-workspace',name:'My Workspace',widgets:[]}]});
const integer=(v:unknown,fallback:number,min:number,max:number)=>typeof v==='number'&&Number.isFinite(v)?Math.max(min,Math.min(max,Math.round(v))):fallback;
export const surface=(v:unknown):Surface=>v==='solid'||v==='glass'?v:'auto';
export const overlap=(a:WidgetInstance,b:WidgetInstance)=>a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
export function boundGeometry(w:WidgetInstance):WidgetInstance {
 const def=widgetDefinition(w.widgetId)!;const width=integer(w.width,def.defaultWidth,def.minWidth,COLUMNS);
 return {...w,width,height:integer(w.height,def.defaultHeight,def.minHeight,12),x:integer(w.x,0,0,COLUMNS-width),y:integer(w.y,0,0,240)};
}
/** Moved widget wins its slot; conflicting widgets move down, retaining their column. */
export function settle(widgets:WidgetInstance[],priority?:string):WidgetInstance[] {
 const placed:WidgetInstance[]=[];
 const order=priority?[...widgets.filter(w=>w.instanceId===priority),...widgets.filter(w=>w.instanceId!==priority)]:widgets;
 for(const value of order){let w=boundGeometry(value);let hits:WidgetInstance[];while((hits=placed.filter(p=>overlap(w,p))).length)w={...w,y:Math.max(...hits.map(p=>p.y+p.height))};placed.push(w);}
 return widgets.map(w=>placed.find(p=>p.instanceId===w.instanceId)!);
}
export function normalizePreferences(raw:unknown):ComposerPreferences {
 const fallback=defaultPreferences();if(!raw||typeof raw!=='object')return fallback;
 const obj=raw as Partial<ComposerPreferences>;if(obj.version!==1||!Array.isArray(obj.workspaces))return fallback;
 const seen=new Set<string>();const workspaces:SavedWorkspace[]=[];
 for(const value of obj.workspaces.slice(0,MAX_WORKSPACES)){
  if(!value||typeof value.id!=='string'||value.id.length>80||seen.has(value.id))continue;seen.add(value.id);
  const ids=new Set<string>();const widgets:WidgetInstance[]=[];
  for(const v of (Array.isArray(value.widgets)?value.widgets:[]).slice(0,MAX_WIDGETS)){
   if(!v||!widgetDefinition(v.widgetId)||typeof v.instanceId!=='string'||v.instanceId.length>80||ids.has(v.instanceId))continue;ids.add(v.instanceId);
   widgets.push(boundGeometry({instanceId:v.instanceId,widgetId:v.widgetId,x:v.x,y:v.y,width:v.width,height:v.height,config:{compact:v.config?.compact===true,limit:[2,5,10].includes(v.config?.limit)?v.config.limit:5},surfaceOverride:surface(v.surfaceOverride)}));
  }
  workspaces.push({id:value.id,name:typeof value.name==='string'&&value.name.trim()?value.name.trim().slice(0,60):'My Workspace',widgets:settle(widgets)});
 }
 if(!workspaces.length)return fallback;
 return {version:1,surface:surface(obj.surface),activeId:workspaces.some(w=>w.id===obj.activeId)?obj.activeId!:workspaces[0].id,workspaces};
}
export function readPreferences(raw:string|null){if(raw&&raw.length>200_000)return defaultPreferences();try{return normalizePreferences(JSON.parse(raw||'null'));}catch{return defaultPreferences();}}
export const storageKey=(tenant:string,user:string)=>`stanza.composer.v1:${encodeURIComponent(tenant)}:${encodeURIComponent(user)}`;
export type ComposerAction = {type:'create';id:string;name:string}|{type:'rename';id:string;name:string}|{type:'duplicate';id:string;newId:string}|{type:'delete';id:string}|{type:'select';id:string}|{type:'reset';id:string}|{type:'surface';value:Surface}|{type:'add';id:string;widget:WidgetInstance}|{type:'remove';id:string;instanceId:string}|{type:'update';id:string;instanceId:string;patch:Partial<WidgetInstance>};
export function reduceComposer(state:ComposerPreferences,action:ComposerAction):ComposerPreferences {
 let result=state;
 const edit=(id:string,fn:(w:SavedWorkspace)=>SavedWorkspace)=>({...state,workspaces:state.workspaces.map(w=>w.id===id?fn(w):w)});
 switch(action.type){
 case 'create':if(state.workspaces.length<MAX_WORKSPACES)result={...state,activeId:action.id,workspaces:[...state.workspaces,{id:action.id,name:action.name,widgets:[]}]};break;
 case 'rename':result=edit(action.id,w=>({...w,name:action.name}));break;
 case 'duplicate':{const original=state.workspaces.find(w=>w.id===action.id);if(original&&state.workspaces.length<MAX_WORKSPACES)result={...state,activeId:action.newId,workspaces:[...state.workspaces,{...original,id:action.newId,name:`${original.name} copy`,widgets:original.widgets.map((w,i)=>({...w,instanceId:`${action.newId}-${i}`}))}]};break;}
 case 'delete':result={...state,workspaces:state.workspaces.filter(w=>w.id!==action.id)};break;
 case 'select':result={...state,activeId:action.id};break;
 case 'reset':result=edit(action.id,w=>({...w,widgets:[]}));break;
 case 'surface':result={...state,surface:action.value};break;
 case 'add':result=edit(action.id,w=>w.widgets.length>=MAX_WIDGETS?w:({...w,widgets:settle([...w.widgets,placeNew(w.widgets,action.widget)])}));break;
 case 'remove':result=edit(action.id,w=>({...w,widgets:w.widgets.filter(v=>v.instanceId!==action.instanceId)}));break;
 case 'update':result=edit(action.id,w=>({...w,widgets:settle(w.widgets.map(v=>v.instanceId===action.instanceId?{...v,...action.patch,instanceId:v.instanceId,widgetId:v.widgetId}:v),action.instanceId)}));break;
 }
 return normalizePreferences(result);
}
/** Fill the first free grid slot for newly added cards; edits retain explicit positions. */
export function placeNew(widgets:WidgetInstance[],value:WidgetInstance):WidgetInstance {
 const candidate=boundGeometry(value);
 for(let y=0;y<=240;y++)for(let x=0;x<=COLUMNS-candidate.width;x++){
  const next={...candidate,x,y};if(!widgets.some(w=>overlap(w,next)))return next;
 }
 return candidate;
}
export function createWidget(widgetId:WidgetId):WidgetInstance{const d=widgetDefinition(widgetId)!;return {instanceId:newId(),widgetId,x:0,y:0,width:d.defaultWidth,height:d.defaultHeight,config:{limit:5},surfaceOverride:'auto'};}
export const stackedOrder=(widgets:WidgetInstance[])=>[...widgets].sort((a,b)=>a.y-b.y||a.x-b.x||a.instanceId.localeCompare(b.instanceId));
