import { lazy, Suspense, useEffect, useState } from 'react';
import { apiFetch, apiUrl } from '../../lib/api';
import { readApiJson } from '../../lib/api-response';
import { useLanguage } from '../../lib/LanguageContext';
import type { CommunicationMessage, CommunicationTemplate, CommunicationMeeting, CommunicationPerson, CommunicationCategory, TemplateValues } from '../../lib/communications-contract';
import { COMMUNICATION_TYPES, COMMUNICATION_VARIABLES } from '../../lib/communications-contract';
import { ComposerDialog as Dialog } from '../workspace-composer/ComposerDialog';
import '../workspace-composer/composer.css';
import './communications.css';
type StatusPayload = {
    capabilities: Record<string, boolean>;
    providerConfigured: boolean;
};
type Detail = {
    message?: CommunicationMessage;
    template?: CommunicationTemplate;
    meeting?: CommunicationMeeting;
    attendees?: CommunicationPerson[];
    ics?: string;
    events?: Array<{
        status: string;
        code: string | null;
        created_at: string;
    }>;
};
type ListRow = Partial<Omit<CommunicationMessage, 'status'> & Omit<CommunicationMeeting, 'status'> & CommunicationTemplate> & {
    status?: string;
    sender_name?: string;
    organizer_name?: string;
};
type Payload = StatusPayload & Detail & {
    messages?: ListRow[];
    meetings?: ListRow[];
    templates?: CommunicationTemplate[];
    employees?: CommunicationPerson[];
    total?: number;
    subject?: string;
    body?: string;
};
type ComposeForm = Partial<CommunicationMessage> & {
    subject: string;
    body: string;
    category: CommunicationCategory;
    recipientIds: string[];
    templateId?: string;
    bodyJson?: unknown;
    related: {
        type: string;
        id: string;
    };
    schedule?: string;
};
type TemplateForm = Partial<CommunicationTemplate> & Pick<CommunicationTemplate, 'name' | 'subject' | 'body' | 'category' | 'active'>;
type MeetingForm = Partial<CommunicationMeeting> & {
    title: string;
    notes: string;
    location: string;
    timezone: string;
    startsAt: string;
    endsAt: string;
    attendeeIds: string[];
    relatedEmployeeId?: string;
};
type Preview = {
    id: string;
    variables: TemplateValues;
    subject?: string;
    body?: string;
};
const Editor = lazy(() => import('../RichTextEditor').then(m => ({ default: m.RichTextEditor })));
const rootText = (value: string) => ({ root: { type: 'root', version: 1, format: '', indent: 0, direction: null, children: [{ type: 'paragraph', version: 1, format: '', indent: 0, direction: null, children: [{ type: 'text', version: 1, text: value, format: 0, detail: 0, mode: 'normal', style: '' }] }] } });
async function request(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<Payload> { return readApiJson(await apiFetch(apiUrl('/api/communications' + path), { method, signal, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) }), 'Communications service'); }
export default function CommunicationsPanel({ initialView = 'email' }: { initialView?: 'email' | 'meetings' }) {
    const { isRtl } = useLanguage(), t = (en: string, ar: string) => isRtl ? ar : en;
    const labels: Record<string, [
        string,
        string
    ]> = { name: ['Name', 'اسم القالب'], subject: ['Subject', 'الموضوع'], body: ['Body', 'النص'], title: ['Title', 'العنوان'], notes: ['Notes', 'ملاحظات'], location: ['Location or meeting URL', 'الموقع أو رابط الاجتماع'], timezone: ['Meeting timezone', 'المنطقة الزمنية للاجتماع'], startsAt: ['Start (device local time)', 'البداية (توقيت الجهاز)'], endsAt: ['End (device local time)', 'النهاية (توقيت الجهاز)'], employee: ['Employee ID', 'معرف الموظف'], sender: ['Sender ID', 'معرف المرسل'], related: ['Related record ID', 'معرف السجل المرتبط'], from: ['From date', 'من تاريخ'], to: ['Through date', 'إلى تاريخ'] };
    const label = (key: string) => labels[key] ? t(...labels[key]) : key;
    const [tab, setTab] = useState<string>(initialView), [cap, setCap] = useState<StatusPayload | null>(null), [rows, setRows] = useState<ListRow[]>([]), [templates, setTemplates] = useState<CommunicationTemplate[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [refresh, setRefresh] = useState(0), [page, setPage] = useState(1), [total, setTotal] = useState(0), [query, setQuery] = useState(''), [filters, setFilters] = useState({ q: '', status: '', category: '', employee: '', sender: '', related: '', from: '', to: '' });
    useEffect(() => { setTab(initialView); }, [initialView]);
    const [compose, setCompose] = useState<ComposeForm | null>(null), [template, setTemplate] = useState<TemplateForm | null>(null), [meeting, setMeeting] = useState<MeetingForm | null>(null), [detail, setDetail] = useState<Detail | null>(null), [preview, setPreview] = useState<Preview | null>(null), [editorKey, setEditorKey] = useState(0), [uploading, setUploading] = useState(false);
    const [people, setPeople] = useState<CommunicationPerson[]>([]), [peopleQuery, setPeopleQuery] = useState('');
    useEffect(() => { const c = new AbortController(); request('/status', 'GET', undefined, c.signal).then(d => { setCap(d); const c = d.capabilities; if (!c.view && !c.send)
        setTab(c['history.view'] ? 'history' : c['templates.manage'] ? 'templates' : 'meetings'); }).catch(e => { if (!c.signal.aborted)
        setError(e.message); }); return () => c.abort(); }, []);
    useEffect(() => {
        if (!cap)
            return;
        const c = new AbortController();
        setError('');
        setRows([]);
        setBusy(true);
        const f = new URLSearchParams(Object.entries(filters).filter(([, v]) => v));
        f.set('page', String(page));
        if (tab === 'history')
            f.set('scope', 'company');
        const path = tab === 'meetings' ? '/meetings?page=' + page : tab === 'templates' ? '/templates' : '/messages?' + f;
        request(path, 'GET', undefined, c.signal).then(d => { if (c.signal.aborted)
            return; setRows(d.messages || d.meetings || d.templates || []); setTotal(d.total ?? (d.meetings?.length === 20 ? page * 20 + 1 : page * 20)); if (d.templates)
            setTemplates(d.templates); }).catch(e => { if (!c.signal.aborted)
            setError(e.message); }).finally(() => { if (!c.signal.aborted)
            setBusy(false); });
        return () => c.abort();
    }, [tab, page, filters, refresh, cap]);
    const run = async (fn: () => Promise<void>) => { setBusy(true); setError(''); try {
        await fn();
    }
    catch (e) {
        setError(e instanceof Error ? e.message : 'Network failure.');
    }
    finally {
        setBusy(false);
    } };
    const loadPeople = () => run(async () => { setPeople((await request('/recipients?q=' + encodeURIComponent(peopleQuery))).employees); });
    const openCompose = async (row?: CommunicationMessage) => { const list = await request('/templates'); setTemplates(list.templates); setPeople([]); setPeopleQuery(''); setCompose(row ? { ...row, recipientIds: row.recipient_ids, templateId: row.template_id, bodyJson: row.body_json, related: row.related_grievance_id ? {type:'grievance',id:row.related_grievance_id} : row.related_employee_id ? { type: 'employee', id: row.related_employee_id } : row.related_candidate_id ? { type: 'candidate', id: row.related_candidate_id } : row.related_meeting_id ? { type: 'meeting', id: row.related_meeting_id } : { type: '', id: '' } } : { recipientIds: [], subject: '', body: '', category: 'custom', variables: {}, related: { type: '', id: '' } }); setEditorKey(k => k + 1); };
    const saveDraft = async () => { if (compose.invitation_ics)
        return compose; const d = await request(compose.id ? '/drafts/' + compose.id : '/drafts', compose.id ? 'PUT' : 'POST', compose); setCompose({ ...compose, ...d.message, recipientIds: d.message.recipient_ids, bodyJson: d.message.body_json }); setRefresh(n => n + 1); setNotice(t('Draft saved privately.', 'تم حفظ المسودة الخاصة.')); return d.message; };
    const selectTemplate = (id: string) => { const value = templates.find(v => v.id === id); setCompose({ ...compose, templateId: id || null, category: value?.category || 'custom', subject: value?.subject || compose.subject, body: value?.body || compose.body, bodyJson: null }); setEditorKey(k => k + 1); };
    const openMeeting = (data?: Detail) => { const m = data?.meeting; const local = (s: string) => { const d = new Date(s); return new Date(+d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }; setPeople([]); setMeeting(m ? { ...m, startsAt: local(m.starts_at), endsAt: local(m.ends_at), attendeeIds: data.attendees.map(a => a.id), relatedEmployeeId: m.related_employee_id } : { title: '', notes: '', startsAt: '', endsAt: '', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, location: '', attendeeIds: [] }); };
    const date = (v: string, timezone?: string) => {
        if (!v || !Number.isFinite(Date.parse(v))) return '—';
        try { return new Date(v).toLocaleString(isRtl ? 'ar' : 'en', timezone ? { timeZone: timezone } : undefined); }
        catch { return new Date(v).toLocaleString(isRtl ? 'ar' : 'en'); }
    };
    const vocabulary: Record<string, [string, string]> = {
        draft: ['Private draft', 'مسودة خاصة'], queued: ['Queued', 'في الطابور'], sending: ['Sending', 'جار الإرسال'], sent: ['Sent', 'مرسل'], failed: ['Failed', 'فشل الإرسال'], cancelled: ['Cancelled', 'ملغى'], scheduled: ['Scheduled', 'مجدول'], completed: ['Completed', 'مكتمل'],
        welcome: ['Welcome', 'ترحيب'], account_setup: ['Account setup', 'إعداد الحساب'], leave_status: ['Leave update', 'تحديث الإجازة'], payroll_notice: ['Payroll notice', 'إشعار الراتب'], document_request: ['Document request', 'طلب مستند'], meeting_invitation: ['Meeting invitation', 'دعوة اجتماع'], grievance_update: ['Grievance update', 'تحديث الشكوى'], asset_reminder: ['Equipment reminder', 'تذكير بالمعدات'], hiring: ['Hiring', 'التوظيف'], custom: ['Custom message', 'رسالة مخصصة'],
    };
    const display = (value?: string) => value ? vocabulary[value] ? t(...vocabulary[value]) : value : '—';
    const relatedLabel = (r: ListRow) => r.related_grievance_id ? t('Linked grievance', 'شكوى مرتبطة') : r.related_employee_id ? t('Linked employee', 'موظف مرتبط') : r.related_candidate_id ? t('Linked candidate', 'مرشح مرتبط') : r.related_meeting_id ? t('Linked meeting', 'اجتماع مرتبط') : '';

    const deliveryGuidance = (message: CommunicationMessage) => {
        if (message.failure_code === 'RECONCILIATION_REQUIRED') return t('Delivery is uncertain. Ask an administrator to verify the provider outcome before creating a replacement; retry is stopped to avoid duplicate email.', 'نتيجة التسليم غير مؤكدة. اطلب من المسؤول التحقق من نتيجة المزود قبل إنشاء رسالة بديلة؛ توقفت إعادة المحاولة لتجنب البريد المكرر.');
        if (message.status === 'queued') return message.failure_code ? t('A temporary failure is being retried automatically, up to four attempts. Retry dispatch restores this same message to the queue if dispatch was interrupted.', 'تُعاد المحاولة تلقائياً بعد فشل مؤقت حتى أربع محاولات. إعادة الإرسال للطابور تستعيد الرسالة نفسها إذا انقطع الإرسال.') : t('Waiting for its scheduled time and worker. Retry dispatch restores this same message if queue dispatch was interrupted; it does not create a new email.', 'بانتظار الموعد المحدد والعامل. إعادة الإرسال للطابور تستعيد الرسالة نفسها عند الانقطاع ولا تنشئ بريداً جديداً.');
        if (message.status === 'sending') return t('The worker is contacting the email provider. Cancellation is unavailable until the outcome is known.', 'العامل يتواصل مع مزود البريد. الإلغاء غير متاح حتى تُعرف النتيجة.');
        if (message.status === 'failed') return t('Automatic retries have stopped. Ask an administrator to review configuration and the failure before manually preparing a replacement.', 'توقفت المحاولات التلقائية. اطلب من المسؤول مراجعة الإعدادات والفشل قبل إعداد رسالة بديلة يدوياً.');
        if (message.status === 'sent') return t('Accepted by the email provider. This saved content and recipient snapshot cannot be edited.', 'قبل مزود البريد الرسالة. لا يمكن تعديل محتواها أو مستلميها المحفوظين.');
        if (message.status === 'cancelled') return t('Cancelled. This message will not be retried.', 'أُلغيت الرسالة ولن تُعاد محاولتها.');
        return t('Private draft. Saving does not send email.', 'مسودة خاصة. الحفظ لا يرسل بريداً.');
    };
    const pickPeople = (selected: string[], onChange: (ids: string[]) => void) => <fieldset><legend>{t('Company recipients / attendees (up to 20)', 'مستلمون / مشاركون من الشركة (حتى 20)')}</legend><div className="comms-row"><input aria-label={t('Find employee', 'البحث عن موظف')} value={peopleQuery} onChange={e => setPeopleQuery(e.target.value)}/><button type="button" onClick={loadPeople}>{t('Find', 'بحث')}</button></div><p>{selected.length} {t('selected', 'محدد')}</p>{people.map(p => <label key={p.id}><input type="checkbox" checked={selected.includes(p.id)} onChange={e => onChange(e.target.checked ? [...selected, p.id] : selected.filter(id => id !== p.id))}/>{p.name} ({p.email})</label>)}</fieldset>;
    return <section className="comms" dir={isRtl ? 'rtl' : 'ltr'}><header><div><h2>{t('Communications', 'التواصل')}</h2><p>{t('Company email, private drafts and internal meetings.', 'بريد الشركة والمسودات الخاصة والاجتماعات الداخلية.')}</p></div><div className="comms-row">{cap?.capabilities.send && <button onClick={() => run(() => openCompose())}>{t('Compose', 'إنشاء رسالة')}</button>}{cap?.capabilities['meetings.manage'] && <button onClick={() => openMeeting()}>{t('Schedule meeting', 'جدولة اجتماع')}</button>}<button onClick={() => setRefresh(n => n + 1)}>{t('Refresh', 'تحديث')}</button></div></header>
 <nav aria-label={t('Communication areas', 'أقسام التواصل')}>{[['email', 'Email', 'البريد'], ['templates', 'Templates', 'القوالب'], ['meetings', 'Meetings', 'الاجتماعات'], ['history', 'History', 'السجل']].filter(([id]) => { const c = cap?.capabilities; return c && (id === 'email' ? (c.view || c.send) : id === 'history' ? c['history.view'] : id === 'templates' ? (c.view || c.send || c['templates.manage']) : (c['meetings.view'] || c['meetings.manage'])); }).map(([id, en, ar]) => <button key={id} aria-pressed={tab === id} onClick={() => { if (tab !== id) { setRows([]); setTab(id); setPage(1); } }}>{t(en, ar)}</button>)}</nav>
 {cap && !cap.providerConfigured && <p role="status">{t('Sending is not configured. Drafts and meetings remain available.', 'الإرسال غير مهيأ. يمكنك حفظ المسودات والاجتماعات.')}</p>}{error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
 {['email', 'history'].includes(tab) && <form className="comms-filters" onSubmit={e => { e.preventDefault(); setFilters({ ...filters, q: query }); setPage(1); }}><input aria-label={t('Search subject or recipient', 'البحث بالموضوع أو المستلم')} placeholder={t('Search subject or recipient', 'ابحث بالموضوع أو المستلم')} value={query} onChange={e => setQuery(e.target.value)}/><select aria-label={t('Status', 'الحالة')} value={filters.status} onChange={e => { setFilters({ ...filters, status: e.target.value }); setPage(1); }}><option value="">{t('All statuses', 'كل الحالات')}</option>{['draft', 'queued', 'sending', 'sent', 'failed', 'cancelled'].map(s => <option key={s} value={s}>{display(s)}</option>)}</select><select aria-label={t('Message type', 'نوع الرسالة')} value={filters.category} onChange={e => { setFilters({ ...filters, category: e.target.value as CommunicationCategory }); setPage(1); }}><option value="">{t('All types', 'كل الأنواع')}</option>{COMMUNICATION_TYPES.map(s => <option key={s} value={s}>{display(s)}</option>)}</select><details><summary>{t('More filters', 'مرشحات أخرى')}</summary>{(['employee', 'sender', 'related', 'from', 'to'] as const).map(key => <label key={key}>{label(key)}<input type={['from', 'to'].includes(key) ? 'date' : 'text'} value={filters[key]} onChange={e => { setFilters({ ...filters, [key]: e.target.value }); setPage(1); }} placeholder={['employee', 'sender'].includes(key) ? 'Employee ID' : undefined}/></label>)}</details><button>{t('Search', 'بحث')}</button>{Object.values(filters).some(Boolean) && <button type="button" onClick={() => { setQuery(''); setFilters({q:'',status:'',category:'',employee:'',sender:'',related:'',from:'',to:''}); setPage(1); }}>{t('Clear filters', 'مسح المرشحات')}</button>}</form>}
 {busy && <p role="status">{t('Loading…', 'جار التحميل…')}</p>}
 {tab === 'templates' && cap?.capabilities['templates.manage'] && <button onClick={() => setTemplate({ name: '', subject: '', body: '', category: 'custom', active: true })}>{t('New template', 'قالب جديد')}</button>}
 <div className="comms-table"><table><thead><tr>{(tab === 'templates' ? [t('Template', 'القالب'), t('Type', 'النوع'), t('Status', 'الحالة')] : tab === 'meetings' ? [t('Meeting', 'الاجتماع'), t('Organizer', 'المنظم'), t('Time', 'الوقت'), t('Status', 'الحالة')] : [t('Subject / recipients', 'الموضوع / المستلمون'), t('Sender', 'المرسل'), t('Type / related record', 'النوع / السجل المرتبط'), t('Queued / sent', 'قيد الإرسال / مرسل'), t('Status', 'الحالة')]).map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map(r => <tr key={r.id}><td><button className="comms-link" onClick={() => run(async () => { if (tab === 'templates') {
        setDetail({ template: r as CommunicationTemplate });
        return;
    } if (tab === 'meetings') {
        setDetail(await request('/meetings/' + r.id));
        return;
    } const d = await request('/messages/' + r.id); if (d.message.status === 'draft')
        await openCompose(d.message);
    else
        setDetail(d); })}>{(tab === 'templates' ? r.name : r.subject || r.title) || r.name || t('(Untitled draft)', '(مسودة بلا عنوان)')}</button>{r.recipients && <small>{r.recipients.join(', ') || `${r.recipient_ids?.length || 0} ${t('selected', 'محدد')}`}</small>}</td>{tab === 'templates' ? <><td data-label={t('Type', 'النوع')}>{display(r.category)}</td><td data-label={t('Status', 'الحالة')}>{r.active ? t('Active', 'نشط') : t('Inactive', 'غير نشط')}</td></> : tab === 'meetings' ? <><td data-label={t('Organizer', 'المنظم')}>{r.organizer_name}</td><td data-label={t('Time', 'الوقت')}>{date(r.starts_at, r.timezone)}<small>{r.timezone}</small></td><td data-label={t('Status', 'الحالة')}><span className="comms-status">{display(r.status)}</span></td></> : <><td data-label={t('Sender', 'المرسل')}>{r.sender_name}</td><td data-label={t('Type', 'النوع')}>{display(r.category)}<small>{relatedLabel(r)}</small></td><td data-label={t('Date', 'التاريخ')}>{date(r.sent_at || r.queued_at || r.created_at)}</td><td data-label={t('Status', 'الحالة')}><span className="comms-status">{display(r.status)}</span>{r.failure_code && <small>{t('Open for delivery guidance', 'افتح للاطلاع على إرشادات الإرسال')}</small>}</td></>}</tr>)}</tbody></table></div>{!busy && !error && !rows.length && <p className="comms-empty">{tab === 'meetings' ? t('No meetings in this view.', 'لا توجد اجتماعات في هذا العرض.') : tab === 'templates' ? t('No templates yet.', 'لا توجد قوالب بعد.') : t('No messages match this view. Adjust the filters or compose a message if available.', 'لا توجد رسائل مطابقة. عدّل المرشحات أو أنشئ رسالة إن كان متاحاً.')}</p>}
 {tab !== 'templates' && <div className="comms-row"><button disabled={page === 1 || busy} onClick={() => setPage(p => p - 1)}>{t('Previous', 'السابق')}</button><span>{t('Page', 'صفحة')} {page}</span><button disabled={page * 20 >= total || busy} onClick={() => setPage(p => p + 1)}>{t('Next', 'التالي')}</button></div>}{['email', 'history'].includes(tab) && <p className="comms-muted">{t('Sent means accepted by the email provider. Delivery and opens are not tracked.', 'مرسل تعني قبول مزود البريد للرسالة. لا يتم تتبع التسليم أو الفتح.')}</p>}
 {compose && <Dialog title={t('Compose email', 'إنشاء بريد')} onClose={() => setCompose(null)}><div className="comms-form">{error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}{compose.invitation_ics ? <p>{t('Calendar snapshot: edit the meeting to change its invitation.', 'دعوة تقويم محفوظة: عدّل الاجتماع لتغيير الدعوة.')}</p> : null}<fieldset disabled={!!compose.invitation_ics}>{pickPeople(compose.recipientIds, recipientIds => setCompose({ ...compose, recipientIds }))}<label>{t('Template', 'القالب')}<select value={compose.templateId || ''} onChange={e => selectTemplate(e.target.value)}><option value="">{t('Custom message', 'رسالة مخصصة')}</option>{templates.filter(v => v.active).map(v => <option value={v.id} key={v.id}>{v.name}</option>)}</select></label><label>{t('Type', 'النوع')}<select value={compose.category} onChange={e => setCompose({ ...compose, category: e.target.value as CommunicationCategory })}>{COMMUNICATION_TYPES.map(s => <option key={s} value={s}>{display(s)}</option>)}</select></label><label>{t('Subject', 'الموضوع')}<input maxLength={200} value={compose.subject} onChange={e => setCompose({ ...compose, subject: e.target.value })}/></label><Suspense fallback={<p>Loading editor…</p>}><Editor readOnly={!!compose.invitation_ics} allowImages={false} key={editorKey} valueJson={compose.bodyJson || rootText(compose.body)} onChange={v => setCompose(s => s ? { ...s, body: v.text, bodyJson: v.json } : s)} onImageUploadPendingChange={setUploading}/></Suspense><p>{t('Email is sent as safe text with line breaks. Images are not included.', 'يُرسل البريد كنص آمن مع فواصل أسطر. لا تُرسل الصور.')}</p><details><summary>{t('Variables and related record', 'المتغيرات والسجل المرتبط')}</summary>{COMMUNICATION_VARIABLES.map(key => <label key={key}>{label(key)}<input maxLength={300} value={compose.variables?.[key] || ''} onChange={e => setCompose({ ...compose, variables: { ...compose.variables, [key]: e.target.value } })}/></label>)}<label>{t('Related type', 'نوع السجل')}<select value={compose.related?.type || ''} onChange={e => setCompose({ ...compose, related: { type: e.target.value, id: '' } })}>{['', 'employee', 'candidate', 'meeting', 'grievance'].map(v => <option key={v} value={v}>{v || 'None'}</option>)}</select></label>{compose.related?.type && <label>{t('Related record ID', 'معرف السجل')}<input value={compose.related.id} onChange={e => setCompose({ ...compose, related: { ...compose.related, id: e.target.value } })}/></label>}</details></fieldset><label>{t('Schedule (device local time, optional)', 'الجدولة (توقيت الجهاز، اختياري)')}<input type="datetime-local" value={compose.schedule || ''} onChange={e => setCompose({ ...compose, schedule: e.target.value })}/></label><div className="comms-row"><button disabled={busy || uploading} onClick={() => run(async () => { await saveDraft(); })}>{t('Save draft', 'حفظ المسودة')}</button>{compose.id && <button disabled={busy} onClick={() => run(async () => { await request('/messages/' + compose.id + '/cancel', 'POST', {}); setCompose(null); setRefresh(n => n + 1); })}>{t('Discard draft', 'إلغاء المسودة')}</button>}<button disabled={busy || uploading || !cap?.providerConfigured} onClick={() => run(async () => { const saved = await saveDraft(); await request('/messages/' + saved.id + '/send', 'POST', { scheduledAt: compose.schedule ? new Date(compose.schedule).toISOString() : null }); setCompose(null); setNotice(t('Message queued. Refresh to check its status.', 'تمت إضافة الرسالة إلى الطابور. حدّث لعرض حالتها.')); setRefresh(n => n + 1); })}>{compose.schedule ? t('Schedule send', 'جدولة الإرسال') : t('Send now', 'إرسال الآن')}</button></div></div></Dialog>}
 {template && <Dialog title={t('Edit template', 'تحرير القالب')} onClose={() => setTemplate(null)}><form className="comms-form" onSubmit={e => { e.preventDefault(); void run(async () => { await request('/templates' + (template.id ? '/' + template.id : ''), template.id ? 'PUT' : 'POST', template); setTemplate(null); setRefresh(n => n + 1); }); }}>{error && <p role="alert">{error}</p>}{(['name', 'subject', 'body'] as const).map(key => <label key={key}>{label(key)}{key === 'body' ? <textarea required value={template[key]} onChange={e => setTemplate({ ...template, [key]: e.target.value })}/> : <input required value={template[key]} onChange={e => setTemplate({ ...template, [key]: e.target.value })}/>}</label>)}<label>Type<select value={template.category} onChange={e => setTemplate({ ...template, category: e.target.value as CommunicationCategory })}>{COMMUNICATION_TYPES.map(v => <option key={v} value={v}>{display(v)}</option>)}</select></label><label><input type="checkbox" checked={template.active} onChange={e => setTemplate({ ...template, active: e.target.checked })}/>{t('Active', 'نشط')}</label><p>{COMMUNICATION_VARIABLES.map(v => '{{' + v + '}}').join(' · ')}</p><button disabled={busy}>{t('Save', 'حفظ')}</button></form></Dialog>}
 {meeting && <Dialog title={t('Schedule / edit meeting', 'جدولة / تحرير اجتماع')} onClose={() => setMeeting(null)}><form className="comms-form" onSubmit={e => { e.preventDefault(); void run(async () => { await request('/meetings' + (meeting.id ? '/' + meeting.id : ''), meeting.id ? 'PUT' : 'POST', { ...meeting, startsAt: new Date(meeting.startsAt).toISOString(), endsAt: new Date(meeting.endsAt).toISOString() }); setMeeting(null); setRefresh(n => n + 1); }); }}>{error && <p role="alert">{error}</p>}{(['title', 'notes', 'location', 'timezone'] as const).map(key => <label key={key}>{label(key)}<input value={meeting[key]} required={['title', 'timezone'].includes(key)} onChange={e => setMeeting({ ...meeting, [key]: e.target.value })}/></label>)}<p>{t('Enter start/end in your device timezone; the meeting timezone controls its display label.', 'أدخل البداية والنهاية بتوقيت جهازك؛ تُحفظ المنطقة الزمنية للاجتماع للعرض.')}</p>{(['startsAt', 'endsAt'] as const).map(key => <label key={key}>{label(key)}<input type="datetime-local" required value={meeting[key]} onChange={e => setMeeting({ ...meeting, [key]: e.target.value })}/></label>)}<label>{t('Related employee ID (optional)', 'معرف الموظف المرتبط (اختياري)')}<input value={meeting.relatedEmployeeId || ''} onChange={e => setMeeting({ ...meeting, relatedEmployeeId: e.target.value })}/></label>{pickPeople(meeting.attendeeIds, attendeeIds => setMeeting({ ...meeting, attendeeIds }))}<button disabled={busy}>{t('Save meeting', 'حفظ الاجتماع')}</button></form></Dialog>}
 {detail && <Dialog title={t('Details', 'التفاصيل')} onClose={() => setDetail(null)}><div className="comms-form">{error && <p role="alert">{error}</p>}{detail.template ? <><h3>{detail.template.name}</h3><p>{detail.template.subject}</p><pre>{detail.template.body}</pre><button onClick={() => { setPreview({ id: detail.template.id, variables: {} }); setDetail(null); }}>{t('Preview variables', 'معاينة المتغيرات')}</button>{cap?.capabilities['templates.manage'] && <><button onClick={() => { setTemplate(detail.template); setDetail(null); }}>{t('Edit / deactivate', 'تحرير / تعطيل')}</button><button onClick={() => { setTemplate({ ...detail.template, id: undefined, name: detail.template.name + ' copy' }); setDetail(null); }}>{t('Duplicate', 'نسخ')}</button></>}</> : detail.meeting ? <><h3>{detail.meeting.title}</h3><p>{date(detail.meeting.starts_at, detail.meeting.timezone)} — {date(detail.meeting.ends_at, detail.meeting.timezone)} · {detail.meeting.timezone}</p><p>{t('Organizer', 'المنظم')}: {detail.meeting.organizer_name || detail.meeting.organizer_id}</p><p>{detail.meeting.related_employee_id || ''}</p><p>{detail.meeting.location}</p><pre>{detail.meeting.notes}</pre><p>{display(detail.meeting.status)}</p><ul>{detail.attendees.map(a => <li key={a.id}>{a.name} ({a.email})</li>)}</ul><a download="meeting.ics" href={'data:text/calendar;charset=utf-8,' + encodeURIComponent(detail.ics)}>{t('Download calendar invitation', 'تنزيل دعوة التقويم')}</a>{cap?.capabilities['meetings.manage'] && <><button onClick={() => { openMeeting(detail); setDetail(null); }} disabled={detail.meeting.status !== 'scheduled'}>{t('Edit', 'تحرير')}</button>{['completed', 'cancelled'].map(status => <button key={status} disabled={busy || detail.meeting.status !== 'scheduled'} onClick={() => run(async () => { await request('/meetings/' + detail.meeting.id + '/status', 'POST', { status }); setDetail(null); setRefresh(n => n + 1); })}>{status}</button>)}<button disabled={busy || !cap.capabilities.send} onClick={() => run(async () => { const d = await request('/meetings/' + detail.meeting.id + '/invitation', 'POST', { requestKey: crypto.randomUUID() }); setDetail(null); if (d.message.status === 'draft')
        await openCompose(d.message);
    else
        setNotice(t('Invitation for this meeting revision already exists in history.', 'توجد دعوة لهذه النسخة من الاجتماع في السجل.')); })}>{t('Prepare / resend invitation', 'إعداد / إعادة إرسال دعوة')}</button></>}</> : <><h3>{detail.message.subject}</h3><p>{detail.message.recipients.join(', ')}</p><p>{display(detail.message.status)} · {date(detail.message.created_at)}</p><p role="status">{deliveryGuidance(detail.message)}</p><p>{t('Sender', 'المرسل')}: {detail.message.sender_name || detail.message.sender_id}</p><p>{t('Related record', 'السجل المرتبط')}: {detail.message.related_grievance_id || detail.message.related_employee_id || detail.message.related_candidate_id || detail.message.related_meeting_id || '—'}</p><p>{t('Queued / sent', 'في الطابور / مرسل')}: {date(detail.message.queued_at)} / {date(detail.message.sent_at)}</p><pre>{detail.message.body}</pre>{detail.message.provider_id && <p>Provider: {detail.message.provider_id}</p>}{detail.message.failure_reason && <p>{detail.message.failure_reason}</p>}<ul>{detail.events.map((v, i) => <li key={i}>{date(v.created_at)} · {v.status} · {v.code}</li>)}</ul>{detail.message.status === 'queued' && cap?.capabilities.send && <><button disabled={busy} onClick={() => run(async () => { await request('/messages/' + detail.message.id + '/send', 'POST', {}); setNotice('Dispatch requested.'); setDetail(null); setRefresh(n => n + 1); })}>{t('Retry dispatch', 'إعادة محاولة الإرسال للطابور')}</button><button disabled={busy} onClick={() => run(async () => { await request('/messages/' + detail.message.id + '/cancel', 'POST', {}); setDetail(null); setRefresh(n => n + 1); })}>{t('Cancel message', 'إلغاء الرسالة')}</button></>}</>}</div></Dialog>}
 {preview && <Dialog title={t('Template preview', 'معاينة القالب')} onClose={() => setPreview(null)}><div className="comms-form">{error && <p role="alert">{error}</p>}{COMMUNICATION_VARIABLES.map(key => <label key={key}>{label(key)}<input value={preview.variables[key] || ''} onChange={e => setPreview({ ...preview, variables: { ...preview.variables, [key]: e.target.value } })}/></label>)}<button onClick={() => run(async () => setPreview({ ...preview, ...await request('/templates/' + preview.id + '/preview', 'POST', { variables: preview.variables }) }))}>{t('Preview', 'معاينة')}</button><h3>{preview.subject}</h3><pre>{preview.body}</pre></div></Dialog>}
 </section>;
}

