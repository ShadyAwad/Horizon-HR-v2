import { normalizeQuery } from './intelligent-router';
export type EntityType = 'employee' | 'location';
export type EntitySpan = { start: number; end: number; type: EntityType };
export type EntityCandidate = { id: string; label: string };
export type EntityResolution = { type: EntityType; status: 'resolved' | 'ambiguous' | 'unresolved' | 'forbidden'; entityId?: string; label?: string; span?: EntitySpan; candidates?: EntityCandidate[]; truncated?: boolean; evaluated: number; latencyMs: number };
export type EntityRoute = { status: 'resolved' | 'ambiguous' | 'unresolved' | 'forbidden'; entities: EntityResolution[]; cases: { id: string; reference: string; title: string; status: string }[]; caseId?: string; locationMeaning: 'employee_current_team' };
export type EntityChoices = Partial<Record<EntityType | 'case', string>>;
export type EntityParameters = { employeeName?: string; locationName?: string };
export type EntityTemplate = { text: string; placeholders: EntitySpan[]; version: 1 };
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
 if(!template||typeof template.text!=='string'||template.text.length>500||template.version!==1||!Array.isArray(template.placeholders)||!template.placeholders.length||template.placeholders.length>2||template.placeholders.some((p,i)=>!['employee','location'].includes(p.type)||!Number.isInteger(p.start)||!Number.isInteger(p.end)||p.start<0||p.end>template.text.length||p.start>=p.end||template.text.slice(p.start,p.end)!=='{'+p.type+'}'||i>0&&p.start<template.placeholders[i-1].end))return false;
 const residual = template.text.replace(/\{(?:employee|location)\}/g, '');
 const vocabulary = new Set(normalizeQuery("show me find open the a an s disciplinary grievance grievances complaint complaints case for from at in employee please this current submitted triaged assigned in progress waiting resolved closed conduct وريني اعرض افتح شوف شكوى شكوي شكوه شكاوى الشكوى قضية قضيه تأديبية تاديبيه للموظف الموظف بتاعت بتاعة بتاع من في لو سمحت").split(' '));
 return entityTokens(residual).every(t => vocabulary.has(t.value));
}
