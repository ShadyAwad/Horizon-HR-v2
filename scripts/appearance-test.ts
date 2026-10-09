import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {readStanzaPreferences,applyInterfaceScale} from '../src/lib/StanzaPreferencesContext';
import {FONT_SCALES,normaliseFontScale,applyFontScale} from '../src/lib/typography';
import {DEFAULT_CUSTOM_THEME,deriveCustomTheme,contrastRatio,mixColor} from '../src/lib/custom-theme';
import {Select,Input} from '../src/components/ui/FormControls';
import {Surface} from '../src/components/ui/Surface';
assert.equal(readStanzaPreferences('{}').fontScale,1);
for(const fontScale of FONT_SCALES) for(const interfaceScale of [.85,1,1.2]) {
 const p=readStanzaPreferences(JSON.stringify({fontScale,interfaceScale,customTheme:{...DEFAULT_CUSTOM_THEME,textColor:'#123abc',cursorTrailLength:12}}));
 assert.equal(p.fontScale,fontScale);assert.equal(p.interfaceScale,interfaceScale);assert.equal(p.customTheme.textColor,'#123ABC');
 assert.deepEqual(readStanzaPreferences(JSON.stringify(p)),p);
}
for(const value of [0,9,'1.2',null,NaN,Infinity,1.15]) assert.equal(normaliseFontScale(value),1);
const old=readStanzaPreferences(JSON.stringify({interfaceScale:1.1,customTheme:{...DEFAULT_CUSTOM_THEME,accent:'#F12345',cursorTrailLength:12},backgroundPreset:'custom'}));
assert.equal(old.fontScale,1);assert.equal(old.customTheme.textColor,null);assert.equal(old.customTheme.accent,'#F12345');assert.equal(old.customTheme.cursorTrailLength,12);
const writes=new Map<string,string>();const original=globalThis.document;
Object.defineProperty(globalThis,'document',{configurable:true,value:{documentElement:{style:{setProperty:(k:string,v:string)=>writes.set(k,v)}}}});
applyFontScale(1.2);applyInterfaceScale(.85);assert.equal(writes.get('--stanza-font-scale'),'1.2');assert.equal(writes.get('--stanza-ui-scale'),'0.85');
Object.defineProperty(globalThis,'document',{configurable:true,value:original});
let checks=0;
for(const accent of ['#FFFFFF','#000000','#FF0000','#00FFFF','#FF00FF','#234567']) for(const textColor of ['#FFFFFF','#000000','#FF0000','#00FF00','#808080',null]) for(const mode of ['light','dark'] as const){
 const p=deriveCustomTheme({...DEFAULT_CUSTOM_THEME,accent,textColor},mode);const t=p.tokens;
 const surfaces=['page-bg','surface','surface-elevated','selected-surface','hover-surface','input-bg','dropdown-bg'].map(k=>t[k]);for(const alpha of [.08,.18,.24])surfaces.push(mixColor(t.surface,t['page-bg'],alpha),mixColor(t.surface,'#FFFFFF',alpha),mixColor(t.surface,'#000000',alpha));
 for(const k of ['text-primary','text-secondary','text-muted','text-disabled'])for(const surface of surfaces){assert(contrastRatio(t[k],surface)>=4.5,`${mode} ${accent} ${textColor} ${k}`);checks++;}
 assert(contrastRatio(t['primary-action'],t['primary-action-foreground'])>=4.5);
 if(textColor=== (mode==='light'?'#FFFFFF':'#000000'))assert(p.textAdjusted);
}
const css=fs.readFileSync('src/index.css','utf8');
assert(css.includes('prefers-reduced-transparency:reduce'));assert(css.includes('backdrop-filter:none'));assert(css.includes('max-width:48rem'));assert(css.includes('--text-xl:'));
for(const variant of ['auto','solid','glass'] as const) assert(renderToStaticMarkup(createElement(Surface,{variant},'Body')).includes(`data-surface="${variant}"`));
const select=renderToStaticMarkup(createElement(Select,{dir:'rtl',disabled:true,'aria-invalid':true,'aria-describedby':'help',name:'currency'},createElement('option',{value:'EGP'},'Egyptian pound')));
for(const token of ['<select','dir="rtl"','disabled','aria-invalid="true"','aria-describedby="help"','stanza-form-control'])assert(select.includes(token));
assert(renderToStaticMarkup(createElement(Input,{type:'date','aria-label':'Date'})).includes('type="date"'));
const expense=fs.readFileSync('src/components/expenses/ExpensesPanel.tsx','utf8');assert(expense.includes('payload.defaultCurrency'));assert(expense.includes('currency: defaultCurrency'));assert(!expense.includes("currency: 'EGP'"));assert(expense.includes('<Select'));assert(expense.includes('<Input'));
console.log(`PASS bounded font defaults, persistence, migration, independent CSS writes; ${checks} text/surface contrast checks; native RTL/error/disabled controls, surface variants/fallback and grievance bounds`);

