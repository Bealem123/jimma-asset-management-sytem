import { z } from 'zod';

// Forms send '' for empty fields; treat that (and null/undefined) as "not provided".
const blankToNull = (v) => (v === '' || v === undefined ? null : v);

export const idRef = z.coerce.number().int().positive();
export const optIdRef = z.preprocess(blankToNull, idRef.nullable()).default(null);
export const reqStr = (max = 255, label = 'This field') =>
  z.string({ error: `${label} is required.` }).trim().min(1, `${label} is required.`).max(max, `Maximum ${max} characters.`);
export const optStr = (max = 255) =>
  z.preprocess(blankToNull, z.string().trim().max(max, `Maximum ${max} characters.`).nullable()).default(null);
export const dateStr = z
  .string({ error: 'A date is required.' })
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD.')
  .refine((s) => !Number.isNaN(Date.parse(s)), 'Not a valid date.');
export const optDate = z.preprocess(blankToNull, dateStr.nullable()).default(null);
export const money = z.preprocess(
  blankToNull,
  z.coerce.number({ error: 'Enter a number.' }).min(0, 'Cannot be negative.').max(9_999_999_999_999, 'Too large.').nullable(),
).default(null);
export const reqMoney = z.coerce.number({ error: 'Enter a number.' }).min(0, 'Cannot be negative.').max(9_999_999_999_999, 'Too large.');
export const lat = z.preprocess(blankToNull, z.coerce.number().min(-90).max(90).nullable()).default(null);
export const lng = z.preprocess(blankToNull, z.coerce.number().min(-180).max(180).nullable()).default(null);
export const bool = z.preprocess((v) => (v === 'true' || v === '1' || v === 1 ? true : v === 'false' || v === '0' || v === 0 ? false : v), z.boolean());
export const oneOf = (values, label = 'Value') =>
  z.enum(values, { error: `${label} must be one of: ${values.join(', ')}.` });

/**
 * For PATCH requests: keep only the keys the client actually sent.
 * (Zod fills defaults for omitted keys, which would otherwise overwrite stored values with null.)
 */
export const present = (parsed, raw) => Object.fromEntries(Object.entries(parsed).filter(([k]) => k in raw));

/** Build a LIKE pattern that matches the text literally (escapes % _ and the escape character). */
export const likePattern = (text) => `%${text.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
