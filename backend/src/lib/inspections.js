import { db } from '../db.js';
import { applyScope } from './permissions.js';

/** The next inspection date (YYYY-MM-DD) of every asset in the user's area, taken from its latest inspection that names one. */
export async function nextInspections(user) {
  const inspections = await applyScope(db('inspection_records as i').join('assets', 'assets.id', 'i.asset_id'), user)
    .whereNotNull('i.next_inspection_date').whereNot('assets.status', 'DISPOSED').whereNull('assets.archived_at')
    .select('i.id', 'i.asset_id', 'i.inspection_date', 'i.next_inspection_date');
  const latest = new Map();
  for (const r of inspections) {
    const cur = latest.get(r.asset_id);
    if (!cur || r.inspection_date > cur.inspection_date || (r.inspection_date === cur.inspection_date && r.id > cur.id)) latest.set(r.asset_id, r);
  }
  return [...latest.values()].map((r) => String(r.next_inspection_date).slice(0, 10));
}
