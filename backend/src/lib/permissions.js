import { db } from '../db.js';
import { ALL_SCOPE_ROLES, DEFAULT_ROLE_PERMISSIONS, PERMISSIONS, ROLES } from './constants.js';
import { MONEY_DETAIL_KEYS } from './sectorFields.js';

// ---------------------------------------------------------------- permissions (what a role may do)

const CACHE_MS = 5000;
let cache = null; // { at, map: { ROLE: Set<permission> } }

export const invalidatePermissionCache = () => { cache = null; };

/** Effective permissions per role: the defaults, changed by whatever a Super Administrator has customised. */
export async function loadRolePermissions() {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.map;
  const overrides = await db('role_permissions');
  const map = {};
  for (const [role, perms] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) map[role] = new Set(perms);
  for (const o of overrides) {
    if (o.role === ROLES.SUPER_ADMIN || !map[o.role] || !PERMISSIONS[o.permission]) continue; // the Super Administrator cannot be locked out
    if (o.allowed) map[o.role].add(o.permission); else map[o.role].delete(o.permission);
  }
  cache = { at: Date.now(), map };
  return map;
}

/** True if the user (loaded by authenticate, with user.perms) has the permission. */
export const has = (user, permission) => Boolean(user?.perms?.has(permission));

export const canEdit = (user) => has(user, 'asset.edit');
export const canCreate = (user) => has(user, 'asset.create');
export const canReview = (user) => has(user, 'asset.review');
export const canApprove = (user) => has(user, 'asset.approve');
export const canRequest = (user) => has(user, 'request.create');
export const canDecideRequests = (user) => has(user, 'request.decide');
export const canViewFinancial = (user) => has(user, 'financial.view');
export const canManageMaster = (user) => has(user, 'master.manage');

// Each level creates and manages only the level directly below it:
// Super Administrator -> Kifle Ketema Administrator -> Kebele Administrator -> Sector Administrator.
const ACCOUNT_LEVELS = {
  [ROLES.SUPER_ADMIN]: { manages: ROLES.KIFLE_ADMIN, permission: 'user.manage' },
  [ROLES.KIFLE_ADMIN]: { manages: ROLES.KEBELE_ADMIN, permission: 'user.manage_kebele_admins' },
  [ROLES.KEBELE_ADMIN]: { manages: ROLES.SECTOR_ADMIN, permission: 'user.manage_sector_admins' },
};
/** The one role whose accounts this user may create and manage, or null. */
export const managedAccountRole = (user) => {
  const level = ACCOUNT_LEVELS[user.role];
  return level && has(user, level.permission) ? level.manages : null;
};
/**
 * Every role whose accounts this user may create and manage. Besides its own level, the Super Administrator
 * also creates the roles outside the hierarchy: the Mayor / Executive and the Internal Auditor (city-wide,
 * read-only), and the Financial Officer and Inspector (one or more Kifle Ketemas).
 */
export const OUTSIDE_HIERARCHY = [ROLES.EXECUTIVE, ROLES.AUDITOR, ROLES.FINANCIAL_OFFICER, ROLES.INSPECTOR];
export const managedAccountRoles = (user) => {
  const main = managedAccountRole(user);
  if (!main) return [];
  return user.role === ROLES.SUPER_ADMIN ? [main, ...OUTSIDE_HIERARCHY] : [main];
};
export const canManageSystem = (user) => has(user, 'system.manage');
export const canViewAudit = (user) => has(user, 'audit.view');
export const hasAllScope = (user) => ALL_SCOPE_ROLES.includes(user.role);

/**
 * The Mayor holds the Kifle Ketema Administrators to account and each of them answers for its own Kebeles, so the
 * Mayor's figures (dashboard, performance, analytics) stop at Kifle Ketema level: no breakdown by Kebele.
 */
export const seesKebeleLevel = (user) => user.role !== ROLES.EXECUTIVE;

/** Route guard factory: `requirePermission('inspection.record')` */
export const permissionCheck = (permission) => (user) => has(user, permission);

/**
 * Financial figures are hidden from users without 'financial.view'.
 * Applied to every asset returned by the API.
 */
const FINANCIAL_FIELDS = ['acquisition_cost', 'current_valuation', 'valuation_date', 'salvage_value'];
export function maskFinancial(user, asset) {
  if (!asset || canViewFinancial(user)) return asset;
  const out = { ...asset };
  for (const f of FINANCIAL_FIELDS) if (f in out) out[f] = null;
  if (out.details && typeof out.details === 'object') {
    out.details = Object.fromEntries(Object.entries(out.details).filter(([k]) => !MONEY_DETAIL_KEYS.includes(k)));
  }
  return out;
}

// ---------------------------------------------------------------- scope (which assets a user may reach)

