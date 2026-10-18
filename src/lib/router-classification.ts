import {normalizeQuery} from './router-normalization';
/** Vocabulary repair is for intent tokens only. Entity spans remain untouched by callers. */
const vocabulary=['attendance','employee','employees','assets','equipment','interview','interviews','support','tickets','remaining','messages','expense','expenses','grievance','leave','vacation','schedule','my','clock','shift','assigned','unresolved'];
function distance(a:string,b:string){if(Math.abs(a.length-b.length)>1)return 2;let previous=Array.from({length:b.length+1},(_,i)=>i);for(let i=0;i<a.length;i++){const next=[i+1];for(let j=0;j<b.length;j++)next.push(Math.min(next[j]+1,previous[j+1]+1,previous[j]+Number(a[i]!==b[j])));previous=next;}return previous[b.length];}
export function classificationQuery(raw:string,protectedWords:ReadonlySet<string>=new Set()){
 const text=normalizeQuery(raw);
 const synonyms:Record<string,string>={equipmnet:'equipment',remaing:'remaining','وريني':'show','لي':'me'};
 const words=text.split(' ').map(word=>protectedWords.has(word)?word:synonyms[word]??word);return words.map((word,i)=>{if(protectedWords.has(word)||vocabulary.includes(word)||!/[a-z]/.test(word)||word.length<5&&word!=='myy')return word;
 // Names following relational prepositions must never be silently spelling-corrected.
 if(i>0&&['for','named','called','بتاع','بتاعت','بتاعه'].includes(words[i-1]))return word;
 const matches=vocabulary.filter(v=>distance(word,v)===1||(word.length>=6&&v.length===word.length&&[...word].some((_,j)=>j+1<word.length&&word.slice(0,j)+word[j+1]+word[j]+word.slice(j+2)===v)));
 return matches.length===1?matches[0]:word;
 }).join(' ');
}

/** Complete first-person instruction grammar; never a presence read or a clock mutation. */
export function instructionIntent(raw:string){
 const q=normalizeQuery(raw),words=q.split(' ');
 const cue=/^(?:how (?:do|can|to)|explain how|instructions? (?:for|to)|ازاي|كيف)/u.test(q);
 if(!cue)return;
 const allowed=new Set('how do can to i my the a at of from for in out work working day session attendance start end sign off on shift after before help explain record register finish finishing beginning check clock instructions is me ازاي اسجل اثبت انصرافي حضوري من الشغل كيف تسجيل الخروج الدخول في نهايه بدايه اليوم'.split(' '));
 if(words.some(w=>!allowed.has(w)))return;
 const departure=/clock out|check out|sign off|record the end|record end|اسجل انصرافي|اثبت انصرافي|تسجيل الخروج/u.test(q);
 const arrival=/clock in|check in|start my attendance|register arrival|اسجل حضوري|اثبت حضوري|تسجيل الدخول/u.test(q);
 return departure===arrival?undefined:departure?'clock_out_help':'clock_in_help';
}

