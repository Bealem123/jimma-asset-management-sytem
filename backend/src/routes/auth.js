import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { BCRYPT_ROUNDS, LOCK_MINUTES, MAX_FAILED_LOGINS } from '../lib/security.js';
import { z } from 'zod';
import { db } from '../db.js';
import { signToken, authenticate, hydrateUser } from '../middleware/auth.js';
import { HttpError, parse } from '../middleware/errors.js';
import { logAudit } from '../lib/audit.js';
import { ROLE_LABELS } from '../lib/constants.js';
import { photoUpload, photoVersion, removePhoto, savePhoto, sendPhoto } from '../lib/photos.js';

import { passwordSchema } from '../lib/schemas.js';

const router = Router();

// Brute force: MAX_FAILED_LOGINS wrong passwords in a row lock the account for LOCK_MINUTES, from wherever they come
// (kept with the account), and the same count per name and address locks names that do not exist too, so the answer
// never tells whether an account exists.
const failures = new Map();
const WINDOW_MS = LOCK_MINUTES * 60 * 1000;
const MAX_FAILURES = MAX_FAILED_LOGINS;
const LOCKED = `Too many failed attempts. Try again in ${LOCK_MINUTES} minutes.`;
function throttled(key) {
  const rec = failures.get(key);
  if (!rec) return false;
  if (Date.now() - rec.first > WINDOW_MS) { failures.delete(key); return false; }
  return rec.count >= MAX_FAILURES;
}
function recordFailure(key) {
  const rec = failures.get(key);
  if (!rec || Date.now() - rec.first > WINDOW_MS) failures.set(key, { first: Date.now(), count: 1 });
  else rec.count += 1;
}

export const publicUser = (u) => ({
  id: u.id,
  username: u.username,
  full_name: u.full_name,
  role: u.role,
  role_label: ROLE_LABELS[u.role],
  scope: u.scope,
  permissions: [...(u.perms || [])].sort(),
  language: u.language ?? 'en',
  must_change_password: Boolean(u.must_change_password),
  email: u.email ?? null,
  phone: u.phone ?? null,
  photo: photoVersion(u.photo_name),
});

router.post('/login', async (req, res) => {
  const { username, password } = parse(z.object({ username: z.string().trim().min(1).max(80), password: z.string().min(1).max(200) }), req.body);
  const key = `${username.toLowerCase()}|${req.ip}`;
  if (throttled(key)) throw new HttpError(429, LOCKED);

  const user = await db('users').whereRaw('LOWER(username) = ?', [username.toLowerCase()]).first();
  if (user?.locked_until && new Date(user.locked_until) > new Date()) {
    recordFailure(key);
    await logAudit(null, user, { action: 'LOGIN_FAILED', entity: 'user', entityId: user.id, summary: `Sign-in refused for "${username}": the account is locked after repeated wrong passwords` });
    throw new HttpError(429, LOCKED);
  }
  // compare even when the user is missing so response time does not reveal valid usernames
  const hash = user?.password_hash || '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin';
  const ok = await bcrypt.compare(password, hash);
  if (!user || !ok) {
    recordFailure(key);
    await logAudit(null, user || null, { action: 'LOGIN_FAILED', entity: 'user', entityId: user?.id ?? null, summary: `Failed sign-in for "${username}"` });
    if (user) {
      const failed = (user.failed_logins || 0) + 1;
      const lock = failed >= MAX_FAILED_LOGINS;
      await db('users').where({ id: user.id }).update({ failed_logins: lock ? 0 : failed, locked_until: lock ? new Date(Date.now() + WINDOW_MS) : null });
      if (lock) {
        await logAudit(null, user, { action: 'ACCOUNT_LOCKED', entity: 'user', entityId: user.id, summary: `${user.username} locked for ${LOCK_MINUTES} minutes after ${MAX_FAILED_LOGINS} wrong passwords` });
        throw new HttpError(429, LOCKED);
      }
    }
    throw new HttpError(401, 'Wrong username or password.');
  }
  // the right password for a switched-off account: say so (only someone who knows the password learns it)
  if (!user.is_active) {
    await logAudit(null, user, { action: 'LOGIN_FAILED', entity: 'user', entityId: user.id, summary: `Sign-in refused for "${username}": the account is deactivated` });
    throw new HttpError(403, 'This account has been deactivated. Ask your administrator to activate it.');
  }
  // a temporary password nobody replaced in time no longer opens the account
  if (user.must_change_password && user.temp_password_expires_at && new Date(user.temp_password_expires_at) < new Date()) {
    await logAudit(null, user, { action: 'LOGIN_FAILED', entity: 'user', entityId: user.id, summary: `Sign-in refused for "${username}": the temporary password has expired` });
    throw new HttpError(403, 'Your temporary password has expired. Ask your administrator for a new one.');
  }
  failures.delete(key);
  const now = new Date();
  await db('users').where({ id: user.id }).update({ last_login_at: now, last_seen_at: now, failed_logins: 0, locked_until: null });
  await logAudit(null, user, { action: 'LOGIN', entity: 'user', entityId: user.id, summary: `${user.username} signed in` });

  await hydrateUser(user);
  res.json({ token: signToken(user), user: publicUser(user) });
});