/** Load the user's assigned locations and sectors (their access scope). */
export async function loadScope(userId) {
  const [kifle, kebeles, sectors] = await Promise.all([
    db('user_kifle_ketemas').where({ user_id: userId }).pluck('kifle_ketema_id'),
    db('user_kebeles').where({ user_id: userId }).pluck('kebele_id'),
    db('user_sectors').where({ user_id: userId }).pluck('sector_id'),
  ]);
  return { kifle, kebeles, sectors };
}

/**
 * Which assets a user may see/manage.
 *  - city-wide roles: everything
 *  - Sector Administrator: assigned sectors (inside the assigned Kebeles and Kifle Ketemas, if any)
 *  - Kifle Ketema Administrator: assigned Kifle Ketemas
 *  - Kebele Administrator: assigned Kebeles
 *  - every other role: the union of assigned Kebeles, Kifle Ketemas and sectors
 * A user with no assignments sees nothing.
 */
/**
 * The Kifle Ketemas and Kebeles a user may name as an area (to start a stock-taking of, say), following the same rules
 * as applyScope: a Kebele or Sector Administrator its own Kebele(s) and their Kifle Ketema, a Kifle Ketema Administrator
 * its Kifle Ketema(s) and all their Kebeles, other roles the union of both. `null` means the whole city.
 */
export async function allowedAreas(user) {
  if (hasAllScope(user)) return null;
  const { kifle, kebeles } = user.scope;
  const kifleOf = (ids) => (ids.length ? db('kebeles').whereIn('id', ids).whereNotNull('kifle_ketema_id').pluck('kifle_ketema_id') : []);
  const kebelesIn = (ids) => (ids.length ? db('kebeles').whereIn('kifle_ketema_id', ids).pluck('id') : []);
  if ([ROLES.KEBELE_ADMIN, ROLES.SECTOR_ADMIN].includes(user.role)) {
    return { kifle: new Set(await kifleOf(kebeles)), kebeles: new Set(kebeles) };
  }
  if (user.role === ROLES.KIFLE_ADMIN) return { kifle: new Set(kifle), kebeles: new Set(await kebelesIn(kifle)) };
  return { kifle: new Set([...kifle, ...(await kifleOf(kebeles))]), kebeles: new Set([...kebeles, ...(await kebelesIn(kifle))]) };
}

export function applyScope(qb, user, table = 'assets') {
  if (hasAllScope(user)) return qb;
  const { kifle, kebeles, sectors } = user.scope;
  const col = (c) => `${table}.${c}`;
  switch (user.role) {
    case ROLES.SECTOR_ADMIN:
      // One sector inside one Kebele: both must match. A Kebele or Kifle Ketema, when assigned, narrows the sector.
      if (!sectors.length) return qb.whereRaw('1 = 0');
      qb.whereIn(col('sector_id'), sectors);
      if (kebeles.length) qb.whereIn(col('kebele_id'), kebeles);
      return kifle.length ? qb.whereIn(col('kifle_ketema_id'), kifle) : qb;
    case ROLES.KIFLE_ADMIN:
      return kifle.length ? qb.whereIn(col('kifle_ketema_id'), kifle) : qb.whereRaw('1 = 0');
    case ROLES.KEBELE_ADMIN:
      return kebeles.length ? qb.whereIn(col('kebele_id'), kebeles) : qb.whereRaw('1 = 0');
    default: {
      if (!kifle.length && !kebeles.length && !sectors.length) return qb.whereRaw('1 = 0');
      return qb.where((b) => {
        if (kebeles.length) b.orWhereIn(col('kebele_id'), kebeles);
        if (kifle.length) b.orWhereIn(col('kifle_ketema_id'), kifle);
        if (sectors.length) b.orWhereIn(col('sector_id'), sectors);
      });
    }
  }
}

/** In-memory equivalent of applyScope, for checking a record that is about to be written. */
export function inScope(user, { kifle_ketema_id, kebele_id, sector_id }) {
  if (hasAllScope(user)) return true;
  const { kifle, kebeles, sectors } = user.scope;
  switch (user.role) {
    case ROLES.SECTOR_ADMIN:
      return sectors.includes(sector_id)
        && (!kebeles.length || (kebele_id != null && kebeles.includes(kebele_id)))
        && (!kifle.length || kifle.includes(kifle_ketema_id));
    case ROLES.KIFLE_ADMIN: return kifle.includes(kifle_ketema_id);
    case ROLES.KEBELE_ADMIN: return kebele_id != null && kebeles.includes(kebele_id);
    default:
      return (kebele_id != null && kebeles.includes(kebele_id)) || kifle.includes(kifle_ketema_id) || sectors.includes(sector_id);
  }
}

/** Fetch one asset only if the user is allowed to see it. */
export function scopedAsset(user, id) {
  return applyScope(db('assets').where('assets.id', id), user).first();
}