/** Small fully-consumed read grammars. Unknown names/modifiers and competing selectors are not discarded. */
export function readGrammarIntent(raw:string){
 const q=classificationQuery(raw),tokens=q.split(' '),has=(pattern:RegExp)=>pattern.test(q);
 const common='what whats is are do i my me the a an of from for to in on all only one at how much many show open list view browse find retrieve please can you could would like take where لدي لي بتاعي بتاعتي انا ما من في كام اعرض وريني شوف فتح افتح';
 const consume=(vocabulary:string)=>tokens.every(t=>new Set((common+' '+vocabulary).split(' ')).has(t));
 if(has(/(?:^| )(?:my|me|لي|بتاعي|بتاعتي|عهدتي)(?: |$)/u)&&has(/equipment|assets|devices|hardware|laptop|عهدتي|معدات|اجهزه/u)&&consume('equipment assets devices hardware laptop laptops issued assigned account custody list currently checked out company own work equipment معدات اجهزه عهدتي'))return 'my_assets';
 if(has(/(?:^| )(?:my|شكواي|شكوتي)(?: |$)/u)&&has(/grievance|complaint|شكواي|شكوتي/u)&&has(/status|progress|processing|stage|حاله|متابعه/u)&&consume('grievance complaint case status progress processing stage submitted حاله متابعه شكواي شكوتي'))return 'grievance_status';
 const leave='leave vacation pto annual days day time off balance allowance remaining unused entitlement رصيد المتبقي المتبقيه باقي فاضلي اجازه اجازات اجازتي اجازاتي استحقاقي يوم ايام';
 if(has(/(?:^| )(?:leave|vacation|pto|اجازه|اجازات|اجازتي|اجازاتي)(?: |$)/u)&&has(/(?:^| )(?:balance|allowance|remaining|unused|رصيد|المتبقي|المتبقيه|باقي|فاضلي)(?: |$)/u)&&consume(leave))return 'leave_balance';
 if(has(/^(?:open|show|view|start|افتح|اعرض) /u)&&has(/(?:^| )(?:form|نموذج|استماره)(?: |$)/u)&&has(/(?:^| )(?:leave|vacation|time off|اجازه)(?: |$)/u)&&consume(leave+' form application request start نموذج استماره طلب تقديم'))return 'request_leave';
 const payroll='payslip payslips salary wage payroll payment slip slips statements statement period periods past previous history archive archived newest latest recent most كل قسايم المرتب راتب راتبي سابقه احدث اخر';
 const collection=has(/(?:^| )(?:all|every|archive|archived|history|كل)(?: |$)/u),latest=has(/(?:^| )(?:latest|newest|recent|احدث|اخر)(?: |$)/u);
 if(collection!==latest&&has(/payslips?|(?:salary|wage|payroll) (?:payment )?(?:slips?|statements?)|قسايم المرتب/u)&&consume(payroll+' every get'))return latest?'latest_payslip':'payslips';
 if(has(/(?:^| )(?:meetings|اجتماعات|اجتماعاتي|ميتنجات)(?: |$)/u)&&has(/(?:^| )(?:tomorrow|بكره|غدا)(?: |$)/u)&&consume('meetings meeting schedule calendar appointments tomorrow اجتماعات اجتماعاتي ميتنجات مواعيد بكره غدا عندي بتاعت'))return 'tomorrow_meetings';
}

