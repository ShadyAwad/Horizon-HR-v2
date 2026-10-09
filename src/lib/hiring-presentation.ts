/** Presentation only: server capabilities, stages and readiness remain authoritative. */
const labels: Record<string, [string, string]> = {
  accepting_applications: ['Accepting applications','التقديم متاح'],
  opens_later: ['Opens later','التقديم يبدأ لاحقاً'],
  window_closed: ['Application window closed','انتهت فترة التقديم'],
  unavailable: ['Public application unavailable','التقديم العام غير متاح'],
  draft: ['Draft','مسودة'],
  open: ['Open','مفتوحة'],
  paused: ['Paused','متوقفة مؤقتاً'],
  closed: ['Closed','مغلقة'],
  filled: ['Filled','مكتملة'],
  scheduled: ['Scheduled','مجدولة'],
  completed: ['Completed','مكتملة'],
  cancelled: ['Cancelled','ملغاة'],
  sent: ['Sent','مُرسل'],
  accepted: ['Accepted','مقبول'],
  rejected: ['Rejected','مرفوض'],
  expired: ['Expired','منتهي'],
  superseded: ['Superseded','إصدار سابق'],
  withdrawn: ['Withdrawn','مسحوب'],
  pending: ['Pending','معلقة'],
  in_progress: ['In progress','قيد التنفيذ'],
  blocked: ['Blocked','متعطلة'],
  ready: ['Ready','جاهز'],
  needs_attention: ['Needs attention','يحتاج متابعة'],
  advance: ['Advance','متابعة'],
  hold: ['Hold for review','انتظار المراجعة'],
  reject: ['Recommend rejection','توصية بالرفض'],
  strong_yes: ['Strong yes','موافقة قوية'],
  yes: ['Yes','نعم'],
  no: ['No','لا'],
  strong_no: ['Strong no','رفض قوي'],
  short_text: ['Short text','نص قصير'],
  long_text: ['Long text','نص طويل'],
  yes_no: ['Yes / No','نعم / لا'],
  single_select: ['Single choice','اختيار واحد'],
  multi_select: ['Multiple choices','اختيارات متعددة'],
  numeric: ['Number','رقم'],
  access: ['Access','الوصول'],
  equipment: ['Equipment','المعدات'],
  policy: ['Policy','السياسات'],
  orientation: ['Orientation','التعريف'],
  payroll: ['Payroll','الرواتب'],
  manager_meeting: ['Manager meeting','لقاء المدير'],
  badge: ['Badge','البطاقة'],
  first_shift: ['First shift','المناوبة الأولى'],
  custom: ['Custom','مخصص'],
  full_time: ['Full time','دوام كامل'],
  part_time: ['Part time','دوام جزئي'],
  contract: ['Contract','تعاقد'],
  internship: ['Internship','تدريب'],
  hr_admin: ['HR administrator','مسؤول الموارد البشرية'],
  manager: ['Manager','مدير'],
  employee: ['Employee','موظف'],
  acknowledged: ['Acknowledged','تم الاستلام'],
  public_application: ['Public application','تقديم عبر الرابط العام'],
};
export function hiringLabel(value: string | null | undefined, rtl = false) {
  if (!value) return '—';
  return labels[value]?.[rtl ? 1 : 0] || value.replaceAll('_', ' ');
}
export function hiringAnswer(value: unknown, rtl = false): string {
  if (value == null || value === '') return '—';
  if (typeof value === 'boolean') return hiringLabel(value ? 'yes' : 'no', rtl);
  if (Array.isArray(value)) return value.map(v => hiringAnswer(v, rtl)).join(' · ');
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '—';
}
export function hiringAge(value: string, rtl = false, now = Date.now()) {
  const elapsed = Math.max(0, now - Date.parse(value));
  if (!Number.isFinite(elapsed)) return '—';
  const minutes = Math.floor(elapsed / 60000), hours = Math.floor(minutes / 60), days = Math.floor(hours / 24);
  return new Intl.NumberFormat(rtl ? 'ar-EG' : 'en', {
    style: 'unit', unit: days ? 'day' : hours ? 'hour' : 'minute', unitDisplay: 'narrow',
  }).format(days || hours || minutes);
}
export function hiringDate(value: string, rtl = false, timeZone?: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  return date.toLocaleString(rtl ? 'ar-EG' : 'en', {
    dateStyle: 'medium', timeStyle: 'short', ...(timeZone ? { timeZone } : {}),
  });
}
export function hiringDay(value: string, rtl = false) {
  // A PostgreSQL calendar DATE is not an instant; keep its day in every browser timezone.
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const date = dateOnly ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])) : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString(rtl ? 'ar-EG' : 'en', { dateStyle: 'medium' }) : '—';
}
export function prerequisiteTitle(task: { dependencyId?: string }, tasks: Array<{ id: string; title: string }>) {
  return task.dependencyId ? tasks.find(t => t.id === task.dependencyId)?.title : null;
}