for(const mode of ['light','dark'])for(const preset of ['emerald','slate','midnight','graphite','warm_sand','amethyst','ember']) {
 const selector=mode==='light'?':root[data-background-preset="'+preset+'"][data-theme="light"]':':root[data-background-preset="'+preset+'"]:not([data-theme="light"])';
 const blocks=css.split(selector+' {').slice(1);assert(blocks.length);const block=blocks.map(part=>part.slice(0,part.indexOf('}'))).join('\n');
 const colors=[...block.matchAll(/--stanza-(?:page-bg|surface|surface-elevated|selected-surface|hover-surface):\s*(#[0-9a-fA-F]{3,6})/g)].map(m=>m[1].length===4?'#'+[...m[1].slice(1)].map(c=>c+c).join(''):m[1]);
 const text=mode==='light'?['#172033','#26354A','#334155']:['#F1F5F9','#DBE6ED','#CBD5E1'];
 assert(colors.length>=4);for(const foreground of text)for(const surface of colors)assert(contrastRatio(foreground,surface)>=4.5,mode+' '+preset+' '+foreground+' '+surface);
}
console.log('PASS all seven preset text hierarchies on light and dark surfaces');



// Curated family preferences migrate independently from theme and either scale.
import {FONT_PROFILES,normaliseFontProfile,applyFontProfile} from '../src/lib/typography';
import vm from 'node:vm';
assert.equal(readStanzaPreferences('{}').fontProfile,'modern');
for(const invalid of [null,undefined,42,'future-font',{},'MODERN']) assert.equal(normaliseFontProfile(invalid),'modern');
for(const profile of FONT_PROFILES) {
  assert(profile.latin && profile.arabic);
  for(const backgroundPreset of ['emerald','amethyst','custom'] as const) {
    const p=readStanzaPreferences(JSON.stringify({...old,fontProfile:profile.id,backgroundPreset,fontScale:1.2,interfaceScale:.85}));
    assert.equal(p.fontProfile,profile.id);assert.equal(p.backgroundPreset,backgroundPreset);
    assert.equal(p.fontScale,1.2);assert.equal(p.interfaceScale,.85);
    assert.deepEqual(readStanzaPreferences(JSON.stringify(p)),p);
  }
  const root={dataset:{} as Record<string,string>,style:{setProperty:()=>{}},classList:{toggle:()=>{}}};
  vm.runInNewContext(fs.readFileSync('public/stanza-bootstrap.js','utf8'),{document:{documentElement:root},localStorage:{getItem:(key:string)=>key==='stanza.preferences.v1'?JSON.stringify({fontProfile:profile.id}):null}});
  assert.equal(root.dataset.fontProfile,profile.id);
}
const root={dataset:{} as Record<string,string>};
Object.defineProperty(globalThis,'document',{configurable:true,value:{documentElement:root}});
applyFontProfile('technical');assert.equal(root.dataset.fontProfile,'technical');
applyFontProfile('unknown');assert.equal(root.dataset.fontProfile,'modern');
Object.defineProperty(globalThis,'document',{configurable:true,value:original});
const fonts=fs.readFileSync('public/fonts/fonts.css','utf8');
for(const profile of FONT_PROFILES.filter(p=>p.id!=='system')) for(const family of [profile.latin,profile.arabic]) assert(fonts.includes("font-family: '"+family+"'"));
for(const file of [...fonts.matchAll(/url\(\/fonts\/([^)]*)\)/g)].map(m=>m[1])) assert.equal(fs.readFileSync('public/fonts/'+file).subarray(0,4).toString(),'wOF2');
assert(!fonts.includes('https://'));assert(fonts.includes('unicode-range'));
console.log('PASS curated family migration, round-trip persistence, theme/scale independence, bootstrap parity, explicit Arabic pairings and local WOFF2 assets');
