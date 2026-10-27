import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { BCRYPT_ROUNDS, tempPasswordExpiry } from '../lib/security.js';
import { z } from 'zod';
import { db } from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { HttpError, conflict, forbidden, notFound, parse } from '../middleware/errors.js';
import { managedAccountRole, managedAccountRoles } from '../lib/permissions.js';
import { logAudit } from '../lib/audit.js';
import { ROLES, ROLE_LABELS, SYSTEM_ROLES } from '../lib/constants.js';
import {
  bool, idRef, oneOf, optEmail, optIdRef, optPersonName, optPhone, optStr, passwordSchema,
  present, usernameSchema,
} from '../lib/schemas.js';
import { photoUpload, photoVersion, removePhoto, savePhoto } from '../lib/photos.js';
import { sendAccountCreationAlert } from '../lib/accountNotification.js';

// Hierarchy: Super Administrator -> Kifle Ketema Administrator -> Kebele Administrator -> Sector Administrator.
// Each level creates, manages and sees only the level directly below it (see managedAccountRole), inside its own
// area. The Internal Auditor sees every account, and its history, read-only: who holds which role is part of what it
// checks.
const router = Router();
const auditsAccounts = (user) => user.role === ROLES.AUDITOR;
router.use(authenticate, (req, res, next) => {
  if (managedAccountRole(req.user)) return next();
  if (req.method === 'GET' && auditsAccounts(req.user)) return next();
  throw forbidden('You cannot manage user accounts.');
});

const idList = z.array(idRef).max(200).default([]);
// A person is registered by name and father's name (and, if given, grandfather's name): the full name shown
// everywhere is these joined. The username is made from the name unless one is given (scripts, older clients).
const userSchema = z.object({
  username: usernameSchema.optional(),
  first_name: optPersonName(80, 'Name'),
  father_name: optPersonName(80, "Father's name"),
  grandfather_name: optPersonName(80, "Grandfather's name"),
  full_name: optPersonName(160, 'Full name'),
  password: passwordSchema,
  role: oneOf(SYSTEM_ROLES, 'Role'),
  is_active: bool.default(true),
  email: optEmail,
  phone: optPhone,
  department_id: optIdRef,
  kifle_ketema_ids: idList,
  kebele_ids: idList,
  sector_ids: idList,
});

async function withScope(users) {
  const [kifle, kebeles, sectors] = await Promise.all([
    db('user_kifle_ketemas'), db('user_kebeles'), db('user_sectors'),
  ]);
  const group = (rows, key) => rows.reduce((m, r) => ((m[r.user_id] ||= []).push(r[key]), m), {});
  const gk = group(kifle, 'kifle_ketema_id');
  const gb = group(kebeles, 'kebele_id');
  const gs = group(sectors, 'sector_id');
  return users.map(({ photo_name: photoName, ...u }) => ({
    ...u,
    photo: photoVersion(photoName),
    role_label: ROLE_LABELS[u.role],
    kifle_ketema_ids: gk[u.id] || [],
    kebele_ids: gb[u.id] || [],
    sector_ids: gs[u.id] || [],
  }));
}

const listUsers = (where = {}) => db('users').where(where)
  .select('id', 'username', 'full_name', 'first_name', 'father_name', 'grandfather_name', 'role', 'is_active', 'email', 'phone', 'department_id',
    'must_change_password', 'last_login_at', 'created_at', 'photo_name').orderBy('username');

// ---------------------------------------------------------------- the person's name and username

const NAME_PARTS = ['first_name', 'father_name', 'grandfather_name'];
const splitName = (full) => {
  const [first = null, father = null, ...rest] = String(full || '').trim().split(/\s+/).filter(Boolean);
  return { first_name: first, father_name: father, grandfather_name: rest.join(' ') || null };
};

/**
 * Settles the name in `d` (a new account, or the changes to `existing`): given as parts, the full name is made from
 * them; given as a full name only, it is split into parts. Then both the person's own name and the father's name
 * must be there. Returns whether the name changed.
 */
function settleName(d, existing = null) {
  // a change names only the parts it sends (an emptied one included); a new account fills in at least one
  const partsGiven = existing ? NAME_PARTS.some((k) => k in d) : NAME_PARTS.some((k) => d[k] != null);
  if (!partsGiven && d.full_name == null) return false;
  const parts = partsGiven
    ? Object.fromEntries(NAME_PARTS.map((k) => [k, d[k] !== undefined ? d[k] : existing?.[k] ?? null]))
    : splitName(d.full_name);
  if (!parts.first_name) throw fail('first_name', 'Name is required.');
  if (!parts.father_name) throw fail('father_name', "Father's name is required: register the person with their name and their father's name.");
  Object.assign(d, parts, { full_name: [parts.first_name, parts.father_name, parts.grandfather_name].filter(Boolean).join(' ') });
  return true;
}

