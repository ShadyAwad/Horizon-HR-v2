export type PasswordRuleKey = 'length' | 'uppercase' | 'lowercase' | 'number' | 'special';

export type PasswordRuleResult = {
  key: PasswordRuleKey;
  valid: boolean;
};

export const PASSWORD_RULE_LABELS: Record<PasswordRuleKey, string> = {
  length: 'At least 8 characters',
  uppercase: 'One uppercase letter',
  lowercase: 'One lowercase letter',
  number: 'One number',
  special: 'One special character',
};

export const EMAIL_VALIDATION_ERROR = 'Enter a valid email address.';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function validateEmail(value: unknown) {
  const email = normalizeEmail(value);

  return {
    value: email,
    valid: Boolean(email && EMAIL_REGEX.test(email)),
    error: email && EMAIL_REGEX.test(email) ? '' : EMAIL_VALIDATION_ERROR,
  };
}

export function getPasswordRuleResults(password: string): PasswordRuleResult[] {
  return [
    { key: 'length', valid: password.length >= 8 },
    { key: 'uppercase', valid: /[A-Z]/.test(password) },
    { key: 'lowercase', valid: /[a-z]/.test(password) },
    { key: 'number', valid: /\d/.test(password) },
    { key: 'special', valid: /[^A-Za-z0-9]/.test(password) },
  ];
}

export function validatePasswordStrength(password: unknown) {
  const value = typeof password === 'string' ? password : '';
  const rules = getPasswordRuleResults(value);
  const valid = rules.every((rule) => rule.valid);

  return {
    value,
    valid,
    rules,
    missingRules: rules.filter((rule) => !rule.valid).map((rule) => PASSWORD_RULE_LABELS[rule.key]),
  };
}

export function validateRequiredText(value: unknown, options: { min?: number; max?: number; label?: string } = {}) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  const label = options.label || 'This field';
  const min = options.min ?? 1;
  const max = options.max;

  if (normalized.length < min) {
    return {
      value: normalized,
      valid: false,
      error: min <= 1 ? `${label} is required.` : `${label} must be at least ${min} characters.`,
    };
  }

  if (typeof max === 'number' && normalized.length > max) {
    return {
      value: normalized,
      valid: false,
      error: `${label} must be ${max} characters or fewer.`,
    };
  }

  return {
    value: normalized,
    valid: true,
    error: '',
  };
}

export function validateLatitude(value: unknown) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue >= -90 && numberValue <= 90;
}

export function validateLongitude(value: unknown) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue >= -180 && numberValue <= 180;
}

export function validateRadiusMeters(value: unknown, min = 25, max = 5000) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue >= min && numberValue <= max;
}
