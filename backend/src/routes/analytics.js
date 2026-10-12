import { Router } from 'express';
import { db } from '../db.js';
import { authenticate, require_ } from '../middleware/auth.js';
import { applyScope, canViewFinancial, permissionCheck, seesKebeleLevel } from '../lib/permissions.js';
import { depreciation } from '../lib/depreciation.js';

const router = Router();
router.use(authenticate, require_(permissionCheck('analytics.view'), 'Your role cannot see analytics.'));

const n = (v) => Number(v || 0);
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const monthsBack = (count) => {
  const out = [];
  const d = new Date();
  d.setUTCDate(1);
  for (let i = count - 1; i >= 0; i -= 1) {
    const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    out.push(x.toISOString().slice(0, 7));
  }
  return out;
};

router.get('/', async (req, res) => {
  const user = req.user;
  const money = canViewFinancial(user);
  const live = () => applyScope(db('assets'), user).whereNot('assets.status', 'DISPOSED').whereNull('assets.archived_at');
  const today = new Date().toISOString().slice(0, 10);
  const ninetyAgo = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);

  const maintTotals = db('maintenance_records').whereNot('status', 'CANCELLED').select('asset_id').sum({ total: 'cost' }).count({ jobs: 'id' }).groupBy('asset_id').as('mc');
  const withCosts = () => live().leftJoin(maintTotals, 'mc.asset_id', 'assets.id');

  const [
    sectorRows, kifleRows, kebeleRows, costRows, critical, underused, noReservations, assetsForValue,
    regTrend, maintTrend, failTrend, conditionTrend, totals, overdue, lastCampaign,
  ] = await Promise.all([
    live().join('sectors as s', 's.id', 'assets.sector_id').leftJoin(maintTotals, 'mc.asset_id', 'assets.id')
      .select('s.id', 's.code', 's.name').count({ assets: 'assets.id' }).sum({ value: 'assets.current_valuation', cost: 'assets.acquisition_cost', maintenance: 'mc.total' })
      .select(db.raw("SUM(assets.`condition` IN ('POOR','CRITICAL')) AS poor")).groupBy('s.id', 's.code', 's.name').orderBy('s.code'),
    live().join('kifle_ketemas as k', 'k.id', 'assets.kifle_ketema_id').leftJoin(maintTotals, 'mc.asset_id', 'assets.id')
      .select('k.id', 'k.name').count({ assets: 'assets.id' }).sum({ value: 'assets.current_valuation', maintenance: 'mc.total' })
      .select(db.raw("SUM(assets.`condition` IN ('POOR','CRITICAL')) AS poor")).groupBy('k.id', 'k.name').orderBy('k.name'),
    live().join('kebeles as b', 'b.id', 'assets.kebele_id')
      .select('b.id', 'b.name').count({ assets: 'assets.id' }).sum({ value: 'assets.current_valuation' })
      .select(db.raw("SUM(assets.`condition` IN ('POOR','CRITICAL')) AS poor")).groupBy('b.id', 'b.name').orderBy('b.name'),
    withCosts().whereNotNull('mc.total').select('assets.id', 'assets.asset_code', 'assets.name', 'assets.acquisition_cost', 'assets.current_valuation', 'assets.condition', 'mc.total as maintenance_cost', 'mc.jobs')
      .orderBy('mc.total', 'desc').limit(25),
    live().where('assets.condition', 'CRITICAL').select('assets.id', 'assets.asset_code', 'assets.name', 'assets.condition', 'assets.status').orderBy('assets.asset_code').limit(50),
    // active assets with no current use, or only an IDLE use
    live().where('assets.status', 'ACTIVE').where('assets.approval_state', 'ACTIVE')
      .whereRaw(`NOT EXISTS (SELECT 1 FROM utilizations u WHERE u.asset_id = assets.id AND u.use_type <> 'IDLE' AND u.start_date <= CURDATE() AND (u.end_date IS NULL OR u.end_date >= CURDATE()))`)
      .select('assets.id', 'assets.asset_code', 'assets.name', 'assets.condition', 'assets.created_at').orderBy('assets.asset_code').limit(100),
    live().where('assets.is_reservable', 1).where('assets.status', 'ACTIVE')
      .whereRaw('NOT EXISTS (SELECT 1 FROM asset_reservations r WHERE r.asset_id = assets.id AND r.status = ? AND r.end_at >= ?)', ['APPROVED', `${ninetyAgo} 00:00:00`])
      .select('assets.id', 'assets.asset_code', 'assets.name').limit(50),
    live().select('assets.id', 'assets.asset_code', 'assets.name', 'assets.acquisition_cost', 'assets.current_valuation', 'assets.acquisition_date', 'assets.useful_life_years', 'assets.salvage_value', 'assets.condition'),
    live().select(db.raw("DATE_FORMAT(assets.created_at, '%Y-%m') as month")).count({ n: 'assets.id' }).groupBy('month'),
    applyScope(db('maintenance_records as m').join('assets', 'assets.id', 'm.asset_id'), user).whereNot('m.status', 'CANCELLED')
      .select(db.raw("DATE_FORMAT(m.maintenance_date, '%Y-%m') as month")).count({ n: 'm.id' }).sum({ cost: 'm.cost' }).groupBy('month'),
    applyScope(db('inspection_records as i').join('assets', 'assets.id', 'i.asset_id'), user)
      .select(db.raw("DATE_FORMAT(i.inspection_date, '%Y-%m') as month")).count({ n: 'i.id' }).select(db.raw("SUM(i.result = 'FAILED') AS failed")).groupBy('month'),
    applyScope(db('audit_logs as a').join('assets', 'assets.id', 'a.asset_id'), user).where('a.action', 'CONDITION_CHANGE')
      .select(db.raw("DATE_FORMAT(a.created_at, '%Y-%m') as month")).count({ n: 'a.id' }).groupBy('month'),
    live().count({ total: 'assets.id' }).sum({ cost: 'assets.acquisition_cost', value: 'assets.current_valuation' }).select(db.raw("SUM(assets.`condition` IN ('POOR','CRITICAL')) AS poor")).first(),
    live().join('maintenance_records as m', 'm.asset_id', 'assets.id').whereNotNull('m.next_maintenance_date').where('m.next_maintenance_date', '<', today)
      .whereNot('m.status', 'CANCELLED')
      .whereRaw('m.id = (SELECT m2.id FROM maintenance_records m2 WHERE m2.asset_id = assets.id AND m2.next_maintenance_date IS NOT NULL AND m2.status <> ? ORDER BY m2.maintenance_date DESC, m2.id DESC LIMIT 1)', ['CANCELLED'])
      .countDistinct({ n: 'assets.id' }).first(),
    db('verification_campaigns').orderBy('id', 'desc').first(),
  ]);

  const total = n(totals.total);

  // replacement candidates: poor/critical condition and (heavy repair spend, or past useful life)
  const replacement = [];
  const bookValues = [];
  for (const a of assetsForValue) {
    const dep = depreciation(a);
    if (dep) bookValues.push({ ...a, ...dep });
  }
  const costById = new Map(costRows.map((r) => [r.id, r]));
  for (const a of assetsForValue) {
    if (!['POOR', 'CRITICAL'].includes(a.condition)) continue;
    const mc = n(costById.get(a.id)?.maintenance_cost);
    const ratio = a.acquisition_cost ? mc / a.acquisition_cost : null;
    const dep = depreciation(a);
    const reasons = [];
    if (a.condition === 'CRITICAL') reasons.push('critical condition');
    if (ratio != null && ratio >= 0.5) reasons.push(`repairs cost ${Math.round(ratio * 100)}% of purchase price`);
    if (dep?.fully_depreciated) reasons.push('past its useful life');
    if (reasons.length >= 1 && (a.condition === 'CRITICAL' || reasons.length >= 2 || ratio >= 0.5)) {
      replacement.push({ id: a.id, asset_code: a.asset_code, name: a.name, condition: a.condition, reasons, ...(money ? { maintenance_cost: mc, acquisition_cost: a.acquisition_cost } : {}) });
    }
  }

  const fillMonths = (rows, extra) => monthsBack(12).map((month) => {
    const r = rows.find((x) => x.month === month);
    return { month, ...extra(r) };
  });

  const poorPct = pct(n(totals.poor), total);
  const overduePct = pct(n(overdue.n), total);
  const indicators = [
    { key: 'poor_share', label: 'Assets in poor or critical condition', value: poorPct, unit: '%', status: poorPct > 25 ? 'bad' : poorPct > 10 ? 'warn' : 'good', hint: 'Above 10% needs a maintenance plan; above 25% needs a funding decision.' },
    { key: 'overdue_maintenance', label: 'Assets with overdue maintenance', value: overduePct, unit: '%', status: overduePct > 15 ? 'bad' : overduePct > 5 ? 'warn' : 'good', hint: 'Overdue maintenance shortens asset life.' },
    { key: 'underused', label: 'Active assets with no current use', value: pct(underused.length, total), unit: '%', status: pct(underused.length, total) > 20 ? 'warn' : 'good', hint: 'Idle assets could be reassigned, leased or disposed of.' },
    { key: 'critical', label: 'Assets in critical condition', value: critical.length, unit: '', status: critical.length ? 'bad' : 'good', hint: 'Inspect and decide: repair, replace or retire.' },
  ];
  if (lastCampaign) {
    const items = await applyScope(db('verification_items as i').join('assets', 'assets.id', 'i.asset_id'), user).where('i.campaign_id', lastCampaign.id)
      .select('i.result').count({ n: 'i.id' }).groupBy('i.result');
    const all = items.reduce((s, r) => s + n(r.n), 0);
    const ok = n(items.find((r) => r.result === 'FOUND')?.n);
    const rate = pct(ok, all);
    indicators.push({ key: 'verified_ok', label: `Verified in place (${lastCampaign.name})`, value: rate, unit: '%', status: rate < 80 ? 'bad' : rate < 95 ? 'warn' : 'good', hint: 'Share of assets found exactly where the register says.' });
  }

  res.json({
    can_see_money: money,
    kebele_level: seesKebeleLevel(user),
    totals: { assets: total, poor_or_critical: n(totals.poor), ...(money ? { acquisition_cost: n(totals.cost), current_valuation: n(totals.value) } : {}) },
    indicators,
    sector_comparison: sectorRows.map((r) => ({ id: r.id, code: r.code, name: r.name, assets: n(r.assets), poor: n(r.poor), poor_share: pct(n(r.poor), n(r.assets)), ...(money ? { value: n(r.value), cost: n(r.cost), maintenance: n(r.maintenance) } : {}) })),
    geographic_comparison: {
      kifle_ketema: kifleRows.map((r) => ({ id: r.id, name: r.name, assets: n(r.assets), poor: n(r.poor), poor_share: pct(n(r.poor), n(r.assets)), ...(money ? { value: n(r.value), maintenance: n(r.maintenance) } : {}) })),
      kebele: !seesKebeleLevel(user) ? [] : kebeleRows.map((r) => ({ id: r.id, name: r.name, assets: n(r.assets), poor: n(r.poor), poor_share: pct(n(r.poor), n(r.assets)), ...(money ? { value: n(r.value) } : {}) })),
    },
    high_maintenance: money ? costRows.slice(0, 10).map((r) => ({
      id: r.id, asset_code: r.asset_code, name: r.name, condition: r.condition, jobs: n(r.jobs), maintenance_cost: n(r.maintenance_cost), acquisition_cost: r.acquisition_cost,
      cost_ratio: r.acquisition_cost ? Math.round((n(r.maintenance_cost) / r.acquisition_cost) * 100) : null,
    })) : [],
    lifecycle_cost: money ? costRows.filter((r) => r.acquisition_cost).slice(0, 10).map((r) => ({
      id: r.id, asset_code: r.asset_code, name: r.name, acquisition_cost: r.acquisition_cost, maintenance_cost: n(r.maintenance_cost), total_cost: r.acquisition_cost + n(r.maintenance_cost),
    })) : [],
    critical_assets: critical,
    underutilized: underused,
    unreserved_reservable: noReservations,
    replacement_candidates: replacement.slice(0, 50),
    value_analysis: money ? {
      acquisition_cost: n(totals.cost), current_valuation: n(totals.value),
      book_value: Math.round(bookValues.reduce((s, b) => s + b.book_value, 0) * 100) / 100,
      accumulated_depreciation: Math.round(bookValues.reduce((s, b) => s + b.accumulated, 0) * 100) / 100,
      assets_with_depreciation: bookValues.length, fully_depreciated: bookValues.filter((b) => b.fully_depreciated).length,
    } : null,
    trends: {
      registrations: fillMonths(regTrend, (r) => ({ assets: n(r?.n) })),
      maintenance: fillMonths(maintTrend, (r) => ({ jobs: n(r?.n), ...(money ? { cost: n(r?.cost) } : {}) })),
      inspections: fillMonths(failTrend, (r) => ({ inspections: n(r?.n), failed: n(r?.failed) })),
      condition_changes: fillMonths(conditionTrend, (r) => ({ changes: n(r?.n) })),
    },
  });
});

export default router;
