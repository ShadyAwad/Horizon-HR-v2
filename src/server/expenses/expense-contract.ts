import crypto from 'node:crypto';

export const EXPENSE_CATEGORIES = [
  'travel',
  'meals',
  'accommodation',
  'transport',
  'office_supplies',
  'software',
  'training',
  'communications',
  'other',
] as const;
export type ExpenseCategory = typeof EXPENSE_CATEGORIES[number];

export const EXPENSE_STATUSES = ['pending', 'approved', 'rejected', 'cancelled', 'reimbursed'] as const;
export type ExpenseStatus = typeof EXPENSE_STATUSES[number];

const CURRENCIES = new Set([
  'AED', 'AUD', 'BHD', 'CAD', 'CHF', 'CNY', 'DKK', 'EGP', 'EUR', 'GBP',
  'HKD', 'INR', 'JPY', 'KWD', 'MAD', 'NOK', 'NZD', 'OMR', 'QAR', 'SAR',
  'SEK', 'SGD', 'TRY', 'USD', 'ZAR',
]);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONEY = /^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,100}$/;

export class ExpenseError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function strictObject(value: unknown, allowedKeys: readonly string[], message = 'Expense claim payload is invalid.') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ExpenseError(400, 'EXPENSE_VALIDATION_ERROR', message);
  }
  const unknown = Object.keys(value).find((key) => !allowedKeys.includes(key));
  if (unknown) throw new ExpenseError(400, 'EXPENSE_VALIDATION_ERROR', message);
}

export function normalizeText(value: unknown, field: string, maximum: number, required = true) {
  if (value === undefined || value === null) {
    if (!required) return null;
    throw new ExpenseError(400, 'EXPENSE_VALIDATION_ERROR', `${field} is required.`);
  }
  if (typeof value !== 'string') throw new ExpenseError(400, 'EXPENSE_VALIDATION_ERROR', `${field} must be text.`);
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (required && !normalized) throw new ExpenseError(400, 'EXPENSE_VALIDATION_ERROR', `${field} is required.`);
  if (normalized.length > maximum) throw new ExpenseError(400, 'EXPENSE_VALIDATION_ERROR', `${field} must be ${maximum} characters or fewer.`);
  return normalized || null;
}

export function normalizeDate(value: unknown, field = 'expenseDate') {
  if (typeof value !== 'string' || !DATE.test(value)) {
    throw new ExpenseError(400, 'EXPENSE_VALIDATION_ERROR', `${field} must use YYYY-MM-DD.`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new ExpenseError(400, 'EXPENSE_VALIDATION_ERROR', `${field} is invalid.`);
  }
  return value;
}

export function normalizeAmount(value: unknown) {
  if (typeof value !== 'string' || !MONEY.test(value)) {
    throw new ExpenseError(400, 'EXPENSE_VALIDATION_ERROR', 'amount must be a positive decimal string with no more than two fractional digits.');
  }
  const [whole, fractional = ''] = value.split('.');
  const cents = BigInt(whole) * 100n + BigInt(fractional.padEnd(2, '0'));
  if (cents <= 0n || cents > 999_999_999_999n) {
    throw new ExpenseError(400, 'EXPENSE_VALIDATION_ERROR', 'amount is outside the supported range.');
  }
  return `${BigInt(whole).toString()}.${fractional.padEnd(2, '0')}`;
}

export function normalizeCurrency(value: unknown) {
  if (typeof value !== 'string') throw new ExpenseError(400, 'EXPENSE_VALIDATION_ERROR', 'currency is required.');
  const currency = value.trim().toUpperCase();
  if (!CURRENCIES.has(currency)) throw new ExpenseError(400, 'EXPENSE_VALIDATION_ERROR', 'currency is not supported.');
  return currency;
}

export function normalizeCategory(value: unknown): ExpenseCategory {
  if (typeof value !== 'string' || !(EXPENSE_CATEGORIES as readonly string[]).includes(value)) {
    throw new ExpenseError(400, 'EXPENSE_VALIDATION_ERROR', 'category is not supported.');
  }
  return value as ExpenseCategory;
}

export function normalizeExpectedVersion(value: unknown) {
  if (!Number.isInteger(value) || Number(value) < 1) {
    throw new ExpenseError(400, 'EXPENSE_VALIDATION_ERROR', 'expectedVersion is invalid.');
  }
  return Number(value);
}

export function normalizeIdempotencyKey(value: unknown) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !IDEMPOTENCY_KEY.test(value)) {
    throw new ExpenseError(400, 'EXPENSE_VALIDATION_ERROR', 'Idempotency-Key is invalid.');
  }
  return value;
}

export function requestFingerprint(input: {
  extractionId: string | null;
  merchantName: string;
  expenseDate: string;
  amount: string;
  currency: string;
  category: ExpenseCategory;
  businessReason: string;
}) {
  return crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

export function parsePage(value: unknown, fallback: number, maximum: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

export function isExpenseStatus(value: unknown): value is ExpenseStatus {
  return typeof value === 'string' && (EXPENSE_STATUSES as readonly string[]).includes(value);
}

export function isExpenseCategory(value: unknown): value is ExpenseCategory {
  return typeof value === 'string' && (EXPENSE_CATEGORIES as readonly string[]).includes(value);
}

export function isSupportedCurrency(value: unknown) {
  return typeof value === 'string' && CURRENCIES.has(value.toUpperCase());
}
