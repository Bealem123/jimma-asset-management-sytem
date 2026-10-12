import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { db } from '../db.js';
import { loadRolePermissions, loadScope } from '../lib/permissions.js';
import { HttpError, forbidden } from './errors.js';

export function signToken(user) {
  return jwt.sign({ sub: user.id, tv: user.token_version ?? 0 }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
}

/** Attach scope and effective permissions to a user row. */
export async function hydrateUser(user) {
  delete user.password_hash;
  user.scope = await loadScope(user.id);
  const roles = await loadRolePermissions();
  user.perms = roles[user.role] || new Set();
  return user;
}

/** Authenticate the request and attach req.user (fresh from the database, with scope and permissions). */
export async function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw new HttpError(401, 'Please sign in.');
  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch {
    throw new HttpError(401, 'Your session has expired. Please sign in again.');
  }
  const user = await db('users').where({ id: payload.sub, is_active: true }).first();
  if (!user) throw new HttpError(401, 'This account is not active.');
  // Changing a password or ending sessions bumps token_version, which invalidates every older token.
  if ((payload.tv ?? 0) !== user.token_version) throw new HttpError(401, 'Your session has ended. Please sign in again.');
  req.user = await hydrateUser(user);
  // A temporary password must be replaced first: until then only the sign-in/password endpoints work.
  if (user.must_change_password && !req.originalUrl.startsWith('/api/auth/')) {
    throw new HttpError(403, 'You must choose a new password before you continue.');
  }
  next();
}

/**
 * Authenticate with either a user token or, for the read-only integration API, an API key.
 * An API key has no user behind it: req.apiKey is set and req.user is a read-only city-wide pseudo-user.
 */
export async function authenticateApiKey(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!key) throw new HttpError(401, 'Send your API key in the X-API-Key header.');
  const hash = crypto.createHash('sha256').update(String(key)).digest('hex');
  const row = await db('api_keys').where({ key_hash: hash, is_active: true }).first();
  if (!row) throw new HttpError(401, 'Unknown or disabled API key.');
  await db('api_keys').where({ id: row.id }).update({ last_used_at: db.fn.now() });
  req.apiKey = row;
  req.user = { id: null, username: `api:${row.name}`, role: 'EXECUTIVE', scope: { kifle: [], kebeles: [], sectors: [] }, perms: new Set(['financial.view']) };
  next();
}

/** Guard a route with a permission predicate from lib/permissions.js */
export const require_ = (predicate, message) => (req, res, next) => {
  if (!predicate(req.user)) throw forbidden(message);
  next();
};