/** Bounded complete operational read clauses. Entity slots are resolved later; never become SQL identifiers. */
export function operationalReadIntent(raw:string){
 const q=classificationQuery(raw),words=q.split(' '),has=(p:RegExp)=>p.test(q);
 if(/^(?:who|which|how many|مين) /u.test(q)&&/(?:not|hasn t|haven t) clocked in|لم يسجل.*حضور|ماسجلش حضور/u.test(q)&&q.split(' ').every(w=>new Set('who which how many people employees has have not hasn haven t clocked in yet today team my our مين اللي ماسجلش حضور لم يسجل اليوم النهارده'.split(' ')).has(w)))return 'not_clocked_in_today';
 const fillers='who which what is are has have any anyone employees people members on of the a an in to for me my our team show list find view please now currently today tomorrow this next week days with all does how many هل انا مين ايه كام في من علي اللي لسه بتاع بتاعت وريني اعرض فريقي اليوم النهارده بكره غدا الاسبوع ده الجاي القادم هذا';
 const consumes=(vocabulary:string)=>{const allowed=new Set((fillers+' '+vocabulary).split(' '));return words.every(w=>allowed.has(w));};
 if(has(/(?:leave|vacation|time off|اجازه|اجازات)/u)&&has(/^(?:who|which|anyone|مين|اعرض|وريني) /u)&&consumes('leave vacation time off approved authorized authorised taking booked out اجازته اجازات اجازه معتمده واخد'))return 'team_approved_leave';
 if(has(/(?:^| )(?:team|فريقي|الفريق)(?: |$)/u)&&has(/schedule|shifts|roster|scheduled|جدول|مناوبات/u)&&consumes('schedule schedules shifts shift roster scheduled upcoming جدول مناوبات مواعيد الفريق'))return 'team_schedule';
 if(has(/(?:^| )(?:my|مناوباتي)(?: |$)/u)&&has(/shifts|roster|مناوباتي/u)&&has(/week|upcoming|الاسبوع|القادمه/u)&&consumes('shifts roster scheduled upcoming مناوباتي القادمه خلال الحالي'))return 'my_schedule';
 if(has(/my|انا/u)&&has(/clocked in|clock status|attendance status|on break|مسجل حضور/u)&&consumes('clocked clock attendance status in out break on حاليا حضور مسجل ولا لا'))return 'my_attendance_status';
 if(has(/equipment|assets|inventory|معدات|اجهزه/u)&&has(/unassigned|available|damaged|broken|غير مسنده|متاحه|تالفه/u)&&consumes('equipment assets inventory unassigned available damaged broken condition معدات اجهزه غير مسنده متاحه تالفه'))return 'asset_inventory_query';
 if(has(/offices|locations|مكاتب|مواقع/u)&&consumes('offices locations office company available names اسامي مكاتب مواقع الشركه المتاحه'))return 'location_directory';
 if(has(/interviews|مقابلات/u)&&has(/upcoming|future|coming|قادمه|القادمه|المستقبليه/u)&&consumes('interviews upcoming future coming recruitment candidate month مقابلات القادمه قادمه التوظيف المستقبليه للمرشحين'))return 'hiring_upcoming_interviews';
 const name=String.raw`[\p{L}\p{M}][\p{L}\p{M}\p{N}'-]*(?: [\p{L}\p{M}][\p{L}\p{M}\p{N}'-]*){0,4}`;
 if(new RegExp('^(?:show|list|view)(?: me)? '+name+' s (?:equipment|assets|devices|hardware)$','u').test(q))return 'employee_equipment';
 if(!has(/(?:^| )(?:my|me|myself|انا)(?: |$)/u)&&new RegExp('^(?:who is (?:the )?(?:manager|supervisor) (?:of|for)|what is (?:the )?(?:department|team|job title|location) (?:of|for)|who manages) '+name+'$','u').test(q))return 'employee_directory_lookup';
 if(new RegExp('^(?:who reports to|list (?:the )?direct reports (?:of|for)) '+name+'$','u').test(q))return 'manager_direct_reports';
}
/** Unsupported action requests stay outside the read-only grammar. */
export function unsupportedReadQuery(raw:string){const q=normalizeQuery(raw).replace(/^(?:please |can you |could you |i want you to )/u,'');return /^(?:buy|purchase|transfer|provision|erase|reset|run)(?: |$)/u.test(q)||/^(?:pay|send) .*(?:money|salary|cash|dollars|فلوس)/u.test(q)||/(?:ignore|bypass) (?:the )?(?:permissions|authorization|security)/u.test(q);}
export function negativePresence(raw:string){return /(?:not|hasn t|haven t) clocked in|لم يسجل.*حضور|ماسجلش حضور/u.test(normalizeQuery(raw));}
/** Opposing clock directions require clarification, irrespective of embedding confidence. */
export function conflictingClockDirections(raw:string){const q=normalizeQuery(raw);return /clock(?:ing)? in|check in|sign in|تسجيل الدخول|اسجل حضوري/u.test(q)&&/clock(?:ing)? out|check out|sign off|تسجيل الخروج|اسجل انصرافي/u.test(q);}
/** A presentation phrase (show me X) is not an ownership declaration. */
export function ownEntityReference(raw:string){const q=normalizeQuery(raw);return /(?:^| )(?:my|لي|بتاعتي|بتاعي|عهدتي)(?: |$)|(?:^| )(?:to|for) me(?: |$)|الخاصه بي/u.test(q);}