router.post('/language', authenticate, async (req, res) => {
  const { language } = parse(z.object({ language: z.enum(['en', 'am', 'om']) }), req.body);
  await db('users').where({ id: req.user.id }).update({ language });
  res.json({ language });
});

router.get('/me', authenticate, (req, res) => res.json({ user: publicUser(req.user) }));

// Signing out ends the session on the server too: the token (and any copy of it) stops working at once.
router.post('/logout', authenticate, async (req, res) => {
  await db('users').where({ id: req.user.id }).update({ token_version: db.raw('token_version + 1') });
  await logAudit(null, req.user, { action: 'LOGOUT', entity: 'user', entityId: req.user.id, summary: `${req.user.username} signed out` });
  res.json({ ok: true });
});

router.post('/change-password', authenticate, async (req, res) => {
  const { current_password, new_password } = parse(
    z.object({ current_password: z.string().min(1, 'Current password is required.'), new_password: passwordSchema }),
    req.body,
  );
  const row = await db('users').where({ id: req.user.id }).first();
  if (!(await bcrypt.compare(current_password, row.password_hash))) throw new HttpError(400, 'Current password is wrong.', { current_password: 'Wrong password.' });
  // a new password ends every other open session of this user; this browser gets a fresh token
  await db('users').where({ id: req.user.id }).update({ password_hash: await bcrypt.hash(new_password, BCRYPT_ROUNDS), token_version: db.raw('token_version + 1'), must_change_password: false, temp_password_expires_at: null });
  await logAudit(null, req.user, { action: 'PASSWORD_CHANGE', entity: 'user', entityId: req.user.id, summary: `${req.user.username} changed their password` });
  const fresh = await db('users').where({ id: req.user.id }).first();
  res.json({ ok: true, token: signToken(fresh) });
});

// ---------------------------------------------------------------- profile picture

/** Upload or replace my own profile picture (multipart field "photo"). */
router.put('/photo', authenticate, photoUpload, async (req, res) => {
  const name = await savePhoto(req.user.id, req.file);
  await logAudit(null, req.user, { action: 'PHOTO_CHANGE', entity: 'user', entityId: req.user.id, summary: `${req.user.username} changed their profile picture` });
  res.json({ photo: photoVersion(name) });
});

router.delete('/photo', authenticate, async (req, res) => {
  if (await removePhoto(req.user.id)) {
    await logAudit(null, req.user, { action: 'PHOTO_REMOVE', entity: 'user', entityId: req.user.id, summary: `${req.user.username} removed their profile picture` });
  }
  res.json({ photo: null });
});

/** Anyone signed in may see the profile pictures of the City's staff. */
router.get('/photo/:id', authenticate, async (req, res) => {
  await sendPhoto(res, Number(req.params.id) || 0);
});

export default router;
