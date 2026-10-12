import { db } from '../db.js';
import { likePattern } from './schemas.js';

const CURRENT_REVENUE_SQL = `EXISTS (SELECT 1 FROM utilizations u WHERE u.asset_id = assets.id AND u.generates_revenue = 1
  AND u.start_date <= CURDATE() AND (u.end_date IS NULL OR u.end_date >= CURDATE()))`;

/** Assets joined with their lookup names, plus a computed "generates revenue now" flag. */
export function assetBase() {
  return db('assets')
    .join('asset_categories as c', 'c.id', 'assets.category_id')
    .leftJoin('asset_types as t', 't.id', 'assets.asset_type_id')
    .join('sectors as s', 's.id', 'assets.sector_id')
    .leftJoin('departments as d', 'd.id', 'assets.department_id')
    .join('kifle_ketemas as k', 'k.id', 'assets.kifle_ketema_id')
    .leftJoin('kebeles as b', 'b.id', 'assets.kebele_id')
    .select(
      'assets.*',
      'c.name as category_name',
      't.name as asset_type_name',
      's.name as sector_name',
      's.code as sector_code',
      'd.name as department_name',
      'k.name as kifle_ketema_name',
      'b.name as kebele_name',
      db.raw(`${CURRENT_REVENUE_SQL} AS generates_revenue`),
    );
}

export const parseDetails = (v) => {
  if (!v) return {};
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return {}; }
};
export const normalizeAsset = (row) => (row ? { ...row, generates_revenue: Boolean(row.generates_revenue), details: parseDetails(row.details) } : row);

/** Filters shared by the asset list, CSV export and reports. Only touches `assets` columns. */
export function applyFilters(qb, f) {
  if (f.q) {
    const like = likePattern(f.q);
    qb.where((b) => b.where('assets.name', 'like', like).orWhere('assets.asset_code', 'like', like)
      .orWhere('assets.current_holder', 'like', like).orWhere('assets.location_detail', 'like', like)
      .orWhere('assets.serial_number', 'like', like).orWhere('assets.registration_number', 'like', like)
      .orWhere('assets.responsible_officer', 'like', like).orWhere('assets.responsible_office', 'like', like));
  }
  for (const key of [
    'category_id', 'asset_type_id', 'sector_id', 'department_id', 'kifle_ketema_id', 'kebele_id', 'status', 'condition',
    'approval_state', 'ownership_type',
  ]) {
    if (f[key] != null) qb.where(`assets.${key}`, f[key]);
  }
  if (f.serial_number) qb.where('assets.serial_number', 'like', likePattern(f.serial_number));
  if (f.responsible) {
    const like = likePattern(f.responsible);
    qb.where((b) => b.where('assets.responsible_officer', 'like', like).orWhere('assets.current_holder', 'like', like)
      .orWhere('assets.responsible_office', 'like', like));
  }
  if (f.location) qb.where('assets.location_detail', 'like', likePattern(f.location));
  if (f.reservable === 'yes') qb.where('assets.is_reservable', 1);
  if (!f.include_archived) qb.whereNull('assets.archived_at');
  if (f.revenue === 'yes') qb.whereRaw(CURRENT_REVENUE_SQL);
  if (f.revenue === 'no') qb.whereRaw(`NOT ${CURRENT_REVENUE_SQL}`);
  return qb;
}
