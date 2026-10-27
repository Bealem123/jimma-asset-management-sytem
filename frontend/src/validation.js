/**
 * Centralized Client-Side Validation Utilities for Jimma City Asset Management System
 * Mirrors the backend validation rules in backend/src/lib/schemas.js
 */

// Unicode letters covering Latin (English, Afaan Oromo) and Ethiopic (Amharic \u1200-\u137F)
export const PERSON_NAME_REGEX = /^[\p{L}][\p{L}\s.'’`-]*$/u;
export const HAS_DIGIT_REGEX = /\d/;
export const ORG_NAME_REGEX = /^[\p{L}\p{N}][\p{L}\p{N}\s&/.,'’()\-]{1,199}$/u;
export const USERNAME_REGEX = /^[A-Za-z0-9][A-Za-z0-9._-]{2,49}$/;
export const ASSET_CODE_REGEX = /^AST-\d{6}$/i;
export const PHONE_REGEX = /^\+?[1-9]\d{7,14}$/;
export const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 15MB
export const ALLOWED_DOC_EXTS = ['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.doc', '.docx', '.xls', '.xlsx'];
export const ALLOWED_PHOTO_EXTS = ['.jpg', '.jpeg', '.png', '.webp'];

/**
 * Normalizes phone numbers consistently (E.164 where applicable, handling Ethiopian local prefixes).
 */
export function normalizePhone(raw) {
  if (!raw || typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (/[a-zA-Z]/.test(trimmed)) return trimmed; // let validation fail
  const clean = trimmed.replace(/[\s\-.()]/g, '');
  if (/^0\d{9}$/.test(clean)) return `+251${clean.slice(1)}`;
  if (/^251\d{9}$/.test(clean)) return `+${clean}`;
  if (/^9\d{8}$/.test(clean)) return `+251${clean}`;
  if (/^7\d{8}$/.test(clean)) return `+251${clean}`;
  return clean;
}

/**
 * Checks whether a YYYY-MM-DD string is a real calendar date (rejecting Feb 30/31, April 31, etc.).
 */
export function isValidCalendarDate(str) {
  if (typeof str !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str.trim());
  if (!match) return false;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const utc = new Date(Date.UTC(y, m - 1, d));
  return utc.getUTCFullYear() === y && utc.getUTCMonth() === m - 1 && utc.getUTCDate() === d;
}

/**
 * Validates a person's full name.
 * Rejects digits, numbers-only, and invalid symbols.
 * Accepts English, Amharic, Afaan Oromo, spaces, hyphens, and apostrophes.
 */
export function validatePersonName(val, { required = false, label = 'Name', max = 160 } = {}) {
  if (val == null || String(val).trim() === '') {
    return required ? `${label} is required.` : null;
  }
  const str = String(val).trim();
  if (HAS_DIGIT_REGEX.test(str)) {
    return `${label} cannot contain numbers.`;
  }
  if (!PERSON_NAME_REGEX.test(str)) {
    return `${label} must contain only letters, spaces, hyphens, and apostrophes.`;
  }
  if (str.length > max) {
    return `${label} cannot exceed ${max} characters.`;
  }
  return null;
}

/**
 * Validates an organization, institution, or supplier name.
 */
export function validateOrgName(val, { required = false, label = 'Organization name', max = 200 } = {}) {
  if (val == null || String(val).trim() === '') {
    return required ? `${label} is required.` : null;
  }
  const str = String(val).trim();
  if (str.length < 2) {
    return `${label} must be at least 2 characters.`;
  }
  if (str.length > max) {
    return `${label} cannot exceed ${max} characters.`;
  }
  if (!/[\p{L}]/u.test(str)) {
    return `${label} must contain at least one letter.`;
  }
  if (!ORG_NAME_REGEX.test(str)) {
    return `${label} contains invalid characters.`;
  }
  return null;
}

/**
 * The name of a person or of an office, where either may be given (holder, payer, provider, authorised by ...).
 * Mirrors the server: at least one letter, and only the characters a name or an office uses.
 */
export const NAME_TEXT_REGEX = /^[\p{L}\p{N}][\p{L}\p{N}\s&/.,'’`()\-]*$/u;
export function validateNameText(val, { required = false, label = 'Name', max = 200 } = {}) {
  if (val == null || String(val).trim() === '') {
    return required ? `${label} is required.` : null;
  }
  const str = String(val).trim();
  if (str.length > max) return `${label} cannot exceed ${max} characters.`;
  if (!/\p{L}/u.test(str)) return `${label} must contain at least one letter.`;
  if (!NAME_TEXT_REGEX.test(str)) return `${label} contains characters a name cannot have.`;
  return null;
}

/**
 * Validates a phone number, supporting Ethiopian prefixes and standard international formats.
 */
export function validatePhone(val, { required = false, label = 'Phone number' } = {}) {
  if (val == null || String(val).trim() === '') {
    return required ? `${label} is required.` : null;
  }
  const str = String(val).trim();
  if (/[a-zA-Z]/.test(str)) {
    return `${label} cannot contain letters.`;
  }
  const normalized = normalizePhone(str);
  if (!PHONE_REGEX.test(normalized)) {
    return `${label} must be a valid phone number (e.g. +251 9... or 09...).`;
  }
  return null;
}

/**
 * Validates an email address.
 */
export function validateEmail(val, { required = false, label = 'Email' } = {}) {
  if (val == null || String(val).trim() === '') {
    return required ? `${label} is required.` : null;
  }
  const str = String(val).trim();
  if (str.length > 190) {
    return `${label} cannot exceed 190 characters.`;
  }
  if (!EMAIL_REGEX.test(str)) {
    return `Enter a valid email address.`;
  }
  return null;
}

/**
 * Validates a username.
 */
export function validateUsername(val, { required = true, label = 'Username' } = {}) {
  if (val == null || String(val).trim() === '') {
    return required ? `${label} is required.` : null;
  }
  const str = String(val).trim();
  if (str.length < 3) {
    return `${label} must be at least 3 characters.`;
  }
  if (str.length > 50) {
    return `${label} cannot exceed 50 characters.`;
  }
  if (!USERNAME_REGEX.test(str)) {
    return `${label} may only contain letters, numbers, dots, dashes, and underscores.`;
  }
  return null;
}

/**
 * Validates a password.
 */
export function validatePassword(val, { required = true, min = 8, max = 100, label = 'Password' } = {}) {
  if (val == null || String(val) === '') {
    return required ? `${label} is required.` : null;
  }
  const str = String(val);
  if (str.length < min) {
    return `${label} must be at least ${min} characters.`;
  }
  if (str.length > max) {
    return `${label} cannot exceed ${max} characters.`;
  }
  // the same rule as the server: both cases of letters, a number and a symbol
  if (!/\p{Ll}/u.test(str) || !/\p{Lu}/u.test(str)) return 'Use both upper-case and lower-case letters.';
  if (!/\d/.test(str)) return 'Include at least one number.';
  if (!/[^\p{L}\d\s]/u.test(str)) return 'Include at least one symbol, e.g. ! @ # - _';
  return null;
}

/**
 * Validates a monetary amount.
 * Rejects negative values, non-numeric strings, and more than 2 decimal places.
 */
export function validateMoney(val, { required = false, min = 0, max = 999999999999.99, label = 'Amount' } = {}) {
  if (val == null || String(val).trim() === '') {
    return required ? `${label} is required.` : null;
  }
  const str = String(val).trim();
  if (!/^-?\d+(\.\d+)?$/.test(str)) {
    return `${label} must be a valid number.`;
  }
  const num = Number(str);
  if (Number.isNaN(num) || !Number.isFinite(num)) {
    return `${label} must be a valid number.`;
  }
  if (num < min) {
    return `${label} cannot be negative.`;
  }
  if (num > max) {
    return `${label} exceeds the maximum allowed value.`;
  }
  const parts = str.split('.');
  if (parts.length > 1 && parts[1].length > 2) {
    return `${label} can have at most 2 decimal places.`;
  }
  return null;
}

/**
 * Validates an integer quantity.
 */
export function validateQuantity(val, { required = false, min = 0, max = 1000000, label = 'Quantity' } = {}) {
  if (val == null || String(val).trim() === '') {
    return required ? `${label} is required.` : null;
  }
  const str = String(val).trim();
  if (!/^-?\d+$/.test(str)) {
    return `${label} must be a whole number.`;
  }
  const num = Number(str);
  if (num < min) {
    return `${label} must be at least ${min}.`;
  }
  if (num > max) {
    return `${label} cannot exceed ${max}.`;
  }
  return null;
}

/**
 * Validates a calendar date string (YYYY-MM-DD).
 */
export function validateDate(val, { required = false, min, max, label = 'Date' } = {}) {
  if (val == null || String(val).trim() === '') {
    return required ? `${label} is required.` : null;
  }
  const str = String(val).trim();
  if (!isValidCalendarDate(str)) {
    return `Enter a valid date.`;
  }
  if (min && str < min) {
    return `${label} cannot be before ${min}.`;
  }
  if (max && str > max) {
    return `${label} cannot be after ${max}.`;
  }
  return null;
}

/**
 * Validates a start date and end date relationship.
 */
export function validateDateRange(startDate, endDate, { startLabel = 'Start date', endLabel = 'End date' } = {}) {
  if (!startDate || !endDate) return null;
  if (endDate < startDate) {
    return `${endLabel} cannot be before ${startLabel.toLowerCase()}.`;
  }
  return null;
}

/**
 * Validates a selection against an allowed array of values.
 */
export function validateEnum(val, allowedValues, { required = false, label = 'Selection' } = {}) {
  if (val == null || String(val).trim() === '') {
    return required ? `${label} is required.` : null;
  }
  const str = String(val).trim();
  if (!allowedValues.map(String).includes(str)) {
    return `Select an available option.`;
  }
  return null;
}

/**
 * Validates a file upload (type and size).
 */
export function validateFile(file, { allowedExts = ALLOWED_DOC_EXTS, maxBytes = MAX_UPLOAD_BYTES, required = false, label = 'File' } = {}) {
  if (!file) {
    return required ? `Choose a ${label.toLowerCase()} to upload.` : null;
  }
  if (file.size > maxBytes) {
    const mb = Math.round(maxBytes / (1024 * 1024));
    return `${label} size cannot exceed ${mb}MB.`;
  }
  const name = file.name || '';
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
  if (!allowedExts.includes(ext)) {
    return `Allowed file formats: ${allowedExts.join(', ')}.`;
  }
  return null;
}

/**
 * Validates latitude / longitude coordinates.
 */
export function validateLatitude(val, { required = false, label = 'Latitude' } = {}) {
  if (val == null || String(val).trim() === '') return required ? `${label} is required.` : null;
  const num = Number(val);
  if (Number.isNaN(num) || num < -90 || num > 90) return `${label} must be between -90 and 90.`;
  return null;
}

export function validateLongitude(val, { required = false, label = 'Longitude' } = {}) {
  if (val == null || String(val).trim() === '') return required ? `${label} is required.` : null;
  const num = Number(val);
  if (Number.isNaN(num) || num < -180 || num > 180) return `${label} must be between -180 and 180.`;
  return null;
}

/**
 * Universal field validator runner for forms.
 * Accepts a field definition or validator type and returns error string or null.
 */
export function validateField(val, rule, allValues = {}) {
  if (!rule) return null;
  if (typeof rule === 'function') return rule(val, allValues);

  const { type, required, label, min, max, allowed, startField } = rule;

  if (required && (val == null || String(val).trim() === '')) {
    return `${label || 'This field'} is required.`;
  }
  if (val == null || String(val).trim() === '') {
    return null; // optional and blank
  }

  switch (type) {
    case 'personName':
      return validatePersonName(val, { required, label, max });
    case 'orgName':
      return validateOrgName(val, { required, label, max });
    case 'phone':
      return validatePhone(val, { required, label });
    case 'email':
      return validateEmail(val, { required, label });
    case 'username':
      return validateUsername(val, { required, label });
    case 'password':
      return validatePassword(val, { required, min, max, label });
    case 'money':
      return validateMoney(val, { required, min, max, label });
    case 'quantity':
      return validateQuantity(val, { required, min, max, label });
    case 'date':
      return validateDate(val, { required, min, max, label });
    case 'dateRange':
      return startField && allValues[startField]
        ? validateDateRange(allValues[startField], val, { startLabel: startField, endLabel: label })
        : null;
    case 'enum':
      return allowed ? validateEnum(val, allowed, { required, label }) : null;
    case 'file':
      return validateFile(val, { required, label });
    case 'lat':
      return validateLatitude(val, { required, label });
    case 'lng':
      return validateLongitude(val, { required, label });
    default:
      return null;
  }
}
