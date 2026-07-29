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

export const EXPENSE_CURRENCIES = [
  'AED', 'AUD', 'BHD', 'CAD', 'CHF', 'CNY', 'DKK', 'EGP', 'EUR', 'GBP',
  'HKD', 'INR', 'JPY', 'KWD', 'MAD', 'NOK', 'NZD', 'OMR', 'QAR', 'SAR',
  'SEK', 'SGD', 'TRY', 'USD', 'ZAR',
] as const;

export const EXPENSE_STATUSES = ['pending', 'approved', 'rejected', 'cancelled', 'reimbursed'] as const;

export type ExpenseCategory = typeof EXPENSE_CATEGORIES[number];
export type ExpenseStatus = typeof EXPENSE_STATUSES[number];

export const RECEIPT_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const RECEIPT_MAX_BYTES = 10 * 1024 * 1024;
export const EXPENSE_AMOUNT_PATTERN = /^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/;

export function isReceiptFile(file: File) {
  return (RECEIPT_MIME_TYPES as readonly string[]).includes(file.type) && file.size <= RECEIPT_MAX_BYTES;
}

