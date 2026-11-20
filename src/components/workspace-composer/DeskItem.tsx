import {lazy, useEffect, useRef, useState} from 'react';
import {SketchPreview} from '../document/SketchPreview';
import {validateSketch} from '../../lib/stanza-document';
import {useLanguage} from '../../lib/LanguageContext';
import type {DashboardNavigationItem} from '../../navigation/navigation-contracts';
import type {WidgetInstance} from './workspace-model';
import type {WidgetConfig} from './widget-catalog';
import type {WidgetResult} from './useWidgetData';

const SketchEditor=lazy(()=>import('../document/SketchEditor'));
const emptyDrawing={description:'',shapes:[]};
type Props={widget:WidgetInstance;module?:DashboardNavigationItem;onLaunch:()=>void;result?:WidgetResult;onSave:(config:WidgetConfig)=>void};

function DeskNote({value,label,hint,onSave}:{value:string;label:string;hint:string;onSave:(note:string)=>void}){
  const input=useRef<HTMLTextAreaElement>(null);
  const timer=useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending=useRef<string | null>(null);
  const save=useRef(onSave);
  save.current=onSave;
  const flush=()=>{
    clearTimeout(timer.current);
    if(pending.current===null)return;
    const note=pending.current;
    pending.current=null;
    save.current(note);
  };
  useEffect(()=>{
    window.addEventListener('pagehide',flush);
    return ()=>{window.removeEventListener('pagehide',flush);flush();};
  },[]);
  useEffect(()=>{if(input.current&&pending.current===null&&input.current.value!==value)input.current.value=value;},[value]);
  return <textarea ref={input} aria-label={label} className="desk-note" maxLength={4000} placeholder={hint} defaultValue={value} onBlur={flush} onChange={e=>{
    pending.current=e.currentTarget.value;
    clearTimeout(timer.current);
    timer.current=setTimeout(flush,450);
  }}/>;
}

export default function DeskItem({widget,module,onLaunch,result,onSave}:Props){
  const {isRtl}=useLanguage();
  const text=(en:string,ar:string)=>isRtl?ar:en;
  const [editing,setEditing]=useState(false);
  const [error,setError]=useState('');
  const config=widget.config;
  if(widget.widgetId==='shortcut')return <button className="desk-shortcut" type="button" onClick={onLaunch} disabled={!module}><span>{module?.icon}</span>{module?.label}</button>;
  if(widget.widgetId==='note')return <DeskNote value={config.note??''} label={text('Personal note','ملاحظة شخصية')} hint={text('Write a note…','اكتب ملاحظة…')} onSave={note=>onSave({...config,note})}/>;
  if(widget.widgetId==='sketch'){
    const drawing=config.drawing??emptyDrawing;
    return <div className="desk-sketch"><SketchPreview drawing={drawing}/><button type="button" onClick={()=>{setError('');setEditing(true);}}>{text('Edit sketch','تحرير الرسم')}</button>
      {editing&&<SketchEditor saveError={error} value={drawing} onClose={()=>setEditing(false)} onSave={next=>{
        if(!validateSketch(next)||JSON.stringify(next).length>48000){setError(text('Simplify the sketch before saving.','بسّط الرسم قبل الحفظ.'));return;}
        onSave({...config,drawing:next});setEditing(false);setError('');
      }}/>}
      </div>;
  }
  const equipment=config.source==='equipment';
  const sourceControl=<select aria-label={text('Data source','مصدر البيانات')} value={config.source??'support'} onChange={e=>onSave({...config,source:e.target.value==='equipment'?'equipment':'support',metric:'status',days:0})}>
    <option value="support">{text('Support tickets','طلبات الدعم')}</option><option value="equipment">{text('My equipment','عهدتي')}</option>
  </select>;
  const records=equipment?result?.data?.assets:result?.data?.tickets;
  if(!Array.isArray(records))return <>{sourceControl}<p role="status">{result?.error??text('Loading snapshot…','جار تحميل اللقطة…')}</p></>;
  const days=config.days??0;
  const rows=days&&!equipment?records.filter(row=>Date.parse(row.created_at)>=Date.now()-days*86400000):records;
  const counts=new Map<string,number>();
  for(const record of rows){
    const value=String((config.metric==='priority'?record.urgency:config.metric==='condition'?record.condition:record.status)??text('Unspecified','غير محدد')).replaceAll('_',' ');
    counts.set(value,(counts.get(value)??0)+1);
  }
  const entries=[...counts].sort((a,b)=>b[1]-a[1]);
  let offset=0;
  const parts=entries.map(([label,count],index)=>{
    const start=offset;offset+=count/rows.length*100;
    const color='color-mix(in srgb,var(--stanza-accent) '+Math.max(22,95-index*16)+'%,var(--stanza-surface-panel))';
    return {label,count,color,stop:color+' '+start+'% '+offset+'%'};
  });
  return <div className="desk-chart">
    <div className="desk-chart-tools">{sourceControl}
      <select aria-label={text('Metric','المقياس')} value={config.metric} onChange={e=>onSave({...config,metric:e.target.value==='status'?'status':equipment?'condition':'priority'})}><option value="status">{text('Status','الحالة')}</option><option value={equipment?'condition':'priority'}>{equipment?text('Condition','حالة العهدة'):text('Priority','الأولوية')}</option></select>
      <select aria-label={text('Chart style','نمط الرسم')} value={config.chartStyle} onChange={e=>onSave({...config,chartStyle:e.target.value==='donut'?'donut':'bars'})}><option value="bars">{text('Bars','أعمدة')}</option><option value="donut">{text('Donut','دائري')}</option></select>
      {!equipment&&<select aria-label={text('Opened within','تاريخ الفتح')} value={days} onChange={e=>onSave({...config,days:Number(e.target.value) as 0|7|30})}>{[0,7,30].map(n=><option key={n} value={n}>{n?n+' '+text('days','أيام'):text('All dates','كل التواريخ')}</option>)}</select>}
    </div>
    <p>{equipment?text('Assigned items','العهد المسندة'):text('Tickets in current snapshot','الطلبات في اللقطة الحالية')} · {rows.length}</p>
    {config.chartStyle==='donut'&&parts.length>0&&<div aria-hidden="true" className="desk-ring" style={{backgroundImage:'conic-gradient('+parts.map(r=>r.stop).join(',')+')'}}/>}
    <ul>{parts.map(r=><li key={r.label}><span>{r.label}</span><strong>{r.count}</strong>{config.chartStyle!=='donut'&&<i style={{width:(100*r.count/rows.length)+'%',background:r.color}}/>}</li>)}</ul>
  </div>;
}
