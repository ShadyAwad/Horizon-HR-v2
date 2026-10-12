import assert from 'node:assert/strict';
import {readStanzaPreferences} from '../src/lib/StanzaPreferencesContext';
import {BACKGROUND_STYLES,normaliseBackgroundStyle,normaliseBackgroundIntensity,normaliseThemeTransition} from '../src/lib/appearance-options';
import {themeReveal,transitionTheme} from '../src/lib/theme-transition';
const old=readStanzaPreferences(JSON.stringify({interfaceScale:1.15,fontScale:1.2,lanyardEnabled:false,backgroundPreset:'amethyst',customTheme:{accent:'#8844FF'}}));assert.equal(old.backgroundStyle,'topographic');assert.equal(old.themeTransition,'subtle');assert.equal(old.backgroundIntensity,'normal');assert.equal(old.interfaceScale,1.15);assert.equal(old.fontScale,1.2);assert.equal(old.backgroundPreset,'amethyst');assert.equal(old.customTheme.accent,'#8844FF');
for(const style of BACKGROUND_STYLES){const p=readStanzaPreferences(JSON.stringify({...old,backgroundStyle:style.id,backgroundIntensity:'quiet',themeTransition:'circle'}));assert.equal(p.backgroundStyle,style.id);assert.equal(p.backgroundIntensity,'quiet');assert.equal(p.themeTransition,'circle');}
for(const value of [null,{},[],999,'future']){assert.equal(normaliseBackgroundStyle(value),'topographic');assert.equal(normaliseBackgroundIntensity(value),'normal');assert.equal(normaliseThemeTransition(value),'subtle');}
for(const width of [390,820,1440,1920]){const reveal=themeReveal('circle',width,1000,20,20);assert(reveal.clipPath[1].includes(Math.hypot(width-20,980).toString()));}
assert.deepEqual(themeReveal('sweep',390,820,20,20,true),{clipPath:['inset(0 0 0 100%)','inset(0 0 0 0)']});assert.deepEqual(themeReveal('subtle',390,820,0,0),{opacity:[0,1]});
console.log('PASS appearance defaults/migration, persistence, unsupported values and bounded RTL reveal geometry');

const originals=new Map(['document','matchMedia','innerWidth','innerHeight'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
let updates=0,started=0,skipped=0,reduce=false;
const completions:Array<()=>void>=[],animations:any[]=[];
const root:any={dataset:{themeTransition:'circle'},dir:'rtl',animate:(keys:any,options:any)=>{animations.push({keys,options});}};
const doc:any={documentElement:root,hidden:false};
try{
 Object.defineProperty(globalThis,'document',{configurable:true,value:doc});Object.defineProperty(globalThis,'matchMedia',{configurable:true,value:()=>({matches:reduce})});Object.defineProperty(globalThis,'innerWidth',{configurable:true,value:390});Object.defineProperty(globalThis,'innerHeight',{configurable:true,value:820});
 transitionTheme(()=>updates++);assert.equal(updates,1);assert.equal(root.dataset.themeTransitionRunning,undefined);
 doc.startViewTransition=(update:()=>void)=>{started++;update();let finish!:()=>void;const finished=new Promise<void>(resolve=>{finish=resolve});completions.push(finish);return {ready:Promise.resolve(),finished,skipTransition:()=>{skipped++;finish();}};};
 reduce=true;transitionTheme(()=>updates++);assert.equal(started,0);reduce=false;doc.hidden=true;transitionTheme(()=>updates++);assert.equal(started,0);doc.hidden=false;
 transitionTheme(()=>updates++);transitionTheme(()=>updates++);await new Promise(resolve=>setImmediate(resolve));assert.equal(started,2);assert.equal(skipped,1);assert.equal(root.dataset.themeTransitionRunning,'true');assert.equal(animations.length,1);assert.equal(animations[0].options.duration,220);completions[1]();await new Promise(resolve=>setImmediate(resolve));assert.equal(root.dataset.themeTransitionRunning,undefined);
 console.log('PASS unsupported/reduced-motion/hidden fallback and rapid-transition cancellation/cleanup');
}finally{for(const [key,value] of originals){if(value)Object.defineProperty(globalThis,key,value);else Reflect.deleteProperty(globalThis,key);}}
