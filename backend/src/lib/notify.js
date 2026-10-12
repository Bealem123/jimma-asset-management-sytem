import { db } from '../db.js';
import { NOTIFICATION_TYPES } from './constants.js';
import { inScope, loadRolePermissions, hasAllScope } from './permissions.js';
import { sendEmail, sendSms } from './channels.js';

/** The rule for a notification type; falls back to "in-system only" if nobody has configured it. */
export async function getRule(type) {
  const row = await db('notification_rules').where({ type }).first();
  if (row) return { enabled: Boolean(row.enabled), lead_days: row.lead_days, email: Boolean(row.email), sms: Boolean(row.sms) };
  return { enabled: true, lead_days: NOTIFICATION_TYPES[type]?.lead ?? null, email: false, sms: false };
}

/**
 * Load users and their areas once, and return a function that answers
 * "who has this permission over this asset?". Used by alert scans that check many assets.
 */
export async function accessResolver() {
  const [users, perms, kifle, kebeles, sectors] = await Promise.all([
    db('users').where({ is_active: true }),
    loadRolePermissions(),
    db('user_kifle_ketemas'), db('user_kebeles'), db('user_sectors'),
  ]);
  const group = (rows, key) => rows.reduce((m, r) => ((m[r.user_id] ||= []).push(r[key]), m), {});
  const gk = group(kifle, 'kifle_ketema_id');
  const gb = group(kebeles, 'kebele_id');
  const gs = group(sectors, 'sector_id');
  return (asset, permission) => users.filter((u) => {
    if (!perms[u.role]?.has(permission)) return false;
    const probe = { role: u.role, scope: { kifle: gk[u.id] || [], kebeles: gb[u.id] || [], sectors: gs[u.id] || [] } };
    return hasAllScope(probe) || inScope(probe, asset);
  });
}

/** Active users whose role has `permission` and whose assigned area covers the asset. */
export async function usersWithAccess(asset, permission) {
  return (await accessResolver())(asset, permission);
}

/**
 * Create in-system notifications (and e-mail / SMS if the rule asks for it and the user has an address).
 * `dedupeKey` makes the call idempotent per user: the same alert is never raised twice.
 * Returns the number of notifications created.
 */
export async function notify({ type, userIds, title, body = null, assetId = null, link = null, dedupeKey = null }) {
  const rule = await getRule(type);
  if (!rule.enabled || !userIds.length) return 0;
  const users = await db('users').whereIn('id', [...new Set(userIds)]).where({ is_active: true });
  let created = 0;
  for (const u of users) {
    const [id] = await db('notifications')
      .insert({ user_id: u.id, type, title: title.slice(0, 200), body: body?.slice(0, 500) ?? null, asset_id: assetId, link, dedupe_key: dedupeKey })
      .onConflict().ignore();
    if (!id) continue; // duplicate alert
    created += 1;
    const text = `${title}${body ? ` - ${body}` : ''}`;
    const email_status = rule.email ? await sendEmail({ to: u.email, subject: `[Jimma Assets] ${title}`, text }) : null;
    const sms_status = rule.sms ? await sendSms({ to: u.phone, text }) : null;
    if (email_status || sms_status) await db('notifications').where({ id }).update({ email_status, sms_status });
  }
  return created;
}

/** Notify everyone who has `permission` over this asset (except `exceptUserId`, usually the person who acted). */
export async function notifyAsset(asset, permission, { exceptUserId = null, ...message }) {
  const users = await usersWithAccess(asset, permission);
  const ids = users.map((u) => u.id).filter((id) => id !== exceptUserId);
  return notify({ ...message, userIds: ids, assetId: asset.id, link: message.link ?? `/assets/${asset.id}` });
}

export const notifyUser = (userId, message) => notify({ ...message, userIds: [userId] });
