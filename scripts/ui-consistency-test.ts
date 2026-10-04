import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {visitDestination,historyTarget} from '../src/components/navigation/navigation-history';
import {validatePlannedBreaks} from '../src/lib/roster-breaks';
import {DEFAULT_CUSTOM_THEME,normaliseCustomTheme,deriveCustomTheme,contrastRatio} from '../src/lib/custom-theme';
import {defaultPreferences,reduceComposer,readPreferences} from '../src/components/workspace-composer/workspace-model';
import {Surface} from '../src/components/ui/Surface';
import {PlannedBreakEditor} from '../src/components/roster/PlannedBreakEditor';
let history={entries:['geofence'],index:0};
for(const id of ['roster','performance','assets','composer:one','composer:two'])history=visitDestination(history,id);
assert.equal(visitDestination(history,'composer:two'),history);
assert.equal(historyTarget(history,-1,()=>true),4);
history={...history,index:2};assert.equal(historyTarget(history,1,id=>id!=='assets'),4);
history=visitDestination(history,'feed');assert.deepEqual(history.entries,['geofence','roster','performance','feed']);
assert.equal(historyTarget({entries:['direct'],index:0},-1,()=>true),null);
for(let i=0;i<100;i++)history=visitDestination(history,String(i));assert.equal(history.entries.length,50);
assert.equal(normaliseCustomTheme({accent:'#123456'}).hoverHighlight,null);
for(const mode of ['light','dark'] as const)for(const hoverHighlight of ['#FFFFFF','#000000','#FF0000','#151D29']) {
 const config=normaliseCustomTheme({...DEFAULT_CUSTOM_THEME,hoverHighlight,cursorTrailLength:12});assert.equal(config.hoverHighlight,hoverHighlight);
 const p=deriveCustomTheme(config,mode),t=p.tokens;
 assert(contrastRatio(t['text-primary'],t['hover-surface'])>=4.5);
 assert(contrastRatio(t['hover-surface'],t.surface)>=1.15);
 assert.notEqual(t['hover-surface'],t['selected-surface']);
 assert.notEqual(t['focus-ring'],t['hover-surface']);
}
const css=fs.readFileSync('src/index.css','utf8');
assert.match(css,/@media \(prefers-reduced-transparency:reduce\),\(prefers-reduced-motion:reduce\),\(max-width:899px\) \{\s*\.stanza-surface\[data-surface=transparent\] \{background:var\(--stanza-surface\)\}/);
let preferences=reduceComposer(defaultPreferences(),{type:'surface',value:'transparent'});
assert.equal(readPreferences(JSON.stringify(preferences)).surface,'transparent');
for(const variant of ['solid','glass','auto','transparent'] as const)assert.match(renderToStaticMarkup(createElement(Surface,{variant})),new RegExp('data-surface="'+variant+'"'));
const start=new Date('2026-10-05T06:00:00Z'),end=new Date('2026-10-05T14:00:00Z');
const a={startTime:'2026-10-05T07:00:00Z',endTime:'2026-10-05T07:15:00Z'},b={startTime:'2026-10-05T09:00:00Z',endTime:'2026-10-05T09:30:00Z'};
assert.equal(validatePlannedBreaks([b,a],start,end)[0].startTime,new Date(a.startTime).toISOString());
assert.deepEqual(validatePlannedBreaks([],start,end),[]);
for(const invalid of [null,[{}],Array(9).fill(a),[a,a],[{...a,endTime:a.startTime}],[{...a,startTime:'2026-10-05T05:00:00Z'}],[{...a,endTime:'2026-10-05T15:00:00Z'}]])assert.throws(()=>validatePlannedBreaks(invalid,start,end));
for(const isRtl of [false,true]) {
 const markup=renderToStaticMarkup(createElement(PlannedBreakEditor,{value:[{start:'10:00',end:'10:15'},{start:'12:00',end:'12:30'}],editable:true,isRtl,shiftDate:'2026-10-05',onSave:()=>{}}));
 assert.match(markup,/type="time"/);assert.equal((markup.match(/type="time"/g)||[]).length,4);
 assert.match(markup,new RegExp('dir="'+(isRtl?'rtl':'ltr')+'"'));
}
console.log('PASS bounded navigation history, no-op/branching/permissions/direct-load behavior, hover contrast/persistence, surface persistence, planned-break ordering/bounds/overlap/limits and accessible RTL editor');
