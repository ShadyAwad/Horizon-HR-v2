/** Mirrors existing transitions for presentation; the API remains authoritative. */
const transitions:Record<string,string[]>={open:['in_progress','waiting_requester','resolved'],in_progress:['waiting_requester','resolved'],waiting_requester:['in_progress','resolved'],resolved:['closed','in_progress'],closed:[]};
export function supportStatusOptions(status:string){return [status,...(transitions[status]||[])];}
export function supportAge(createdAt:string,language='en',now=Date.now()){
 const elapsed=Math.max(0,now-Date.parse(createdAt));
 if(!Number.isFinite(elapsed))return '';
 const minutes=Math.floor(elapsed/60000),hours=Math.floor(minutes/60),days=Math.floor(hours/24);
 return new Intl.RelativeTimeFormat(language,{numeric:'always'}).format(-(days||hours||minutes),days?'day':hours?'hour':'minute');
}

/** Compact visual age; callers retain the full relative age for assistive text. */
export function supportAgeCompact(createdAt:string,language='en',now=Date.now()){
 const elapsed=Math.max(0,now-Date.parse(createdAt));
 if(!Number.isFinite(elapsed))return '';
 const minutes=Math.floor(elapsed/60000),hours=Math.floor(minutes/60),days=Math.floor(hours/24);
 return new Intl.NumberFormat(language,{style:'unit',unit:days?'day':hours?'hour':'minute',unitDisplay:'narrow'}).format(days||hours||minutes);
}