const usernameTaken = (name) => db('users').whereRaw('LOWER(username) = ?', [name.toLowerCase()]).first();
const slug = (s) => String(s).toLowerCase().replace(/['’`]/g, '').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');

/** The username: the person's first name; if someone has it already, first name and father's name, then a number. */
async function freeUsername({ first_name: first, father_name: father }) {
  const own = slug(first).slice(0, 40);
  const both = `${own}.${slug(father)}`.slice(0, 76);
  for (const candidate of [...(own.length >= 3 ? [own] : []), both]) if (!(await usernameTaken(candidate))) return candidate;
  for (let i = 2; ; i += 1) if (!(await usernameTaken(`${both}${i}`))) return `${both}${i}`;
}

async function setScope(trx, userId, d) {
  const tables = [
    ['user_kifle_ketemas', 'kifle_ketema_id', d.kifle_ketema_ids],
    ['user_kebeles', 'kebele_id', d.kebele_ids],
    ['user_sectors', 'sector_id', d.sector_ids],
  ];
  for (const [table, col, ids] of tables) {
    if (ids === undefined) continue;
    await trx(table).where({ user_id: userId }).delete();
    if (ids.length) await trx(table).insert([...new Set(ids)].map((id) => ({ user_id: userId, [col]: id })));
  }
}

// ---------------------------------------------------------------- who may touch which account

const isSuper = (req) => req.user.role === ROLES.SUPER_ADMIN;

/** The Kebeles a Kifle Ketema Administrator oversees (its Kifle Ketema's) or a Kebele Administrator runs (its own). */
const myKebeleIds = (user) => {
  if (user.role === ROLES.KEBELE_ADMIN) return Promise.resolve(user.scope.kebeles);
  return user.scope.kifle.length ? db('kebeles').whereIn('kifle_ketema_id', user.scope.kifle).pluck('id') : Promise.resolve([]);
};

const inside = (ids, allowed) => ids.length > 0 && ids.every((id) => allowed.includes(id));

const manageableBy = (req, u, mine) => managedAccountRoles(req.user).includes(u.role) && (isSuper(req) || inside(u.kebele_ids, mine));
/**
 * Accounts a user can see are the accounts it creates: the Super Administrator the Kifle Ketema Administrators, the
 * Mayor / Executive and the specialists; a Kifle Ketema Administrator the Kebele Administrators of its Kebeles; a
 * Kebele Administrator the Sector Administrators of its Kebele (made by it or by whoever held its post before).
 * The Internal Auditor alone sees every account, read-only.
 */
const visibleTo = (req, u, mine) => auditsAccounts(req.user) || manageableBy(req, u, mine);

async function loadManaged(req, id) {
  const [user] = await withScope(await listUsers({ id }));
  if (!user) throw notFound('User not found.');
  const mine = isSuper(req) ? [] : await myKebeleIds(req.user);
  if (!visibleTo(req, user, mine)) throw notFound('User not found.'); // outside this area: do not even confirm it exists
  return { ...user, readOnly: !manageableBy(req, user, mine) };
}

/** Each level may only create or change accounts of the level below it, inside its own area. */
async function checkDelegated(req, d, existing = null) {
  const targets = managedAccountRoles(req.user);
  const target = d.role ?? existing?.role;
  if (existing?.readOnly) throw forbidden('You can see this account but you cannot change it.');
  if (d.role && SYSTEM_ROLES.includes(d.role) && !targets.includes(d.role)) {
    throw forbidden(`You can only create ${targets.map((r) => ROLE_LABELS[r]).join(' or ')} accounts.`);
  }
  if (target === ROLES.EXECUTIVE || target === ROLES.AUDITOR) {
    // the Mayor / Executive and the Internal Auditor see the whole City by role: no assigned area, no office
    Object.assign(d, { kifle_ketema_ids: [], kebele_ids: [], sector_ids: [], department_id: null });
    return;
  }
  if (!isSuper(req)) {
    const mine = await myKebeleIds(req.user);
    if (d.kebele_ids !== undefined && !inside(d.kebele_ids, mine)) throw forbidden('Choose a Kebele that belongs to your area.');
  } else {
    d.kebele_ids = undefined;
  }
  // never grant wider areas: only the Super Administrator picks a Kifle Ketema, only a Kebele Administrator picks a sector
  if (!isSuper(req)) d.kifle_ketema_ids = undefined;
  if (req.user.role !== ROLES.KEBELE_ADMIN) d.sector_ids = undefined;
  if (target !== ROLES.SECTOR_ADMIN) d.department_id = undefined; // an office belongs to a sector; Kifle Ketema and Kebele Administrators have none
}

// ---------------------------------------------------------------- one administrator per area

const fail = (field, message) => new HttpError(400, 'Please correct the highlighted fields.', { [field]: message });

/**
 * The hierarchy has exactly one administrator per area: one Kifle Ketema Administrator per Kifle Ketema,
 * one Kebele Administrator per Kebele and one Sector Administrator per Sector in a Kebele. Each Kifle Ketema also has
 * one Financial Officer and one Inspector. The City has one active Mayor / Executive and one active Internal Auditor.
 */
const ONE_PER_KIFLE_KETEMA = [ROLES.KIFLE_ADMIN, ROLES.FINANCIAL_OFFICER, ROLES.INSPECTOR];

async function checkHierarchy(role, scope, isActive, exceptId = null) {
  const { kifle_ketema_ids: kifle = [], kebele_ids: kebeles = [], sector_ids: sectors = [] } = scope;
  if (ONE_PER_KIFLE_KETEMA.includes(role) && kifle.length !== 1) throw fail('kifle_ketema_ids', 'Choose exactly one Kifle Ketema.');
  if (role === ROLES.KEBELE_ADMIN && kebeles.length !== 1) throw fail('kebele_ids', 'Choose exactly one Kebele.');
  if (role === ROLES.SECTOR_ADMIN) {
    if (kebeles.length !== 1) throw fail('kebele_ids', 'Choose exactly one Kebele.');
    if (sectors.length !== 1) throw fail('sector_ids', 'Choose exactly one sector.');
  }
  if (!isActive) return;
  const others = () => db('users').where({ role, is_active: true }).whereNot('users.id', exceptId ?? 0);
  let clash = null;
  if (role === ROLES.EXECUTIVE) {
    // the City has one Mayor: a new one is created after the old account is deactivated
    const mayor = await others().first('users.username');
    if (mayor) throw conflict(`The City already has a Mayor / Executive: ${mayor.username}. Deactivate that account first.`);
  } else if (role === ROLES.AUDITOR) {
    // ... and one Internal Auditor, who sees the whole City
    const auditor = await others().first('users.username');
    if (auditor) throw conflict(`The City already has an Internal Auditor: ${auditor.username}. Deactivate that account first.`);
  } else if (ONE_PER_KIFLE_KETEMA.includes(role)) {
    clash = await others().join('user_kifle_ketemas as x', 'x.user_id', 'users.id').whereIn('x.kifle_ketema_id', kifle).first('users.username');
  } else if (role === ROLES.KEBELE_ADMIN) {
    clash = await others().join('user_kebeles as x', 'x.user_id', 'users.id').whereIn('x.kebele_id', kebeles).first('users.username');
  } else if (role === ROLES.SECTOR_ADMIN) {
    clash = await others()
      .join('user_kebeles as x', 'x.user_id', 'users.id').join('user_sectors as y', 'y.user_id', 'users.id')
      .whereIn('x.kebele_id', kebeles).whereIn('y.sector_id', sectors).first('users.username');
  }
  if (clash) throw conflict(`This area already has a ${ROLE_LABELS[role]}: ${clash.username}. Deactivate or change that account first.`);
}

// ---------------------------------------------------------------- unique identifiers
async function checkUniqueIdentifiers(d, exceptId = null) {
  if (d.username) {
    const q = db('users').whereRaw('LOWER(username) = ?', [d.username.toLowerCase()]);
    if (exceptId) q.whereNot('id', exceptId);
    if (await q.first()) {
      throw conflict(`An account with the username "${d.username}" already exists.`);
    }
  }
  if (d.email) {
    const q = db('users').whereRaw('LOWER(email) = ?', [d.email.toLowerCase()]);
    if (exceptId) q.whereNot('id', exceptId);
    if (await q.first()) {
      throw conflict(`An account with the email address "${d.email}" already exists.`);
    }
  }
  if (d.phone) {
    const q = db('users').where('phone', d.phone);
    if (exceptId) q.whereNot('id', exceptId);
    if (await q.first()) {
      throw conflict(`An account with the phone number "${d.phone}" already exists.`);
    }
  }
}

// ---------------------------------------------------------------- routes

router.get('/', async (req, res) => {
  const users = await withScope(await listUsers());
  const mine = isSuper(req) ? [] : await myKebeleIds(req.user);
  res.json(users.filter((u) => visibleTo(req, u, mine)).map((u) => ({ ...u, read_only: !manageableBy(req, u, mine) })));
});

router.post('/', async (req, res) => {
  const d = parse(userSchema, req.body);
  await checkDelegated(req, d);
  await checkUniqueIdentifiers(d);
  await checkHierarchy(d.role, d, d.is_active);
  if (!settleName(d)) throw fail('first_name', 'Name is required.');
  if (!d.username) d.username = await freeUsername(d);
  const id = await db.transaction(async (trx) => {
    const [newId] = await trx('users').insert({
      username: d.username, full_name: d.full_name, first_name: d.first_name, father_name: d.father_name, grandfather_name: d.grandfather_name,
      role: d.role, is_active: d.is_active, email: d.email, phone: d.phone, department_id: d.department_id,
      password_hash: await bcrypt.hash(d.password, BCRYPT_ROUNDS), must_change_password: true, temp_password_expires_at: tempPasswordExpiry(),
    });
    await setScope(trx, newId, d);
    await logAudit(trx, req.user, {
      action: 'USER_CREATE', entity: 'user', entityId: newId, summary: `Created user ${d.username} (${ROLE_LABELS[d.role]})`,
      changes: { role: d.role, kifle_ketema_ids: d.kifle_ketema_ids, kebele_ids: d.kebele_ids, sector_ids: d.sector_ids },
    });
    return newId;
  });
  const createdUser = (await withScope(await listUsers({ id })))[0];

  // Resolve human-readable area name for notification content
  let areaName = '';
  try {
    if (d.kifle_ketema_ids?.length) {
      const names = await db('kifle_ketemas').whereIn('id', d.kifle_ketema_ids).pluck('name');
      areaName = names.join(', ') + ' Kifle Ketema';
    } else if (d.kebele_ids?.length) {
      const names = await db('kebeles').whereIn('id', d.kebele_ids).pluck('name');
      areaName = names.join(', ') + ' Kebele';
    }
  } catch (err) { /* secondary */ }

  // Send credentials via SMTP Email and SMS / Messaging for all 8 account types
  sendAccountCreationAlert({
    user: createdUser,
    plainPassword: d.password,
    areaName,
  }).catch((err) => console.error('Failed to dispatch account creation alert:', err.message));

  res.status(201).json(createdUser);
});

router.patch('/:id', async (req, res) => {
  const existing = await loadManaged(req, req.params.id);
  const d = present(parse(userSchema.partial(), req.body), req.body);
  const { reason } = parse(z.object({ reason: optStr(300) }), { reason: req.body?.reason }); // why an account is switched off or on
  await checkDelegated(req, d, existing);
  if (d.username || d.email || d.phone) {
    await checkUniqueIdentifiers(d, existing.id);
  }
  settleName(d, existing);
  if (existing.id === req.user.id && (d.is_active === false || (d.role && d.role !== existing.role))) {
    throw conflict('You cannot deactivate your own account or change your own role.');
  }
  const role = d.role ?? existing.role;
  const isActive = d.is_active ?? Boolean(existing.is_active);
  const touchesHierarchy = d.role !== undefined || d.kifle_ketema_ids !== undefined || d.kebele_ids !== undefined || d.sector_ids !== undefined
    || (d.is_active === true && !existing.is_active);
  if (touchesHierarchy) {
    await checkHierarchy(role, {
      kifle_ketema_ids: d.kifle_ketema_ids ?? existing.kifle_ketema_ids,
      kebele_ids: d.kebele_ids ?? existing.kebele_ids,
      sector_ids: d.sector_ids ?? existing.sector_ids,
    }, isActive, existing.id);
  }
  await db.transaction(async (trx) => {
    const update = {};
    for (const k of ['username', 'full_name', ...NAME_PARTS, 'role', 'is_active', 'email', 'phone', 'department_id']) if (k in d) update[k] = d[k];
    if (d.password) { update.password_hash = await bcrypt.hash(d.password, BCRYPT_ROUNDS); update.must_change_password = true; update.temp_password_expires_at = tempPasswordExpiry(); } // an administrator-set password is temporary
    // a reset password, a new role or a deactivation ends the user's open sessions straight away
    if (d.password || (d.role && d.role !== existing.role) || d.is_active === false) update.token_version = trx.raw('token_version + 1');
    if (Object.keys(update).length) await trx('users').where({ id: existing.id }).update(update);
    await setScope(trx, existing.id, d);
    // the form sends every field: record only those that really changed
    const same = (a, b) => (Array.isArray(a)
      ? JSON.stringify([...a].map(Number).sort()) === JSON.stringify([...(b || [])].map(Number).sort())
      : typeof a === 'boolean' ? a === Boolean(b) : String(a ?? '') === String(b ?? ''));
    const changed = Object.keys(d).filter((k) => k !== 'password' && d[k] !== undefined && !same(d[k], existing[k]));
    const changes = Object.fromEntries(changed.map((k) => [k, d[k]]));
    if (changed.includes('is_active')) {
      // switching an account off or on is its own entry in the history, with the reason given for it
      const others = [...changed.filter((k) => k !== 'is_active'), ...(d.password ? ['password reset'] : [])];
      await logAudit(trx, req.user, {
        action: d.is_active ? 'USER_REACTIVATE' : 'USER_DEACTIVATE', entity: 'user', entityId: existing.id,
        summary: `${d.is_active ? 'Reactivated' : 'Deactivated'} user ${existing.username}${reason ? `: ${reason}` : ''}${others.length ? ` (also changed: ${others.join(', ')})` : ''}`,
        changes: { ...changes, reason },
      });
    } else {
      await logAudit(trx, req.user, {
        action: 'USER_UPDATE', entity: 'user', entityId: existing.id,
        summary: `Updated user ${existing.username}: ${[...changed, ...(d.password ? ['password reset'] : [])].join(', ') || 'no changes'}`,
        changes,
      });
    }
  });
  const updatedUser = (await withScope(await listUsers({ id: existing.id })))[0];
  if (d.password) {
    sendAccountCreationAlert({
      user: updatedUser,
      plainPassword: d.password,
    }).catch((err) => console.error('Failed to dispatch password reset alert:', err.message));
  }
  res.json(updatedUser);
});

/** One account, if this user may see it (for its history page). */
router.get('/:id', async (req, res) => {
  const { readOnly, ...user } = await loadManaged(req, req.params.id);
  res.json({ ...user, read_only: readOnly });
});

const HISTORY_PAGE = 50;

/** Everything that happened to this user account, and their sign-ins, newest first. `?before=<id>` pages back. */
router.get('/:id/history', async (req, res) => {
  const user = await loadManaged(req, req.params.id);
  const before = Number(req.query.before) || null;
  const q = db('audit_logs')
    .where((b) => b.where({ entity: 'user', entity_id: user.id }).orWhere({ user_id: user.id, action: 'LOGIN' }))
    .orderBy('id', 'desc').limit(HISTORY_PAGE);
  if (before) q.where('id', '<', before);
  res.json(await q);
});

/** Force the user to sign in again everywhere. */
router.post('/:id/end-sessions', async (req, res) => {
  const user = await loadManaged(req, req.params.id);
  if (user.readOnly) throw forbidden('You can see this account but you cannot change it.');
  await db('users').where({ id: user.id }).update({ token_version: db.raw('token_version + 1') });
  await logAudit(null, req.user, { action: 'SESSIONS_ENDED', entity: 'user', entityId: user.id, summary: `Ended all sessions of ${user.username}` });
  res.json({ ok: true });
});

/** Set or replace the profile picture of an account this user manages (multipart field "photo"). */
router.put('/:id/photo', photoUpload, async (req, res) => {
  const user = await loadManaged(req, req.params.id);
  if (user.readOnly) throw forbidden('You can see this account but you cannot change it.');
  const name = await savePhoto(user.id, req.file);
  await logAudit(null, req.user, { action: 'PHOTO_CHANGE', entity: 'user', entityId: user.id, summary: `Changed the profile picture of ${user.username}` });
  res.json({ photo: photoVersion(name) });
});

router.delete('/:id/photo', async (req, res) => {
  const user = await loadManaged(req, req.params.id);
  if (user.readOnly) throw forbidden('You can see this account but you cannot change it.');
  if (await removePhoto(user.id)) {
    await logAudit(null, req.user, { action: 'PHOTO_REMOVE', entity: 'user', entityId: user.id, summary: `Removed the profile picture of ${user.username}` });
  }
  res.json({ photo: null });
});

export default router;
