import {LOCAL_MODEL,LOCAL_VERSION} from './local-embedding';
import {normalizeQuery} from '../../lib/intelligent-router';
import {safeEntityTemplate,type EntityTemplate} from '../../lib/router-entities';
import type {PoolClient} from 'pg';
import type {EmbeddingProvider} from './providers';
export type DuplicateClass='safe_new'|'exact_duplicate'|'near_duplicate'|'cross_intent_conflict'|'sensitive'|'needs_review';
// Deliberately conservative grammar: unknown proper nouns/free text stay private. No provider sees text for privacy assessment.
const generic=new Set(normalizeQuery('when is payday when do we get paid what date salary payment payroll check next my the a an please show me open view find employee employees grievance grievances complaint disciplinary case from at in for leave balance remaining days time off request attendance roster schedule shift expense expenses reimbursement receipt company feed news meetings upcoming assets equipment loan loans payslip history status approved pending rejected closed resolved escalated low normal high urgent overdue settings theme font size appearance navigation profile team department location warehouse office colleague belonging to can i see got pay paid on how much many are left this month week today tomorrow امتى بنقبض القبض الراتب المرتب موعد صرف راتبي اعرض افتح وريني شوف شكوى الشكوى شكوي قضية قضيه تاديبيه بتاعت بتاع من في للموظف الموظف اجازة رصيد الاجازات باقي كام يوم الحضور جدول المصروفات اجتماعات رواتب امتي بنقبض').split(' '));
export function sanitizeShared(text:string,template?:EntityTemplate|null){
 if(typeof text!=='string'||text.length>500||!text.trim())return false;
 if(/@|\p{N}|\+|https?:|\b(?:medical|diagnosis|cancer|address|confidential)\b/iu.test(text))return false;
 if(template)return safeEntityTemplate(template)&&normalizeQuery(template.text)===normalizeQuery(text);
 if(/[{}]/u.test(text))return false;
 return normalizeQuery(text).split(' ').every(t=>generic.has(t));
}
export const duplicateBoundary=(p:EmbeddingProvider)=>p.model===LOCAL_MODEL&&p.version===LOCAL_VERSION?.97:.995;
export async function analyzeExample(c:PoolClient,tenant:string,text:string,intent:string,p:EmbeddingProvider,vector?:number[]){
 const exact=(await c.query(`SELECT id,intent_key,example_text,scope,1::float8 similarity FROM router_semantic_examples WHERE approval_state='approved' AND normalized_text=$1 AND embedding_model=$2 AND embedding_dimensions=$3 AND embedding_version=$4 AND (tenant_id IS NULL OR tenant_id=$5) LIMIT 8`,[normalizeQuery(text),p.model,p.dimensions,p.version,tenant])).rows;
 if(exact.length)return {classification:(exact.some(r=>r.intent_key!==intent)?'cross_intent_conflict':'exact_duplicate') as DuplicateClass,nearest:exact,coverage:0};
 const v=vector??await p.embed(normalizeQuery(text));
 const nearest=(await c.query(`WITH space AS MATERIALIZED(SELECT id,intent_key,example_text,scope,embedding FROM router_semantic_examples WHERE approval_state='approved' AND embedding_model=$2 AND embedding_dimensions=$3 AND embedding_version=$4 AND (tenant_id IS NULL OR tenant_id=$5)) SELECT id,intent_key,example_text,scope,1-(embedding <=> $1::vector) similarity FROM space ORDER BY embedding <=> $1::vector LIMIT 8`,[JSON.stringify(v),p.model,p.dimensions,p.version,tenant])).rows;
 const same=nearest.filter(r=>r.intent_key===intent),cross=nearest.filter(r=>r.intent_key!==intent);
 // Conservative duplicate-only boundary; routing acceptance (.84/.10) remains unchanged. Review shows actual similarities.
 const boundary=duplicateBoundary(p);
 // Pinned local measurements: useful payday variants .702/.721/.886; opposing payslip .496. Unknown spaces use an even more conservative boundary until calibrated.
 const classification:DuplicateClass=cross.some(r=>Number(r.similarity)>=boundary)?'cross_intent_conflict':same.some(r=>Number(r.similarity)>=boundary)?'near_duplicate':'safe_new';
 return {classification,nearest,duplicateBoundary:boundary,coverage:1-Number(same[0]?.similarity??0)};
}

export async function safeForTenant(c:PoolClient,tenant:string,text:string,template?:EntityTemplate|null){
 if(!sanitizeShared(text,template))return false;
 const normalized=' '+normalizeQuery(text)+' ';
 // Only a boolean leaves the database. Known company/person/site names are never returned to the platform reviewer.
 const known=(await c.query(`SELECT EXISTS(SELECT 1 FROM tenants WHERE id=$1 AND length(stanza_entity_normalize(company_name))>=3 AND position(' '||stanza_entity_normalize(company_name)||' ' in $2)>0 UNION ALL SELECT 1 FROM employees WHERE tenant_id=$1 AND length(stanza_entity_normalize(full_name))>=3 AND position(' '||stanza_entity_normalize(full_name)||' ' in $2)>0 UNION ALL SELECT 1 FROM company_locations WHERE tenant_id=$1 AND length(stanza_entity_normalize(name))>=3 AND position(' '||stanza_entity_normalize(name)||' ' in $2)>0) AS sensitive`,[tenant,normalized])).rows[0].sensitive;
 return !known;
}
