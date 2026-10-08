export const QUESTION_TYPES = ['short_text', 'long_text', 'yes_no', 'single_select', 'multi_select', 'numeric'] as const;
export type ApplicationQuestion = {
    id: string;
    label: string;
    type: typeof QUESTION_TYPES[number];
    required: boolean;
    options?: string[];
    screening?: {
        expected: string | number | boolean | string[];
        hardRequirement: boolean;
    };
};
export type PublicQuestion = Omit<ApplicationQuestion, 'screening'>;
export const TASK_KINDS = ['access', 'equipment', 'policy', 'orientation', 'payroll', 'manager_meeting', 'badge', 'first_shift', 'custom'] as const;
export type TemplateTask = {
    key: string;
    title: string;
    kind: typeof TASK_KINDS[number];
    dueOffsetDays: number;
    dependsOn?: string;
};
const invalid = () => { throw Object.assign(Error('Invalid hiring configuration.'), { statusCode: 400 }); };
const record = (v: unknown): Record<string, any> => { if (!v || typeof v !== 'object' || Array.isArray(v))
    return invalid(); return v as Record<string, any>; };
const keys = (v: Record<string, any>, allowed: string[]) => { if (Object.keys(v).some(k => !allowed.includes(k)))
    invalid(); };
export function validateQuestions(value: unknown): ApplicationQuestion[] {
    if (!Array.isArray(value) || value.length > 20)
        invalid();
    const ids = new Set<string>();
    return (value as unknown[]).map(item => {
        const q = record(item);
        keys(q, ['id', 'label', 'type', 'required', 'options', 'screening']);
        if (typeof q.id !== 'string' || !/^[a-z][a-z0-9_]{0,39}$/.test(q.id) || ids.has(q.id) || typeof q.label !== 'string' || !q.label.trim() || q.label.length > 300 || !QUESTION_TYPES.includes(q.type) || typeof q.required !== 'boolean')
            invalid();
        ids.add(q.id);
        const optionType = ['single_select', 'multi_select'].includes(q.type);
        if (optionType && (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 20 || q.options.some((s: any) => typeof s !== 'string' || !s.trim() || s.length > 160) || new Set(q.options).size !== q.options.length) || !optionType && q.options !== undefined)
            invalid();
        const clean: ApplicationQuestion = { id: q.id, label: q.label.trim(), type: q.type, required: q.required, ...(optionType ? { options: q.options } : {}) };
        if (q.screening !== undefined) {
            const s = record(q.screening);
            keys(s, ['expected', 'hardRequirement']);
            if (typeof s.hardRequirement !== 'boolean' || !['yes_no', 'single_select', 'multi_select', 'numeric'].includes(q.type))
                invalid();
            validateAnswer(clean, s.expected, true);
            clean.screening = { expected: s.expected, hardRequirement: s.hardRequirement };
        }
        return clean;
    });
}
function validateAnswer(q: PublicQuestion, v: unknown, required = q.required) {
    if (v === undefined || v === null || v === '' || Array.isArray(v) && !v.length) {
        if (required)
            invalid();
        return null;
    }
    switch (q.type) {
        case 'short_text':
        case 'long_text':
            if (typeof v !== 'string' || !v.trim() || v.length > (q.type === 'short_text' ? 500 : 4000))
                invalid();
            return (v as string).trim();
        case 'yes_no':
            if (typeof v !== 'boolean')
                invalid();
            return v;
        case 'numeric':
            if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > 1e9)
                invalid();
            return v;
        case 'single_select':
            if (typeof v !== 'string' || !q.options?.includes(v))
                invalid();
            return v;
        case 'multi_select':
            if (!Array.isArray(v) || v.length > 20 || new Set(v).size !== v.length || v.some(x => typeof x !== 'string' || !q.options?.includes(x)))
                invalid();
            return v;
    }
}
export function publicQuestions(questions: ApplicationQuestion[]): PublicQuestion[] { return questions.map(({ screening, ...q }) => q); }
export function validateAnswers(questions: ApplicationQuestion[], value: unknown) {
    const data = record(value);
    keys(data, questions.map(q => q.id));
    const answers: Record<string, unknown> = {}, flags: {
        questionId: string;
        reason: string;
        hardRequirement: boolean;
    }[] = [];
    for (const q of questions) {
        const answer = validateAnswer(q, data[q.id]);
        answers[q.id] = answer;
        if (q.screening) {
            const e = q.screening.expected, pass = q.type === 'numeric' ? answer !== null && Number(answer) >= Number(e) : q.type === 'multi_select' ? Array.isArray(answer) && Array.isArray(e) && e.every(x => answer.includes(x)) : answer === e;
            if (!pass)
                flags.push({ questionId: q.id, reason: 'Screening criterion requires recruiter review', hardRequirement: q.screening.hardRequirement });
        }
    }
    return { answers, flags, requiresReview: flags.length > 0 };
}
export function validateTemplate(value: unknown): TemplateTask[] { if (!Array.isArray(value) || !value.length || value.length > 40)
    invalid(); const seen = new Set<string>(), titles=new Set<string>(); return (value as unknown[]).map(v => { const t = record(v); keys(t, ['key', 'title', 'kind', 'dueOffsetDays', 'dependsOn']); if (typeof t.key !== 'string' || !/^[a-z][a-z0-9_]{0,39}$/.test(t.key) || seen.has(t.key) || typeof t.title !== 'string' || !t.title.trim() || titles.has(t.title.trim()) || t.title.length > 180 || !TASK_KINDS.includes(t.kind) || !Number.isInteger(t.dueOffsetDays) || t.dueOffsetDays < -30 || t.dueOffsetDays > 365 || t.dependsOn !== undefined && !seen.has(t.dependsOn))
    invalid(); seen.add(t.key); titles.add(t.title.trim()); return { key: t.key, title: t.title.trim(), kind: t.kind, dueOffsetDays: t.dueOffsetDays, ...(t.dependsOn ? { dependsOn: t.dependsOn } : {}) }; }); }
