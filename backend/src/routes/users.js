import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { db } from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { HttpError, conflict, forbidden, notFound, parse } from '../middleware/errors.js';
import { has, managedAccountRole, managedAccountRoles } from '../lib/permissions.js';
import { logAudit } from '../lib/audit.js';
import { ROLES, ROLE_LABELS } from '../lib/constants.js';
import { bool, idRef, oneOf, optIdRef, optStr, present, reqStr } from '../lib/schemas.js';
import { photoUpload, photoVersion, removePhoto, savePhoto } from '../lib/photos.js';

// Hierarchy: Super Administrator -> Kifle Ketema Administrator -> Kebele Administrator -> Sector Administrator.
// Each level creates and manages only the level directly below it (see managedAccountRole), inside its own area,
// and can see (not change) the accounts further down.
const router = Router();
router.use(authenticate, (req, res, next) => {
  if (managedAccountRole(req.user)) return next();
  throw forbidden('You cannot manage user accounts.');
});

const idList = z.array(idRef).max(200).default([]);
const userSchema = z.object({
  username: z.string().trim().min(3, 'At least 3 characters.').max(80).regex(/^[A-Za-z0-9._-]+$/, 'Letters, numbers, dot, dash and underscore only.'),
  full_name: reqStr(160, 'Full name'),
  password: z.string().min(10, 'Use at least 10 characters.').max(100),
  role: oneOf(Object.values(ROLES), 'Role'),
  is_active: bool.default(true),
  email: z.preprocess((v) => (v === '' ? null : v), z.string().trim().email('Enter a valid e-mail address.').max(190).nullable()).default(null),
  phone: optStr(40),
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
  .select('id', 'username', 'full_name', 'role', 'is_active', 'email', 'phone', 'department_id', 'must_change_password', 'last_login_at', 'created_at', 'photo_name').orderBy('username');

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

/** A Kifle Ketema Administrator follows (sees, does not change) the Inspectors working in its Kifle Ketema. */
const followsInspector = (req, u) => u.role === ROLES.INSPECTOR && req.user.role === ROLES.KIFLE_ADMIN && has(req.user, 'inspection.oversee')
  && u.kifle_ketema_ids.some((id) => req.user.scope.kifle.includes(id));

/**
 * Accounts a user can see: the Super Administrator all; a Kifle Ketema Administrator the Kebele and Sector Administrators
 * of its Kebeles and the Inspectors of its Kifle Ketema; a Kebele Administrator the Sector Administrators of its Kebele.
 */
const visibleTo = (req, u, mine) => {
  if (isSuper(req) || followsInspector(req, u)) return true;
  const roles = req.user.role === ROLES.KIFLE_ADMIN ? [ROLES.KEBELE_ADMIN, ROLES.SECTOR_ADMIN] : [ROLES.SECTOR_ADMIN];
  return roles.includes(u.role) && inside(u.kebele_ids, mine);
};
const manageableBy = (req, u, mine) => managedAccountRoles(req.user).includes(u.role) && (isSuper(req) || inside(u.kebele_ids, mine));

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
  if (d.role && !targets.includes(d.role)) throw forbidden(`You can only create ${targets.map((r) => ROLE_LABELS[r]).join(' or ')} accounts.`);
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
 * one Kebele Administrator per Kebele and one Sector Administrator per Sector in a Kebele. The City has one active
 * Mayor / Executive and one active Internal Auditor.
 */
async function checkHierarchy(role, scope, isActive, exceptId = null) {
  const { kifle_ketema_ids: kifle = [], kebele_ids: kebeles = [], sector_ids: sectors = [] } = scope;
  if (role === ROLES.KIFLE_ADMIN && kifle.length !== 1) throw fail('kifle_ketema_ids', 'Choose exactly one Kifle Ketema.');
  if ((role === ROLES.FINANCIAL_OFFICER || role === ROLES.INSPECTOR) && !kifle.length) throw fail('kifle_ketema_ids', 'Choose at least one Kifle Ketema.');
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
  } else if (role === ROLES.KIFLE_ADMIN) {
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

// ---------------------------------------------------------------- routes

router.get('/', async (req, res) => {
  const users = await withScope(await listUsers());
  const mine = isSuper(req) ? [] : await myKebeleIds(req.user);
  res.json(users.filter((u) => visibleTo(req, u, mine)).map((u) => ({ ...u, read_only: !manageableBy(req, u, mine) })));
});

router.post('/', async (req, res) => {
  const d = parse(userSchema, req.body);
  await checkDelegated(req, d);
  await checkHierarchy(d.role, d, d.is_active);
  const id = await db.transaction(async (trx) => {
    const [newId] = await trx('users').insert({
      username: d.username, full_name: d.full_name, role: d.role, is_active: d.is_active, email: d.email, phone: d.phone, department_id: d.department_id,
      password_hash: await bcrypt.hash(d.password, 10), must_change_password: true,
    });
    await setScope(trx, newId, d);
    await logAudit(trx, req.user, {
      action: 'USER_CREATE', entity: 'user', entityId: newId, summary: `Created user ${d.username} (${ROLE_LABELS[d.role]})`,
      changes: { role: d.role, kifle_ketema_ids: d.kifle_ketema_ids, kebele_ids: d.kebele_ids, sector_ids: d.sector_ids },
    });
    return newId;
  });
  res.status(201).json((await withScope(await listUsers({ id })))[0]);
});

router.patch('/:id', async (req, res) => {
  const existing = await loadManaged(req, req.params.id);
  const d = present(parse(userSchema.partial(), req.body), req.body);
  const { reason } = parse(z.object({ reason: optStr(300) }), { reason: req.body?.reason }); // why an account is switched off or on
  await checkDelegated(req, d, existing);
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
    for (const k of ['username', 'full_name', 'role', 'is_active', 'email', 'phone', 'department_id']) if (k in d) update[k] = d[k];
    if (d.password) { update.password_hash = await bcrypt.hash(d.password, 10); update.must_change_password = true; } // an administrator-set password is temporary
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
  res.json((await withScope(await listUsers({ id: existing.id })))[0]);
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
