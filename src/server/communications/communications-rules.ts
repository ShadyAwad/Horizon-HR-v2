import { COMMUNICATION_TYPES, COMMUNICATION_VARIABLES } from '../../lib/communications-contract';
export const MESSAGE_TYPES = COMMUNICATION_TYPES, TEMPLATE_VARIABLES = COMMUNICATION_VARIABLES;
export const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
export const fail = (statusCode: number, code: string, message: string) => Object.assign(new Error(message), { statusCode, code });
export function text(value: unknown, name: string, max: number, required = true) { if (typeof value !== 'string' || value.length > max || (required && !value.trim()))
    throw fail(400, 'VALIDATION_ERROR', `${name} is invalid.`); return value.trim(); }
export function category(value: unknown) { if (!(MESSAGE_TYPES as readonly unknown[]).includes(value))
    throw fail(400, 'VALIDATION_ERROR', 'Unsupported message type.'); return String(value); }
export function variablesIn(value: string) { const found = [...value.matchAll(/{{\s*([^{}]+?)\s*}}/g)].map(m => m[1]); if (found.some(v => !(TEMPLATE_VARIABLES as readonly string[]).includes(v)))
    throw fail(400, 'UNKNOWN_VARIABLE', 'Template contains an unsupported variable.'); return [...new Set(found)]; }
export function renderTemplate(value: string, variables: Record<string, unknown>) { variablesIn(value); return value.replace(/{{\s*([^{}]+?)\s*}}/g, (_, key) => { const resolved = variables[key]; if (typeof resolved !== 'string' || !resolved.trim() || resolved.length > 300)
    throw fail(400, 'UNRESOLVED_VARIABLE', `Provide a value for ${key}.`); return resolved; }); }
export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export function recipients(value: unknown) { if (!Array.isArray(value) || value.length > 20 || value.some(v => !uuid(v)))
    throw fail(400, 'VALIDATION_ERROR', 'Choose up to 20 company recipients.'); return [...new Set(value)] as string[]; }
export function meetingTimes(start: unknown, end: unknown, zone: unknown) { const timezone = text(zone, 'Timezone', 80); try {
    new Intl.DateTimeFormat('en', { timeZone: timezone });
}
catch {
    throw fail(400, 'VALIDATION_ERROR', 'Use a valid IANA timezone.');
} const s = new Date(String(start)), e = new Date(String(end)); if (!/Z$|[+-]\d{2}:\d{2}$/.test(String(start)) || !/Z$|[+-]\d{2}:\d{2}$/.test(String(end)) || !Number.isFinite(+s) || !Number.isFinite(+e) || e <= s || +e - +s > 7 * 86400000)
    throw fail(400, 'VALIDATION_ERROR', 'Meeting times must include an offset and a valid duration (up to seven days).'); return { startsAt: s.toISOString(), endsAt: e.toISOString(), timezone }; }
const icsText = (s: string) => s.replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/[,;]/g, '\\$&');
const stamp = (s: string) => new Date(s).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
export function calendarInvitation(m: {
    id: string;
    title: string;
    notes: string;
    location: string;
    starts_at: string;
    ends_at: string;
    status: string;
    version: number;
}, organizer: string, attendees: string[]) {
    if ([organizer, ...attendees].some(v => !/^[^\s@,;:]+@[^\s@,;:]+\.[^\s@,;:]+$/.test(v)))
        throw fail(400, 'INVALID_RECIPIENT', 'Calendar email address is invalid.');
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Stanza//Communications//EN', `METHOD:${m.status === 'cancelled' ? 'CANCEL' : 'REQUEST'}`, 'BEGIN:VEVENT', `UID:${m.id}@stanza`, `SEQUENCE:${m.version}`, `DTSTAMP:${stamp(new Date().toISOString())}`, `DTSTART:${stamp(m.starts_at)}`, `DTEND:${stamp(m.ends_at)}`, `SUMMARY:${icsText(m.title)}`, `DESCRIPTION:${icsText(m.notes)}`, `LOCATION:${icsText(m.location)}`, `STATUS:${m.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED'}`, `ORGANIZER:mailto:${organizer}`, ...attendees.map(v => `ATTENDEE:mailto:${v}`), 'END:VEVENT', 'END:VCALENDAR'];
    // RFC 5545 folding by UTF-8 octet length, without splitting a code point.
    return lines.map(line => { let out = '', part = ''; for (const ch of line) {
        if (Buffer.byteLength(part + ch) > 74) {
            out += part + '\r\n';
            part = ' ';
        }
        part += ch;
    } return out + part; }).join('\r\n') + '\r\n';
}
