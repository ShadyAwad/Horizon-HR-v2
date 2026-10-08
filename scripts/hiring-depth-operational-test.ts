import assert from 'node:assert/strict';
import { validateQuestions, validateAnswers, publicQuestions, validateTemplate } from '../src/lib/hiring-depth';
import { parseOperationalPlan, validateOperationalPlan, resolveDateWindow, operationalIntent } from '../src/lib/operational-plan';
import { validateReasoning } from '../src/server/intelligent-router/providers';
import { generalizeOperationalQuery, safeEntityTemplate } from '../src/lib/router-entities';
import { resolveQuery } from '../src/server/intelligent-router/router';
const qs = validateQuestions([{ id: 'authorized', label: 'Work authorization?', type: 'yes_no', required: true, screening: { expected: true, hardRequirement: true } }, { id: 'availability', label: 'Hours?', type: 'numeric', required: true, screening: { expected: 20, hardRequirement: false } }, { id: 'tools', label: 'Tools?', type: 'multi_select', required: true, options: ['A', 'B'] }]);
assert(!('screening' in publicQuestions(qs)[0]));
assert.throws(() => validateAnswers(qs, { authorized: true, availability: 20, tools: ['C'] }));
assert.throws(() => validateAnswers(qs, { authorized: 'true', availability: 20, tools: ['A'] }));
assert.throws(() => validateAnswers(qs, { authorized: true, availability: 20, tools: ['A'], tenant: 'foreign' }));
assert.equal(validateAnswers(qs, { authorized: false, availability: 10, tools: ['A'] }).flags.length, 2);
const textQuestions = validateQuestions([{id:'short',label:'Short',type:'short_text',required:true},{id:'long',label:'Long',type:'long_text',required:false},{id:'choice',label:'Choice',type:'single_select',required:true,options:['A','B']}]);
assert.deepEqual(validateAnswers(textQuestions,{short:'  hello  ',choice:'B'}).answers,{short:'hello',long:null,choice:'B'});
assert.throws(()=>validateAnswers(textQuestions,{short:'x'.repeat(501),choice:'A'}));
assert.throws(()=>validateAnswers(textQuestions,{short:'ok',long:'x'.repeat(4001),choice:'A'}));
assert.throws(()=>validateAnswers(textQuestions,{short:'ok',choice:'C'}));
assert.throws(()=>validateAnswers(textQuestions,{choice:'A'}));
assert.throws(() => validateTemplate([{ key: 'a', title: 'Cycle', kind: 'custom', dueOffsetDays: 0, dependsOn: 'a' }]));
assert.equal(parseOperationalPlan('show damaged laptops with open tickets')?.filters.laptopOnly,true);
assert.equal(parseOperationalPlan('show employees with assigned damaged assets and open support tickets')?.filters.laptopOnly,undefined);
assert.throws(()=>validateTemplate([{key:'a',title:'Duplicate',kind:'custom',dueOffsetDays:0},{key:'b',title:'Duplicate',kind:'custom',dueOffsetDays:0,dependsOn:'a'}]));
assert.deepEqual(resolveDateWindow({ window: 'this_week' }, '2026-10-08'), { from: '2026-10-05', to: '2026-10-12' });
assert.deepEqual(resolveDateWindow({ window: 'tomorrow' }, '2026-10-08'), { from: '2026-10-09', to: '2026-10-10' });
assert.throws(() => validateOperationalPlan({ domain: 'support', resource: 'tickets', filters: { sql: 'SELECT *' } }));
assert.throws(() => validateOperationalPlan({ domain: 'support', resource: 'tickets', filters: { salary: 4 } }));
assert.throws(() => validateOperationalPlan({ domain: 'support', resource: 'tickets', filters: { olderThanDays: 999 } }));
assert.throws(() => validateOperationalPlan({ domain: 'hiring', resource: 'jobs', filters: { olderThanDays: 3 } }));
assert.throws(() => validateReasoning({ status: 'resolved', proposedIntentKey: 'operational_support', suggestedParameters: { plan: { domain: 'support', resource: 'tickets', filters: { column: 'secret' } } } }));
const queries: [
    string,
    string
][] = [['which open IT tickets are older than 3 days?', 'support'], ['show damaged laptops with open tickets','support'], ['show employees with assigned damaged assets and open support tickets','support'], ['وريني تذاكر الدعم المفتوحة اكتر من ٣ ايام', 'support'], ['اعرض تذاكر الدعم المفتوحة أقدم من 3 أيام', 'support'], ['show ticktes older than 3 days', 'support'], ['show tickets created in the last 7 days', 'support'], ['show candidates waiting for feedback', 'hiring'], ['اعرض المرشحين بانتظار التقييم', 'hiring'], ['وريني المرشحين مستنيين التقييم', 'hiring'], ['show canddates waiting for feedbak', 'hiring'], ['show offers expiring this week', 'hiring'], ['اعرض عروض هتنتهي الاسبوع ده', 'hiring'], ['which jobs have no applicants?', 'hiring'], ['which candidates have been in screening for more than 5 days?', 'hiring'], ['who is interviewing for Backend Engineer today?', 'hiring'], ['which new hires still need equipment?', 'onboarding'], ['وريني الموظفين الجدد محتاجين معدات', 'onboarding'], ['show onboarding tasks overdu', 'onboarding'], ['who is interviewing for Backend Engineer next week?', 'hiring'], ['who starts this week?', 'onboarding'], ['show unresolved IT tickets for employees starting this week', 'composition'], ['which new hires still need laptops?', 'composition'], ['show candidates who accepted offers but have incomplete onboarding', 'composition'], ['show الموظفين الجدد محتاجين معدات', 'onboarding'], ['show new hires without first shift assigned', 'onboarding']];
let calls = 0;
for (const [q, domain] of queries) {
    const plan = parseOperationalPlan(q);
    assert(plan, q);
    assert.equal(plan.domain, domain, q);
    const result = await resolveQuery(q, { actor: { tenantId: 'fixture', employeeId: 'fixture' }, allowed: async () => true, minimumScore: .84, minimumMargin: .10, search: { search: async () => [] }, authorization: { resolve: async () => { calls++; return { state: 'disabled' }; } } });
    assert.equal(result.intentKey, operationalIntent(plan), q);
    assert.equal(result.fallbackUsed, false);
}
assert.equal(calls, 0);
for (const query of ['assign Ahmed a laptop', 'move Sarah candidate to offer', 'close this ticket', 'send the offer', 'mark onboarding complete', 'change salary', 'show tickets older than 999 days']) {
    const r = await resolveQuery(query, { actor: { tenantId: 'fixture', employeeId: 'fixture' }, allowed: async () => true, minimumScore: .84, minimumMargin: .10, search: { search: async () => [{ intentKey: 'operational_onboarding', score: 1 }] }, authorization: { resolve: async () => ({ state: 'disabled' }) } });
    assert.equal(r.outcome, 'no_match', query);
}
const template = generalizeOperationalQuery('show open tickets older than 3 days', []);
assert(template && safeEntityTemplate(template));
assert.equal(template.text, 'show open tickets older than {duration}');
assert.equal(generalizeOperationalQuery('show secret identifier tickets older than 3 days', []), undefined);
console.log('PASS all question types/privacy/validation, screening flags, template dependencies, date windows, strict plans, 26 multilingual operational fixtures, zero wrong accepted mutation intents, zero fallback calls, and private temporal generalization.');
