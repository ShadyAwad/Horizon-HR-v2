type Sample={frames:number;handlers:number;frameMs:number;handlerMs:number};
let active:Sample|null=null;
export const cursorProfileActive=()=>active!==null;
export function beginCursorProfile(){active={frames:0,handlers:0,frameMs:0,handlerMs:0};}
export function finishCursorProfile(){const sample=active;active=null;return sample;}
export function recordCursorWork(kind:'frame'|'handler',start:number){if(!active||!start)return;const duration=performance.now()-start;if(kind==='frame'){active.frames++;active.frameMs+=duration;}else{active.handlers++;active.handlerMs+=duration;}}
