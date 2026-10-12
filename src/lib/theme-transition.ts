import type {ThemeTransitionMode} from './appearance-options';
export function themeReveal(mode:ThemeTransitionMode,width:number,height:number,x:number,y:number,rtl=false){
 if(mode==='circle'){const radius=Math.hypot(Math.max(x,width-x),Math.max(y,height-y));return {clipPath:[`circle(0px at ${x}px ${y}px)`,`circle(${radius}px at ${x}px ${y}px)`]};}
 if(mode==='sweep')return {clipPath:[rtl?'inset(0 0 0 100%)':'inset(0 100% 0 0)','inset(0 0 0 0)']};
 return {opacity:[0,1]};
}
let active:ViewTransition|null=null;
export function transitionTheme(update:()=>void,origin?:HTMLElement){
 const root=document.documentElement,mode=root.dataset.themeTransition as ThemeTransitionMode|undefined;
 active?.skipTransition();
 if(!document.startViewTransition||mode==='none'||matchMedia('(prefers-reduced-motion: reduce)').matches||document.hidden){update();return;}
 const box=origin?.getBoundingClientRect();const x=box?box.x+box.width/2:innerWidth/2,y=box?box.y+box.height/2:innerHeight/2;
 try{
  root.dataset.themeTransitionRunning='true';const transition=document.startViewTransition(update);active=transition;
  void transition.ready.then(()=>{if(active!==transition)return;root.animate(themeReveal(mode||'subtle',innerWidth,innerHeight,x,y,root.dir==='rtl'),{duration:mode==='subtle'?160:220,easing:'cubic-bezier(.2,.7,.2,1)',pseudoElement:'::view-transition-new(root)'});}).catch(()=>{});
  void transition.finished.catch(()=>{}).then(()=>{if(active===transition){active=null;delete root.dataset.themeTransitionRunning;}});
 }catch{active=null;delete root.dataset.themeTransitionRunning;update();}
}
