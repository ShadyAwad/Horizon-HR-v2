const BLOCKED_WORDS = [
  'damn',
  'hell',
  'crap',
  'idiot',
  'stupid',
  'dumb',
  'sucks',
  'suck',
];

const escapedWords = BLOCKED_WORDS.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
const blockedWordPattern = new RegExp(`\\b(${escapedWords.join('|')})\\b`, 'gi');

export function containsSensitiveContent(value: string) {
  blockedWordPattern.lastIndex = 0;
  return blockedWordPattern.test(value);
}

export function maskSensitiveText(value: string, enabled = true) {
  if (!enabled || !value) return value;

  blockedWordPattern.lastIndex = 0;
  return value.replace(blockedWordPattern, (match) => '•'.repeat([...match].length));
}

export function getSensitivityFilterDefault() {
  if (typeof window === 'undefined') return true;

  return window.localStorage.getItem('stanza-sensitive-content-filter') !== 'off';
}

export function saveSensitivityFilterPreference(enabled: boolean) {
  if (typeof window === 'undefined') return;

  window.localStorage.setItem('stanza-sensitive-content-filter', enabled ? 'on' : 'off');
}

export function maskSensitiveLexicalJson(value: unknown, enabled = true): unknown {
  if (!enabled || !value || typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    return value.map((entry) => maskSensitiveLexicalJson(entry, enabled));
  }

  const source = value as Record<string, unknown>;
  const next: Record<string, unknown> = {};

  for (const [key, entryValue] of Object.entries(source)) {
    if (key === 'text' && typeof entryValue === 'string') {
      next[key] = maskSensitiveText(entryValue, enabled);
    } else if (entryValue && typeof entryValue === 'object') {
      next[key] = maskSensitiveLexicalJson(entryValue, enabled);
    } else {
      next[key] = entryValue;
    }
  }

  return next;
}
