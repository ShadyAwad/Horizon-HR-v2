import type {
  ConfidenceLevel,
  ExtractedField,
  ExtractionMode,
  ExtractionWarning,
  StructuredExtraction,
} from './extraction-types';
import type { ProviderExtraction, ProviderFieldCandidate } from './extraction-provider';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;

function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.replace(CONTROL_CHARACTERS, ' ').replace(/\s+/g, ' ').trim();
  return clean ? clean.slice(0, maxLength) : null;
}

function confidence(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(1, Math.max(0, value));
}

export function confidenceLevel(value: number | null): ConfidenceLevel {
  if (value === null) return 'unavailable';
  if (value >= 0.85) return 'high';
  if (value >= 0.6) return 'medium';
  return 'low';
}

function field(candidate: ProviderFieldCandidate | undefined, value: string | null, warning: string | null = null): ExtractedField {
  const score = confidence(candidate?.confidence);
  const confidenceWarning = score !== null && score < 0.6 ? 'LOW_CONFIDENCE' : null;
  return {
    value,
    confidence: score,
    confidenceLevel: confidenceLevel(score),
    warning: warning || confidenceWarning,
  };
}

function addWarning(warnings: ExtractionWarning[], code: string, fieldName: string, message: string) {
  warnings.push({ code, field: fieldName, message });
}

function normalizeAmount(candidate: ProviderFieldCandidate | undefined, warnings: ExtractionWarning[]) {
  const raw = cleanText(candidate?.value, 40);
  if (!raw) return field(candidate, null);
  let normalized = raw.replace(/\s/g, '');
  if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(normalized)) normalized = normalized.replace(/,/g, '');
  else if (/^\d+,\d{1,2}$/.test(normalized)) normalized = normalized.replace(',', '.');
  if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(normalized)) {
    addWarning(warnings, 'INVALID_AMOUNT', 'totalAmount', 'The detected total needs manual review.');
    return field(candidate, null, 'INVALID_FORMAT');
  }
  const [whole, decimals] = normalized.split('.');
  return field(candidate, decimals === undefined ? whole : `${whole}.${decimals.padEnd(2, '0')}`);
}

function normalizeDate(candidate: ProviderFieldCandidate | undefined, warnings: ExtractionWarning[]) {
  const raw = cleanText(candidate?.value, 40);
  if (!raw) return field(candidate, null);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    addWarning(warnings, 'AMBIGUOUS_DATE', 'transactionDate', 'The detected date is ambiguous and needs manual review.');
    return field(candidate, null, 'AMBIGUOUS_DATE');
  }
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== raw) {
    addWarning(warnings, 'INVALID_DATE', 'transactionDate', 'The detected date is invalid.');
    return field(candidate, null, 'INVALID_FORMAT');
  }
  return field(candidate, raw);
}

function normalizeExpense(provider: ProviderExtraction): StructuredExtraction {
  const warnings: ExtractionWarning[] = [];
  const merchant = provider.fields.merchantName;
  const currencyCandidate = provider.fields.currency;
  const currency = cleanText(currencyCandidate?.value, 3)?.toUpperCase() || null;
  if (currency && !/^[A-Z]{3}$/.test(currency)) addWarning(warnings, 'INVALID_CURRENCY', 'currency', 'The detected currency needs manual review.');
  return {
    fields: {
      merchantName: field(merchant, cleanText(merchant?.value, 160)),
      transactionDate: normalizeDate(provider.fields.transactionDate, warnings),
      totalAmount: normalizeAmount(provider.fields.totalAmount, warnings),
      currency: field(currencyCandidate, currency && /^[A-Z]{3}$/.test(currency) ? currency : null, currency && !/^[A-Z]{3}$/.test(currency) ? 'INVALID_FORMAT' : null),
    },
    warnings,
  };
}

function normalizeCandidate(provider: ProviderExtraction): StructuredExtraction {
  const warnings: ExtractionWarning[] = [];
  const emailCandidate = provider.fields.email;
  const email = cleanText(emailCandidate?.value, 254);
  const invalidEmail = Boolean(email && !EMAIL_PATTERN.test(email));
  if (invalidEmail) addWarning(warnings, 'INVALID_EMAIL', 'email', 'The detected email format needs manual review.');
  const phoneCandidate = provider.fields.phoneNumber;
  const phone = cleanText(phoneCandidate?.value, 40);
  const validPhone = !phone || /^[+()\d\s.-]{3,40}$/.test(phone);
  if (!validPhone) addWarning(warnings, 'INVALID_PHONE', 'phoneNumber', 'The detected phone number needs manual review.');
  return {
    fields: {
      fullName: field(provider.fields.fullName, cleanText(provider.fields.fullName?.value, 160)),
      email: field(emailCandidate, email, invalidEmail ? 'INVALID_FORMAT' : null),
      phoneNumber: field(phoneCandidate, validPhone ? phone : null, validPhone ? null : 'INVALID_FORMAT'),
    },
    warnings,
  };
}

function removeSafeLabelPrefix(value: string | null) {
  return value?.replace(/^(?:s\/n|serial(?:\s+number)?|model(?:\s+number)?|barcode)\s*:\s*/i, '').trim() || null;
}

function normalizeAsset(provider: ProviderExtraction): StructuredExtraction {
  return {
    fields: {
      serialNumber: field(provider.fields.serialNumber, removeSafeLabelPrefix(cleanText(provider.fields.serialNumber?.value, 160))),
      modelNumber: field(provider.fields.modelNumber, removeSafeLabelPrefix(cleanText(provider.fields.modelNumber?.value, 160))),
      manufacturer: field(provider.fields.manufacturer, cleanText(provider.fields.manufacturer?.value, 160)),
      barcodeText: field(provider.fields.barcodeText, removeSafeLabelPrefix(cleanText(provider.fields.barcodeText?.value, 200))),
    },
    warnings: [],
  };
}

export function normalizeProviderExtraction(mode: ExtractionMode, provider: ProviderExtraction): StructuredExtraction {
  const normalized = mode === 'expense_receipt'
    ? normalizeExpense(provider)
    : mode === 'candidate_document'
      ? normalizeCandidate(provider)
      : normalizeAsset(provider);
  const providerWarnings = (provider.warnings || []).slice(0, 20).map((warning) => ({
    code: cleanText(warning.code, 60) || 'PROVIDER_WARNING',
    field: cleanText(warning.field, 60),
    message: cleanText(warning.message, 240) || 'Review the extracted value.',
  }));
  normalized.warnings.push(...providerWarnings);
  return normalized;
}
