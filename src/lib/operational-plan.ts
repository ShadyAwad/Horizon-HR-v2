import { normalizeQuery } from './router-normalization';
export type OperationalFilters = {
    status?: 'open' | 'unresolved' | 'waiting_requester';
    stage?: 'screening' | 'offer';
    olderThanDays?: number;
    lastDays?: number;
    window?: 'today' | 'tomorrow' | 'this_week' | 'next_week';
    from?: string;
    to?: string;
    assigned?: 'mine';
    state?: 'ready' | 'needs_attention' | 'blocked';
    taskKind?: 'equipment' | 'access' | 'badge' | 'first_shift';
    overdue?: boolean;
    waitingFeedback?: boolean;
    noApplicants?: boolean;
    damagedAssets?: boolean;
    laptopOnly?: boolean;
    missingLaptop?: boolean;
    missingShift?: boolean;
    incomplete?: boolean;
    offersExpiring?: boolean;
    acceptedOffers?: boolean;
    employeeName?: string;
    assetName?: string;
    locationName?: string;
    jobName?: string;
    candidateName?: string;
};
export type OperationalPlan = {
    domain: 'support' | 'hiring' | 'onboarding' | 'composition';
    resource: 'tickets' | 'jobs' | 'candidates' | 'interviews' | 'offers' | 'hires';
    filters: OperationalFilters;
};
const fields = ['status', 'stage', 'olderThanDays', 'lastDays', 'window', 'from', 'to', 'assigned', 'state', 'taskKind', 'overdue', 'waitingFeedback', 'noApplicants', 'damagedAssets', 'laptopOnly', 'missingLaptop', 'missingShift', 'incomplete', 'offersExpiring', 'acceptedOffers', 'employeeName', 'assetName', 'locationName', 'jobName', 'candidateName'];
const invalid = (): never => { throw Object.assign(Error('Unsupported operational filter.'), { statusCode: 400 }); };
export function validateOperationalPlan(value: unknown): OperationalPlan {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        invalid();
    const p = value as OperationalPlan;
    if (Object.keys(p).some(k => !['domain', 'resource', 'filters'].includes(k)) || !['support', 'hiring', 'onboarding', 'composition'].includes(p.domain) || !['tickets', 'jobs', 'candidates', 'interviews', 'offers', 'hires'].includes(p.resource) || !p.filters || typeof p.filters !== 'object' || Array.isArray(p.filters))
        invalid();
    const f = p.filters;
    if (Object.keys(f).some(k => !fields.includes(k)))
        invalid();
    for (const [k, v] of Object.entries(f)) {
        if (['olderThanDays', 'lastDays'].includes(k)) {
            if (!Number.isInteger(v) || Number(v) < 1 || Number(v) > 365)
                invalid();
        }
        else if (k.endsWith('Name')) {
            if (typeof v !== 'string' || !v.trim() || v.length > 255)
                invalid();
        }
        else if (['from', 'to'].includes(k)) {
            if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString().slice(0, 10) !== v)
                invalid();
        }
        else if (['status', 'stage', 'window', 'assigned', 'state', 'taskKind'].includes(k)) {
            const options: Record<string, string[]> = { status: ['open', 'unresolved', 'waiting_requester'], stage: ['screening', 'offer'], window: ['today', 'tomorrow', 'this_week', 'next_week'], assigned: ['mine'], state: ['ready', 'needs_attention', 'blocked'], taskKind: ['equipment', 'access', 'badge', 'first_shift'] };
            if (!options[k].includes(String(v)))
                invalid();
        }
        else if (typeof v !== 'boolean')
            invalid();
    }
    if (!!f.from !== !!f.to || f.from && f.to! <= f.from || f.window && (f.from || f.lastDays) || f.lastDays && f.olderThanDays)
        invalid();
    const allowed: Record<string, string[]> = { tickets: ['status', 'olderThanDays', 'lastDays', 'window', 'from', 'to', 'assigned', 'damagedAssets', 'laptopOnly', 'employeeName', 'assetName', 'locationName'], jobs: ['noApplicants', 'jobName'], candidates: ['stage', 'olderThanDays', 'waitingFeedback', 'jobName', 'candidateName'], interviews: ['window', 'from', 'to', 'jobName'], offers: ['window', 'from', 'to', 'offersExpiring', 'candidateName'], hires: ['window', 'from', 'to', 'state', 'taskKind', 'overdue', 'missingLaptop', 'missingShift', 'incomplete', 'acceptedOffers', 'employeeName'] };
    if (Object.keys(f).some(k => !allowed[p.resource].includes(k)))
        invalid();
    if (p.domain === 'support' && p.resource !== 'tickets' || p.domain === 'hiring' && !['jobs', 'candidates', 'interviews', 'offers'].includes(p.resource) || p.domain === 'onboarding' && p.resource !== 'hires' || p.domain === 'composition' && !['tickets', 'hires'].includes(p.resource))
        invalid();
    return p;
}
/** Dates are derived by the server, never from model-invented timestamps. */
export function parseOperationalPlan(raw: string): OperationalPlan | undefined {
    const q = normalizeQuery(raw.replace(/[٠-٩]/g, x => String('٠١٢٣٤٥٦٧٨٩'.indexOf(x)))).replace(/\b(?:canddates|canddiates)\b/g, 'candidates').replace(/\b(?:feedbak|feeback)\b/g, 'feedback').replace(/\b(?:ticktes|tikets)\b/g, 'tickets').replace(/\boverdu\b/g, 'overdue'), f: OperationalFilters = {};
    const ticket = /tickets?|support requests?|it requests?|تذاكر|طلبات الدعم|طلبات دعم/u.test(q), hire = /new hires?|onboarding|employees starting|hires|starts|starting|موظفين جدد|الموظفين الجدد|التهيئه|تهيئه|التعيينات|هيبدا|يبدا/u.test(q), hiring = /candidates?|applicants?|interview|offers?|jobs?|مرشحين|مرشح|المتقدمين|مقابلات|مقابله|عروض|عرض|وظائف|وظيفه/u.test(q);
    if (!ticket && !hire && !hiring)
        return;
    if (/unresolved|غير محلول|غير محلوله/u.test(q))
        f.status = 'unresolved';
    else if (/open|مفتوح/u.test(q))
        f.status = 'open';
    if (/waiting (?:on|for) users?|waiting (?:on|for) requester|بانتظار المستخدم|مستنيه المستخدم/u.test(q))
        f.status = 'waiting_requester';
    if (/assigned to me|مسنده لي|مسند لي/u.test(q))
        f.assigned = 'mine';
    const age = q.match(/(?:older than|more than|اكتر من|اكثر من|اقدم من) (\d+) (?:days?|ايام|يوم)/u);
    if (age)
        f.olderThanDays = Number(age[1]);
    const last = q.match(/(?:last|اخر) (\d+) (?:days?|ايام|يوم)/u);
    if (last)
        f.lastDays = Number(last[1]);
    if (/next week|الاسبوع القادم|الاسبوع الجاي/u.test(q))
        f.window = 'next_week';
    else if (/this week|هذا الاسبوع|الاسبوع ده/u.test(q))
        f.window = 'this_week';
    else if (/tomorrow|غدا|بكره/u.test(q))
        f.window = 'tomorrow';
    else if (/today|اليوم|النهارده/u.test(q))
        f.window = 'today';
    const range = raw.match(/(?:between|من) (\d{4}-\d{2}-\d{2}) (?:and|to|الي|إلى) (\d{4}-\d{2}-\d{2})/u);
    if (range) {
        f.from = range[1];
        f.to = range[2];
    }
    if (/screening|الفحص|فحص/u.test(q))
        f.stage = 'screening';
    else if (/offer stage|مرحله العرض/u.test(q))
        f.stage = 'offer';
    if (/waiting for feedback|بانتظار التقييم|مستنيين التقييم/u.test(q))
        f.waitingFeedback = true;
    if (/no applicants|without applicants|بدون متقدمين/u.test(q))
        f.noApplicants = true;
    if (/offers? expiring|عروض.*تنتهي|عروض.*هتنتهي/u.test(q))
        f.offersExpiring = true;
    if (/blocked|متعطل|متوقف|معطل/u.test(q))
        f.state = 'blocked';
    if (/overdue|متاخر/u.test(q))
        f.overdue = true;
    if (/accepted offers|offers? (?:were )?accepted|قبلوا.*العروض/u.test(q)) { f.acceptedOffers = true; }
    if (/incomplete|غير مكتمل/u.test(q))
        f.incomplete = true;
    if (/damaged|تالف|متضرر/u.test(q))
        f.damagedAssets = true;
    if(ticket && f.damagedAssets && /laptops?|لابتوب/u.test(q)) f.laptopOnly=true;
    if (/need equipment|equipment pending|still need equipment|محتاجين معدات|عهد.*معلق/u.test(q))
        f.taskKind = 'equipment';
    if (/needs? (?:a )?badge|badge pending|محتاجين بطاقه/u.test(q))
        f.taskKind = 'badge';
    if (/access pending|accounts?.*pending|حسابات.*معلق/u.test(q))
        f.taskKind = 'access';
    if (/need laptops?|without laptops?|laptops? missing|محتاجين لابتوب/u.test(q))
        f.missingLaptop = true;
    if (/without first shift|no first shift|بدون اول مناوبه/u.test(q))
        f.missingShift = true;
    const operational = hire || age || last || range || f.waitingFeedback || f.noApplicants || f.offersExpiring || f.damagedAssets || f.status === 'waiting_requester' || ticket && f.window || hiring && /interview|مقابل/u.test(q) && (/for /u.test(q) || f.window && f.window !== 'today');
    if (!operational)
        return;
    const domain = ticket && hire || hire && (f.missingLaptop || f.acceptedOffers) ? 'composition' : ticket ? 'support' : hire ? 'onboarding' : 'hiring', resource = ticket ? 'tickets' : hire ? 'hires' : f.offersExpiring ? 'offers' : /interview|مقابل/u.test(q) ? 'interviews' : f.noApplicants || /jobs|وظائف/u.test(q) ? 'jobs' : 'candidates';
    if (!ticket)
        delete f.status;
    return validateOperationalPlan({ domain, resource, filters: f });
}
export function operationalIntent(plan: OperationalPlan) { return plan.domain === 'composition' && plan.resource === 'tickets' ? 'operational_support_onboarding' : 'operational_' + plan.domain; }
export function resolveDateWindow(filters: OperationalFilters, today: string) { const start = new Date(today + 'T00:00:00Z'), day = (d: Date) => d.toISOString().slice(0, 10), add = (d: Date, n: number) => new Date(d.getTime() + n * 86400000); if (filters.from)
    return { from: filters.from, to: filters.to! }; if (filters.lastDays)
    return { from: day(add(start, -filters.lastDays)), to: day(add(start, 1)) }; if (!filters.window)
    return {}; if (filters.window === 'tomorrow')
    return { from: day(add(start, 1)), to: day(add(start, 2)) }; if (filters.window === 'today')
    return { from: today, to: day(add(start, 1)) }; const monday = add(start, -((start.getUTCDay() + 6) % 7) + (filters.window === 'next_week' ? 7 : 0)); return { from: day(monday), to: day(add(monday, 7)) }; }
