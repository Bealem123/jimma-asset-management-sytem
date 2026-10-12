import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { db } from '../db.js';
import { ROLES, ROLE_LABELS } from './constants.js';

// Creates the standard set of administrator accounts for Jimma City:
//   1 Super Administrator            whole city
//   1 Kifle Ketema Administrator     per Kifle Ketema             (3)
//   1 Kebele Administrator           per Kebele                   (13)
//   1 Sector Administrator           per Sector in each Kebele    (13 x 13 = 169)
// Safe to run again: an account that already exists is left alone (its password is NOT changed).
// Every new account gets a random temporary password and must choose its own at first sign-in.

const ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no look-alike characters (0 O 1 l I)

export function temporaryPassword(length = 14) {
  let out = '';
  while (out.length < length) {
    const byte = crypto.randomBytes(1)[0];
    if (byte < ALPHABET.length * Math.floor(256 / ALPHABET.length)) out += ALPHABET[byte % ALPHABET.length];
  }
  return out;
}

const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** What would be created, without touching the database. */
export async function planAdminAccounts(conn = db) {
  const [kifle, kebeles, sectors, supers] = await Promise.all([
    conn('kifle_ketemas').where({ is_active: 1 }).orderBy('name'),
    conn('kebeles').where({ is_active: 1 }).orderBy('name'),
    conn('sectors').where({ is_active: 1 }).orderBy('code'),
    conn('users').where({ role: ROLES.SUPER_ADMIN, is_active: 1 }),
  ]);
  const plan = [];
  if (!supers.length) {
    plan.push({ username: 'superadmin', full_name: 'Super Administrator', role: ROLES.SUPER_ADMIN, area: 'Entire Jimma City', scope: {} });
  }
  for (const k of kifle) {
    plan.push({ username: `kifle.${slug(k.name)}`, full_name: `${k.name} Kifle Ketema Administrator`, role: ROLES.KIFLE_ADMIN, area: `${k.name} Kifle Ketema`, scope: { kifle: [k.id] } });
  }
  for (const b of kebeles) {
    plan.push({ username: `kebele.${slug(b.name)}`, full_name: `${b.name} Kebele Administrator`, role: ROLES.KEBELE_ADMIN, area: `${b.name} Kebele`, scope: { kebeles: [b.id] } });
  }
  // One administrator for every sector inside every Kebele. This does not depend on which Kifle Ketema a Kebele belongs to.
  for (const b of kebeles) {
    for (const s of sectors) {
      plan.push({
        username: `sector.${s.code.toLowerCase()}.${slug(b.name)}`,
        full_name: `${s.name} Sector Administrator, ${b.name}`,
        role: ROLES.SECTOR_ADMIN,
        area: `${s.name} in ${b.name} Kebele`,
        scope: { sectors: [s.id], kebeles: [b.id] },
      });
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
        username: a.username, full_name: a.full_name, role: a.role, password_hash: await bcrypt.hash(password, 10),
        is_active: true, must_change_password: true,
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
