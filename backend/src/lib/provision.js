import { BCRYPT_ROUNDS, strongTemporaryPassword, tempPasswordExpiry } from './security.js';
import bcrypt from 'bcryptjs';
import { db } from '../db.js';
import { ROLES, ROLE_LABELS } from './constants.js';

// Creates the standard set of accounts for Jimma City, covering all 8 roles:
//   1 Super Administrator            whole city
//   1 Kifle Ketema Administrator     per Kifle Ketema             (3)
//   1 Kebele Administrator           per Kebele                   (13)
//   1 Sector Administrator           per Sector in each Kebele    (13 x 13 = 169)
//   1 Mayor / Executive              whole city                   (only if the City has no active one)
//   1 Internal Auditor               whole city                   (only if the City has no active one)
//   1 Financial Officer              per Kifle Ketema             (3, only where the Kifle Ketema has none yet)
//   1 Inspector                      per Kifle Ketema             (3, only where the Kifle Ketema has none yet)
// Safe to run again: an account that already exists is left alone (its password is NOT changed), and an area that already
// has an active account of the role (whatever its username) gets no second one.
// Every new account gets a random temporary password and must choose its own at first sign-in.

/** A temporary password: random, with every kind of character the password rules ask for (lib/security.js). */
export function temporaryPassword(length = 14) {
  return strongTemporaryPassword(length);
}

const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** What would be created, without touching the database. */
export async function planAdminAccounts(conn = db) {
  const active = (role) => conn('users').where({ role, is_active: 1 });
  // Kifle Ketemas that already have an active account of this role (a Financial Officer or Inspector may cover several)
  const covered = async (role) => new Set(await active(role)
    .join('user_kifle_ketemas as x', 'x.user_id', 'users.id').pluck('x.kifle_ketema_id'));
  const kebeleAdmins = () => active(ROLES.KEBELE_ADMIN).join('user_kebeles as x', 'x.user_id', 'users.id').pluck('x.kebele_id');
  const sectorAdmins = () => active(ROLES.SECTOR_ADMIN)
    .join('user_kebeles as x', 'x.user_id', 'users.id').join('user_sectors as y', 'y.user_id', 'users.id')
    .select('x.kebele_id', 'y.sector_id');
  const [kifle, kebeles, sectors, supers, mayors, auditors, kifleCovered, kebeleIds, sectorPairs, financeCovered, inspectorCovered] = await Promise.all([
    conn('kifle_ketemas').where({ is_active: 1 }).orderBy('name'),
    conn('kebeles').where({ is_active: 1 }).orderBy('name'),
    conn('sectors').where({ is_active: 1 }).orderBy('code'),
    active(ROLES.SUPER_ADMIN),
    active(ROLES.EXECUTIVE),
    active(ROLES.AUDITOR),
    covered(ROLES.KIFLE_ADMIN),
    kebeleAdmins(),
    sectorAdmins(),
    covered(ROLES.FINANCIAL_OFFICER),
    covered(ROLES.INSPECTOR),
  ]);
  const kebeleCovered = new Set(kebeleIds);
  const sectorCovered = new Set(sectorPairs.map((r) => `${r.kebele_id}:${r.sector_id}`));
  const plan = [];
  if (!supers.length) {
    plan.push({ username: 'superadmin', full_name: 'Super Administrator', role: ROLES.SUPER_ADMIN, area: 'Entire Jimma City', scope: {} });
  }
  for (const k of kifle) {
    if (kifleCovered.has(k.id)) continue;
    plan.push({ username: `kifle.${slug(k.name)}`, full_name: `${k.name} Kifle Ketema Administrator`, role: ROLES.KIFLE_ADMIN, area: `${k.name} Kifle Ketema`, scope: { kifle: [k.id] } });
  }
  for (const b of kebeles) {
    if (kebeleCovered.has(b.id)) continue;
    plan.push({ username: `kebele.${slug(b.name)}`, full_name: `${b.name} Kebele Administrator`, role: ROLES.KEBELE_ADMIN, area: `${b.name} Kebele`, scope: { kebeles: [b.id] } });
  }
  // One administrator for every sector inside every Kebele. This does not depend on which Kifle Ketema a Kebele belongs to.
  for (const b of kebeles) {
    for (const s of sectors) {
      if (sectorCovered.has(`${b.id}:${s.id}`)) continue;
      plan.push({
        username: `sector.${s.code.toLowerCase()}.${slug(b.name)}`,
        full_name: `${s.name} Sector Administrator, ${b.name}`,
        role: ROLES.SECTOR_ADMIN,
        area: `${s.name} in ${b.name} Kebele`,
        scope: { sectors: [s.id], kebeles: [b.id] },
      });
    }
  }
  // The specialist roles beside the hierarchy. The City has one active Mayor and one active Internal Auditor;
  // both see the whole City by role, so they get no assigned area.
  if (!mayors.length) {
    plan.push({ username: 'mayor', full_name: 'Mayor / Executive', role: ROLES.EXECUTIVE, area: 'Entire Jimma City', scope: {} });
  }
  if (!auditors.length) {
    plan.push({ username: 'auditor', full_name: 'Internal Auditor', role: ROLES.AUDITOR, area: 'Entire Jimma City', scope: {} });
  }
  for (const k of kifle) {
    if (!financeCovered.has(k.id)) {
      plan.push({ username: `finance.${slug(k.name)}`, full_name: `${k.name} Financial Officer`, role: ROLES.FINANCIAL_OFFICER, area: `${k.name} Kifle Ketema`, scope: { kifle: [k.id] } });
    }
  }
  for (const k of kifle) {
    if (!inspectorCovered.has(k.id)) {
      plan.push({ username: `inspector.${slug(k.name)}`, full_name: `${k.name} Inspector`, role: ROLES.INSPECTOR, area: `${k.name} Kifle Ketema`, scope: { kifle: [k.id] } });
    }
  }
  return plan;
}

/** Creates the missing accounts. Returns { created: [{..., password}], existing: [usernames] }. */
export async function provisionAdminAccounts(conn = db) {
  const plan = await planAdminAccounts(conn);
  const existing = new Set((await conn('users').select('username')).map((u) => u.username.toLowerCase()));
  const created = [];
  const skipped = [];
  for (const a of plan) {
    if (existing.has(a.username)) { skipped.push(a.username); continue; }
    const password = temporaryPassword();
    await conn.transaction(async (trx) => {
      const [id] = await trx('users').insert({
        username: a.username, full_name: a.full_name, role: a.role, password_hash: await bcrypt.hash(password, BCRYPT_ROUNDS),
        is_active: true, must_change_password: true, temp_password_expires_at: tempPasswordExpiry(),
      });
      for (const x of a.scope.kifle || []) await trx('user_kifle_ketemas').insert({ user_id: id, kifle_ketema_id: x });
      for (const x of a.scope.kebeles || []) await trx('user_kebeles').insert({ user_id: id, kebele_id: x });
      for (const x of a.scope.sectors || []) await trx('user_sectors').insert({ user_id: id, sector_id: x });
      await trx('audit_logs').insert({
        user_id: null, username: 'system', action: 'USER_CREATE', entity: 'user', entity_id: id,
        summary: `Created user ${a.username} (${ROLE_LABELS[a.role]}) by account provisioning`,
        changes: JSON.stringify({ role: a.role, area: a.area }),
      });
    });
    created.push({ ...a, password });
  }
  return { created, skipped, planned: plan.length };
}
