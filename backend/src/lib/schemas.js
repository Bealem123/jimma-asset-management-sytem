import { z } from 'zod';
import { HttpError } from '../middleware/errors.js';
import { notAfterToday } from './calendar.js';

// Forms send '' for empty fields; treat that (and null/undefined) as "not provided".
export const blankToNull = (v) => (v === '' || v === undefined ? null : v);

export const idRef = z.coerce.number().int().positive();
export const optIdRef = z.preprocess(blankToNull, idRef.nullable()).default(null);

export const reqStr = (max = 255, label = 'This field') =>
  z.string({ error: `${label} is required.` }).trim().min(1, `${label} is required.`).max(max, `Maximum ${max} characters.`);
export const optStr = (max = 255) =>
  z.preprocess(blankToNull, z.string().trim().max(max, `Maximum ${max} characters.`).nullable()).default(null);

// ---------------------------------------------------------------- Names
// Unicode letters \p{L}: includes Latin (English, Afaan Oromo) and Ethiopic (Amharic \u1200-\u137F)
// Allowed characters in person names: letters, spaces, hyphens, periods (initials), apostrophes/hudhaa (' ’ `)
// Strictly rejects numeric digits (\d) and symbols.
export const PERSON_NAME_REGEX = /^[\p{L}][\p{L}\s.'’`-]*$/u;
export const HAS_DIGIT_REGEX = /\d/;

export function isValidPersonName(str) {
  if (typeof str !== 'string') return false;
  const trimmed = str.trim();
  if (trimmed.length < 1 || trimmed.length > 160) return false;
  if (HAS_DIGIT_REGEX.test(trimmed)) return false;
  return PERSON_NAME_REGEX.test(trimmed);
}

export const reqPersonName = (max = 160, label = 'Name') =>
  z.string({ error: `${label} is required.` })
    .trim()
    .min(1, `${label} is required.`)
    .max(max, `Maximum ${max} characters.`)
    .refine((v) => !HAS_DIGIT_REGEX.test(v), `${label} cannot contain numbers.`)
    .refine((v) => PERSON_NAME_REGEX.test(v), `${label} must contain only letters, spaces, hyphens, and apostrophes.`);

export const optPersonName = (max = 160, label = 'Name') =>
  z.preprocess(
    blankToNull,
    z.string()
      .trim()
      .min(1, `${label} is required.`)
      .max(max, `Maximum ${max} characters.`)
      .refine((v) => !HAS_DIGIT_REGEX.test(v), `${label} cannot contain numbers.`)
      .refine((v) => PERSON_NAME_REGEX.test(v), `${label} must contain only letters, spaces, hyphens, and apostrophes.`)
      .nullable(),
  ).default(null);

// Organization / Institution Name
export const ORG_NAME_REGEX = /^[\p{L}\p{N}][\p{L}\p{N}\s&/.,'’()\-]{1,199}$/u;
export const reqOrgName = (max = 200, label = 'Name') =>
  z.string({ error: `${label} is required.` })
    .trim()
    .min(2, `${label} must be at least 2 characters.`)
    .max(max, `Maximum ${max} characters.`)
    .refine((v) => /[\p{L}]/u.test(v), `${label} must contain at least one letter.`)
    .refine((v) => ORG_NAME_REGEX.test(v), `${label} contains invalid characters.`);

export const optOrgName = (max = 200, label = 'Name') =>
  z.preprocess(
    blankToNull,
    z.string()
      .trim()
      .min(2, `${label} must be at least 2 characters.`)
      .max(max, `Maximum ${max} characters.`)
      .refine((v) => /[\p{L}]/u.test(v), `${label} must contain at least one letter.`)
      .refine((v) => ORG_NAME_REGEX.test(v), `${label} contains invalid characters.`)
      .nullable(),
  ).default(null);

// The name of a person or of an office, where either may be given (holder, payer, provider, authorised by ...):
// at least one letter, and only the characters a name or an office uses (digits are allowed: "Kebele 05 office").
export const NAME_TEXT_REGEX = /^[\p{L}\p{N}][\p{L}\p{N}\s&/.,'’`()\-]*$/u;
const nameText = (max, label) => z.string().trim().max(max, `Maximum ${max} characters.`)
  .refine((v) => /\p{L}/u.test(v), `${label} must contain at least one letter.`)
  .refine((v) => NAME_TEXT_REGEX.test(v), `${label} contains characters a name cannot have.`);
export const reqNameText = (max = 200, label = 'Name') =>
  z.string({ error: `${label} is required.` }).trim().min(1, `${label} is required.`).pipe(nameText(max, label));
export const optNameText = (max = 200, label = 'Name') =>
  z.preprocess(blankToNull, nameText(max, label).nullable()).default(null);

// ---------------------------------------------------------------- Phone Numbers
// Normalizes Ethiopian (09..., 07..., +251...) and standard international numbers.
export function normalizePhone(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/[a-zA-Z]/.test(trimmed)) return trimmed; // let validation fail
  const clean = trimmed.replace(/[\s\-.()]/g, '');
  if (/^0\d{9}$/.test(clean)) return `+251${clean.slice(1)}`;
  if (/^[79]\d{8}$/.test(clean)) return `+251${clean}`;
  return clean;
}

export const PHONE_REGEX = /^\+?[1-9]\d{7,14}$/;

export const phoneSchema = z.preprocess(
  (v) => (v === '' || v === undefined ? null : normalizePhone(String(v))),
  z.string({ error: 'Enter a valid phone number.' })
    .trim()
    .min(9, 'Phone number must have at least 9 digits.')
    .max(20, 'Phone number is too long.')
    .refine((v) => !/[a-zA-Z]/.test(v), 'Phone number cannot contain letters.')
    .refine((v) => PHONE_REGEX.test(v), 'Enter a valid phone number (e.g. +251 911 223 344 or 0911 223 344).'),
);

export const optPhone = z.preprocess(
  (v) => (v === '' || v === undefined ? null : normalizePhone(String(v))),
  z.string()
    .trim()
    .min(9, 'Phone number must have at least 9 digits.')
    .max(20, 'Phone number is too long.')
    .refine((v) => !/[a-zA-Z]/.test(v), 'Phone number cannot contain letters.')
    .refine((v) => PHONE_REGEX.test(v), 'Enter a valid phone number (e.g. +251 911 223 344 or 0911 223 344).')
    .nullable(),
).default(null);

// ---------------------------------------------------------------- Email
export const emailSchema = z
  .string({ error: 'Enter a valid email address.' })
  .trim()
  .toLowerCase()
  .max(190, 'Email cannot exceed 190 characters.')
  .email('Enter a valid email address.');

export const optEmail = z.preprocess(
  blankToNull,
  z.string()
    .trim()
    .toLowerCase()
    .max(190, 'Email cannot exceed 190 characters.')
    .email('Enter a valid email address.')
    .nullable(),
).default(null);

// ---------------------------------------------------------------- Username & Password
// letters of any script, so that a first name written in Amharic can be a username too
export const USERNAME_REGEX = /^[\p{L}\p{N}._-]+$/u;
export const usernameSchema = z
  .string({ error: 'Username is required.' })
  .trim()
  .min(3, 'At least 3 characters.')
  .max(80, 'Maximum 80 characters.')
  .regex(USERNAME_REGEX, 'Letters, numbers, dot, dash and underscore only.')
  .refine((v) => /[\p{L}\p{N}]/u.test(v), 'Username must contain at least one letter or number.');

// At least 8 characters with an upper-case and a lower-case letter, a number and a symbol (the usual audit rule).
export const passwordSchema = z
  .string({ error: 'Password is required.' })
  .min(8, 'Use at least 8 characters.')
  .max(100, 'Maximum 100 characters.')
  .refine((v) => v.trim().length >= 8, 'Use at least 8 characters, not only spaces.')
  .refine((v) => /\p{Ll}/u.test(v) && /\p{Lu}/u.test(v), 'Use both upper-case and lower-case letters.')
  .refine((v) => /\d/.test(v), 'Include at least one number.')
  .refine((v) => /[^\p{L}\d\s]/u.test(v), 'Include at least one symbol, e.g. ! @ # - _');

// ---------------------------------------------------------------- Dates
export function isValidCalendarDate(str) {
  if (typeof str !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const [y, m, d] = str.split('-').map(Number);
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export const dateStr = z
  .string({ error: 'A date is required.' })
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD.')
  .refine(isValidCalendarDate, 'Not a valid calendar date.');

export const optDate = z.preprocess(blankToNull, dateStr.nullable()).default(null);

// The day something already happened (bought, inspected, approved): it cannot lie in the future.
export const pastDate = dateStr.refine((d) => notAfterToday(d), 'This date cannot be in the future.');
export const optPastDate = z.preprocess(blankToNull, pastDate.nullable()).default(null);

export const dateTimeStr = z
  .string({ error: 'A date and time is required.' })
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/, 'Use the format YYYY-MM-DD HH:MM.')
  .refine((s) => isValidCalendarDate(s.slice(0, 10)), 'Not a valid calendar date.')
  .transform((s) => `${s.replace('T', ' ')}${s.length === 16 ? ':00' : ''}`);

export const optDateTime = z.preprocess(blankToNull, dateTimeStr.nullable()).default(null);

export function assertDateOrder(start, end, startLabel = 'Start date', endLabel = 'End date') {
  if (!start || !end) return;
  if (end < start) {
    throw new HttpError(400, 'Please correct the highlighted fields.', {
      end_date: `${endLabel} must be on or after ${startLabel}.`,
    });
  }
}

// ---------------------------------------------------------------- Financial & Quantities
export const money = z.preprocess(
  blankToNull,
  z.coerce
    .number({ error: 'Enter a number.' })
    .min(0, 'Cannot be negative.')
    .max(9_999_999_999_999, 'Too large.')
    .refine((n) => Number.isFinite(n), 'Must be a finite number.')
    .transform((n) => (n == null ? null : Math.round(n * 100) / 100))
    .nullable(),
).default(null);

export const reqMoney = z.coerce
  .number({ error: 'Enter a number.' })
  .min(0, 'Cannot be negative.')
  .max(9_999_999_999_999, 'Too large.')
  .refine((n) => Number.isFinite(n), 'Must be a finite number.')
  .transform((n) => Math.round(n * 100) / 100);

export const usefulLifeYears = z.preprocess(
  blankToNull,
  z.coerce
    .number({ error: 'Useful life must be a number.' })
    .int('Useful life must be a whole number.')
    .min(1, 'Useful life must be at least 1 year.')
    .max(200, 'Useful life cannot exceed 200 years.')
    .nullable(),
).default(null);

// ---------------------------------------------------------------- Coordinates
export const lat = z.preprocess(
  blankToNull,
  z.coerce
    .number({ error: 'Latitude must be a number.' })
    .min(-90, 'Latitude must be between -90 and 90.')
    .max(90, 'Latitude must be between -90 and 90.')
    .nullable(),
).default(null);

export const lng = z.preprocess(
  blankToNull,
  z.coerce
    .number({ error: 'Longitude must be a number.' })
    .min(-180, 'Longitude must be between -180 and 180.')
    .max(180, 'Longitude must be between -180 and 180.')
    .nullable(),
).default(null);

export const bool = z.preprocess(
  (v) => (v === 'true' || v === '1' || v === 1 ? true : v === 'false' || v === '0' || v === 0 ? false : v),
  z.boolean(),
);

// ---------------------------------------------------------------- Enums
export const oneOf = (values, label = 'Value') =>
  z.enum(values, { error: `${label} must be one of: ${values.join(', ')}.` });

// ---------------------------------------------------------------- Serial & Registration Numbers
export const SERIAL_REGEX = /^[A-Za-z0-9\-_/.:]{1,120}$/;
export const optSerial = z.preprocess(
  blankToNull,
  z.string()
    .trim()
    .max(120, 'Maximum 120 characters.')
    .refine((v) => SERIAL_REGEX.test(v), 'Serial number contains invalid characters.')
    .nullable(),
).default(null);

export const optRegistrationNum = z.preprocess(
  blankToNull,
  z.string()
    .trim()
    .max(120, 'Maximum 120 characters.')
    .refine((v) => /^[A-Za-z0-9\-_/.:\s]{1,120}$/.test(v), 'Registration number contains invalid characters.')
    .nullable(),
).default(null);

// ---------------------------------------------------------------- Pagination & Search
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1, 'Page must be at least 1.').default(1),
  page_size: z.coerce.number().int().min(1).max(500, 'Page size cannot exceed 500.').default(25),
});

export const sanitizeSearchQuery = (q) => (typeof q === 'string' ? q.replace(/[\0\x08\x09\x1a\n\r]/g, '').trim().slice(0, 200) : '');

/**
 * For PATCH requests: keep only the keys the client actually sent.
 * (Zod fills defaults for omitted keys, which would otherwise overwrite stored values with null.)
 */
export const present = (parsed, raw) => Object.fromEntries(Object.entries(parsed).filter(([k]) => k in raw));

/** Build a LIKE pattern that matches the text literally (escapes % _ and the escape character). */
export const likePattern = (text) => `%${text.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
