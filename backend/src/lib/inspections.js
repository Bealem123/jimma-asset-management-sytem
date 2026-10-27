import { db } from '../db.js';
import { applyScope } from './permissions.js';

const day = (v) => String(v).slice(0, 10);

/**
 * When each live asset is next due for inspection: the next date its latest inspection names or, for an asset in use
 * (ACTIVE) that has never been inspected, the day it was activated: its first inspection is due as soon as it is in use.
 * An asset whose latest inspection names no next date is not due. `scope` limits the assets (to a user's area);
 * `cols` adds asset columns to each row. Each row: { asset_id, record_id (null for a first inspection), due, ...cols }.
 */
export async function inspectionsDue(scope = (q) => q, cols = []) {
  const live = (q) => scope(q).whereNot('assets.status', 'DISPOSED').whereNull('assets.archived_at');
  const [records, never] = await Promise.all([
    live(db('inspection_records as i').join('assets', 'assets.id', 'i.asset_id')).whereNotNull('i.next_inspection_date')
      .select('i.id as record_id', 'i.asset_id', 'i.inspection_date', 'i.next_inspection_date', ...cols),
    live(db('assets')).where('assets.approval_state', 'ACTIVE')
      .whereNotExists(db('inspection_records as i').whereRaw('i.asset_id = assets.id'))
      .select('assets.id as asset_id', 'assets.approval_state_at', ...cols),
  ]);
  const latest = new Map();
  for (const r of records) {
    const cur = latest.get(r.asset_id);
    if (!cur || r.inspection_date > cur.inspection_date || (r.inspection_date === cur.inspection_date && r.record_id > cur.record_id)) latest.set(r.asset_id, r);
  }
  return [
    ...[...latest.values()].map((r) => ({ ...r, due: day(r.next_inspection_date) })),
    ...never.map((r) => ({ ...r, record_id: null, due: day(r.approval_state_at) })),
  ];
}

/** The next inspection date (YYYY-MM-DD) of every asset in the user's area that has one (see inspectionsDue). */
export async function nextInspections(user) {
  return (await inspectionsDue((q) => applyScope(q, user))).map((r) => r.due);
}
