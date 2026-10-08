import { normalizeQuery } from './router-normalization';
export type EntityType = 'employee' | 'location' | 'asset' | 'job_opening' | 'candidate';
export type EntitySpan = { start: number; end: number; type: EntityType };
export type EntityCandidate = { id: string; label: string };
export type EntityResolution = { type: EntityType; status: 'resolved' | 'ambiguous' | 'unresolved' | 'forbidden'; entityId?: string; label?: string; span?: EntitySpan; candidates?: EntityCandidate[]; truncated?: boolean; evaluated: number; latencyMs: number };
export type EntityRoute = { status: 'resolved' | 'ambiguous' | 'unresolved' | 'forbidden'; entities: EntityResolution[]; cases: { id: string; reference: string; title: string; status: string }[]; caseId?: string; summary?:string; items?:{id:string;label:string;detail?:string}[]; total?:number; prefill?:{assetId:string;assetName:string;requesterId:string;summary:string;description:string}; candidateId?:string; operational?:{kind:'single_intent'|'entity'|'filtered'|'composition';plan:import('./operational-plan').OperationalPlan;timeZone:string;dateWindow:{from?:string;to?:string}}; locationMeaning: 'employee_current_team' };
export type EntityChoices = Partial<Record<EntityType | 'case', string>>;
export type EntityParameters = { employeeName?: string; locationName?: string; assetName?:string; jobName?:string; candidateName?:string;plan?:import('./operational-plan').OperationalPlan };
export type EntityTemplate = { text: string; placeholders: (Omit<EntitySpan,'type'> & {type:EntityType|'duration'|'date_range'})[]; version: 1 };
// Offsets refer to the original UTF-16 string, including Arabic diacritics.
export function entityTokens(text: string) {
 return [...text.matchAll(/[\p{L}\p{N}\p{M}]+/gu)].map(m => ({ value: normalizeQuery(m[0]), start: m.index!, end: m.index! + m[0].length })).filter(t => t.value);
}
export function findEntitySpan(query: string, label: string, type: EntityType): EntitySpan | undefined {
 const tokens = entityTokens(query), needle = entityTokens(label).map(t => t.value);
 if (!needle.length) return;
 for (let i = 0; i <= tokens.length - needle.length; i++) if (needle.every((v, j) => tokens[i + j].value === v)) return { type, start: tokens[i].start, end: tokens[i + needle.length - 1].end };
}
/** Replace actual non-overlapping spans, never arbitrary substrings or model text. */
export function generalizeEntities(query: string, resolutions: EntityResolution[]): EntityTemplate | undefined {
 const spans = resolutions.filter(r => r.status === 'resolved').map(r => r.span);
 if (!spans.length || spans.some(s => !s)) return;
 const sorted = (spans as EntitySpan[]).sort((a, b) => a.start - b.start || b.end - a.end);
 if (sorted.some((s, i) => s.start < 0 || s.end > query.length || s.start >= s.end || i > 0 && s.start < sorted[i - 1].end)) return;
 let text = '', offset = 0;
 const placeholders: EntitySpan[] = [];
 for (const span of sorted) { text += query.slice(offset, span.start); const start = text.length; text += `{${span.type}}`; placeholders.push({ type: span.type, start, end: text.length }); offset = span.end; }
 return { text: text + query.slice(offset), placeholders, version: 1 };
}
/** Unidentified residual names cannot enter learning. */
export function safeEntityTemplate(template: EntityTemplate) {
 if(!template||typeof template.text!=='string'||template.text.length>500||template.version!==1||!Array.isArray(template.placeholders)||!template.placeholders.length||template.placeholders.length>6||template.placeholders.some((p,i)=>!['employee','location','asset','job_opening','candidate','duration','date_range'].includes(p.type)||!Number.isInteger(p.start)||!Number.isInteger(p.end)||p.start<0||p.end>template.text.length||p.start>=p.end||template.text.slice(p.start,p.end)!=='{'+p.type+'}'||i>0&&p.start<template.placeholders[i-1].end))return false;
 const residual = template.text.replace(/\{(?:employee|location|asset|job_opening|candidate|duration|date_range)\}/g, '');
 const vocabulary = new Set(normalizeQuery("which older than days day created last tomorrow this week next starting starts new hires still need equipment pending accounts access first shift assigned badge onboarding tasks overdue blocked feedback expiring without applicants incomplete accepted offers employees waiting users today how many no for damaged laptops what laptop is using equipment does have who has assigned report as damaged broken it support tickets requests unresolved jobs applicants candidates offer screening interviews today how many with for backend engineer موظفين جدد الموظفين الجدد محتاجين معدات متاخره متاخر اليوم النهارده بكره هذا الاسبوع الاسبوع ده القادم الجاي اكتر اكثر ايام يوم من غير محلوله بانتظار التقييم مستنيين معاه لابتوب ايه الجهاز ده مع مين طلبات دعم تقني مفتوحه تذاكر وظائف مرشحين مقابلات عروض show me find open the a an s disciplinary grievance grievances complaint complaints case for from at in employee please this current submitted triaged assigned in progress waiting resolved closed conduct وريني اعرض افتح شوف شكوى شكوي شكوه شكاوى الشكوى قضية قضيه تأديبية تاديبيه للموظف الموظف بتاعت بتاعة بتاع من في لو سمحت").split(' '));
 return entityTokens(residual).every(t => vocabulary.has(t.value));
}

export function generalizeOperationalQuery(query:string,entities:EntityResolution[]):EntityTemplate|undefined{const spans:(Omit<EntitySpan,'type'>&{type:EntityType|'duration'|'date_range'})[]=entities.filter(e=>e.status==='resolved'&&e.span).map(e=>e.span!);for(const m of query.matchAll(/\b\d{1,3} days?\b|[٠-٩0-9]{1,3} (?:أيام|ايام|يوم)/giu))spans.push({start:m.index!,end:m.index!+m[0].length,type:'duration'});for(const m of query.matchAll(/today|tomorrow|this week|next week|اليوم|النهارده|غدا|بكره|هذا الأسبوع|هذا الاسبوع|الأسبوع ده|الاسبوع ده|الأسبوع القادم|الاسبوع القادم|الاسبوع الجاي/giu))spans.push({start:m.index!,end:m.index!+m[0].length,type:'date_range'});if(!spans.length)return;spans.sort((a,b)=>a.start-b.start);if(spans.some((s,i)=>i>0&&s.start<spans[i-1].end))return;let text='',offset=0;const placeholders:EntityTemplate['placeholders']=[];for(const s of spans){text+=query.slice(offset,s.start);const start=text.length;text+='{'+s.type+'}';placeholders.push({type:s.type,start,end:text.length});offset=s.end;}const template:EntityTemplate={text:text+query.slice(offset),placeholders,version:1};return safeEntityTemplate(template)?template:undefined;}
