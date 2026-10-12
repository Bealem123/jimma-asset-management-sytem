import { db } from '../db.js';

/**
 * Append an entry to the audit trail. Pass a transaction as `conn` to make the
 * log part of the same unit of work as the change it describes.
 */
export async function logAudit(conn, user, { action, entity, entityId = null, assetId = null, summary, changes = null }) {
  await (conn || db)('audit_logs').insert({
    user_id: user?.id ?? null,
    username: user?.username ?? null,
    action,
    entity,
    entity_id: entityId,
    asset_id: assetId,
    summary: String(summary).slice(0, 500),
    changes: changes ? JSON.stringify(changes) : null,
  });
}

/** Field-level diff of two plain objects, limited to the given keys. */
export function diff(before, after, keys) {
  const out = {};
  for (const k of keys) {
    const a = before[k] ?? null;
    const b = after[k] ?? null;
    if (String(a) !== String(b)) out[k] = { from: a, to: b };
  }
  return out;
}
