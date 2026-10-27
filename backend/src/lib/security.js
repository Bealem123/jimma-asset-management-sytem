// Protections shared by the whole API (see docs/SECURITY.md for how they answer an OWASP Top 10 / INSA audit).
import fs from 'node:fs';
import crypto from 'node:crypto';
import { HttpError } from '../middleware/errors.js';

/** Cost of the bcrypt password hash: 12 rounds (about a quarter second), the usual recommendation today. */
export const BCRYPT_ROUNDS = 12;

/** Signing in fails this many times in a row and the account waits LOCK_MINUTES before it may try again. */
export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 15;

/** A session with no request for this long ends: the person signs in again (the token itself lasts JWT_EXPIRES_IN). */
export const IDLE_MINUTES = Number(process.env.SESSION_IDLE_MINUTES || 30);

/** A temporary password works this many days; then the administrator gives a new one. */
export const TEMP_PASSWORD_DAYS = Number(process.env.TEMP_PASSWORD_DAYS || 7);
export const tempPasswordExpiry = () => new Date(Date.now() + TEMP_PASSWORD_DAYS * 86400000);

// ---------------------------------------------------------------- request rate limits

/**
 * At most `max` requests per `windowMs` from one address (or `key(req)`), counted in memory. Enough for one server;
 * behind several servers a shared store (Redis) would take its place.
 */
export function rateLimit({ windowMs, max, key = (req) => req.ip, message = 'Too many requests. Please wait a moment and try again.' }) {
  const hits = new Map();
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (now - v.start > windowMs) hits.delete(k);
  }, windowMs);
  sweep.unref?.();
  return (req, res, next) => {
    const k = key(req);
    const now = Date.now();
    let rec = hits.get(k);
    if (!rec || now - rec.start > windowMs) { rec = { start: now, count: 0 }; hits.set(k, rec); }
    rec.count += 1;
    res.set('RateLimit-Limit', String(max));
    res.set('RateLimit-Remaining', String(Math.max(0, max - rec.count)));
    if (rec.count > max) {
      res.set('Retry-After', String(Math.ceil((rec.start + windowMs - now) / 1000)));
      throw new HttpError(429, message);
    }
    next();
  };
}

/** API answers carry personal and financial data: no browser or proxy may keep a copy. */
export function noStore(req, res, next) {
  res.set('Cache-Control', 'no-store');
  res.set('Pragma', 'no-cache');
  next();
}

// ---------------------------------------------------------------- uploaded files: what they really are

// The first bytes of each allowed kind of file. The name and the type the browser reports can both be faked; these
// cannot without breaking the file, so a script renamed "deed.pdf" is refused.
const SIGNATURES = {
  'application/pdf': [[0x25, 0x50, 0x44, 0x46]], // %PDF
  'image/jpeg': [[0xff, 0xd8, 0xff]],
  'image/png': [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  'image/webp': [[0x52, 0x49, 0x46, 0x46, null, null, null, null, 0x57, 0x45, 0x42, 0x50]], // RIFF....WEBP
  'application/msword': [[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]], // OLE (old Word / Excel)
  'application/vnd.ms-excel': [[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [[0x50, 0x4b, 0x03, 0x04]], // ZIP (docx)
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': [[0x50, 0x4b, 0x03, 0x04]], // ZIP (xlsx)
};

/** Whether `head` (the first bytes of a file) is what `mimeType` says it is. */
export function matchesSignature(head, mimeType) {
  const patterns = SIGNATURES[mimeType];
  if (!patterns) return false;
  return patterns.some((p) => p.every((b, i) => b === null || head[i] === b));
}

/** Check a file multer saved to disk; a file that is not what it claims is deleted and refused. */
export async function assertFileContent(file, field = 'file', message = 'This file is not what its name says. Allowed: PDF, JPG, PNG, Word, Excel.') {
  if (!file) return;
  const handle = await fs.promises.open(file.path, 'r');
  const head = Buffer.alloc(16);
  try { await handle.read(head, 0, 16, 0); } finally { await handle.close(); }
  if (!matchesSignature(head, file.mimetype)) {
    await fs.promises.unlink(file.path).catch(() => {});
    throw new HttpError(400, 'Please correct the highlighted fields.', { [field]: message });
  }
}

// ---------------------------------------------------------------- passwords

const LOWER = 'abcdefghjkmnpqrstuvwxyz';
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGITS = '23456789';
const SYMBOLS = '!@#$%*-_+=?';
const pick = (set) => set[crypto.randomInt(set.length)];

/** A random temporary password that meets the password rules: every kind of character, no look-alikes (0 O 1 l I). */
export function strongTemporaryPassword(length = 14) {
  const all = LOWER + UPPER + DIGITS + SYMBOLS;
  const chars = [pick(LOWER), pick(UPPER), pick(DIGITS), pick(SYMBOLS)];
  while (chars.length < length) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i -= 1) { const j = crypto.randomInt(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.join('');
}
