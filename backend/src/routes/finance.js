import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { authenticate, require_ } from '../middleware/auth.js';
import { HttpError, badRequest, forbidden, notFound, parse } from '../middleware/errors.js';
import { applyScope, canViewFinancial, has, permissionCheck, scopedAsset } from '../lib/permissions.js';

const fail = (field, message) => new HttpError(400, 'Please correct the highlighted fields.', { [field]: message });
import { dateStr, optStr, reqStr, sanitizeSearchQuery, likePattern } from '../lib/schemas.js';
import { REVENUE_TYPES } from '../lib/constants.js';
import { assertNotDisposed } from '../lib/assetGuards.js';
import { recordRevenue, recordValuation, revenueSchema, valuationSchema } from '../lib/money.js';

const router = Router();
router.use(authenticate, require_(permissionCheck('financial.view'), 'Your role cannot view financial records.'));

const n = (v) => Number(v || 0);

// the ledgers' filters: a search text, a date range and one method or income type
const ledgerFilters = (extra) => z.object({
  q: z.preprocess((v) => sanitizeSearchQuery(v) || undefined, z.string().optional()),
  from: z.preprocess((v) => v || undefined, dateStr.optional()),
  to: z.preprocess((v) => v || undefined, dateStr.optional()),
  ...extra,
});

/** Base query for live (non-disposed, non-archived) assets in scope */
const liveAssets = (user) => applyScope(db('assets'), user)
  .whereNot('assets.status', 'DISPOSED')
  .whereNull('assets.archived_at');

// ------------------------------------------------------------------ Overview & KPIs
router.get('/overview', async (req, res) => {
  const user = req.user;
  const oneYearAgo = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);

  const [
    assetStats,
    revenueTotal,
    maintTotal,
    revenueTypes,
    categoryRows,
    sectorRows,
    recentValuations,
    recentRevenues,
  ] = await Promise.all([
    // Totals on live assets
    liveAssets(user)
      .select(
        db.raw('COUNT(assets.id) AS total_assets'),
        db.raw('SUM(COALESCE(assets.acquisition_cost, 0)) AS total_acquisition'),
        db.raw('SUM(COALESCE(assets.current_valuation, 0)) AS total_valuation'),
        db.raw('COUNT(CASE WHEN assets.current_valuation > 0 THEN 1 END) AS valued_count'),
        db.raw('COUNT(CASE WHEN assets.current_valuation IS NULL OR assets.current_valuation = 0 THEN 1 END) AS unvalued_count'),
        // valued, but not in the past year: an unvalued asset is counted above only, so the two add up to the backlog list
        db.raw('COUNT(CASE WHEN assets.current_valuation > 0 AND (assets.valuation_date IS NULL OR assets.valuation_date < ?) THEN 1 END) AS revaluation_due_count', [oneYearAgo]),
      )
      .first(),

    // Total revenues
    applyScope(db('asset_revenues').join('assets', 'assets.id', 'asset_revenues.asset_id'), user)
      .sum({ total: 'asset_revenues.amount' })
      .count({ count: 'asset_revenues.id' })
      .first(),

    // Total maintenance spending
    applyScope(db('maintenance_records').join('assets', 'assets.id', 'maintenance_records.asset_id'), user)
      .whereNot('maintenance_records.status', 'CANCELLED')
      .sum({ total: 'maintenance_records.cost' })
      .first(),

    // Revenues by type
    applyScope(db('asset_revenues').join('assets', 'assets.id', 'asset_revenues.asset_id'), user)
      .select('asset_revenues.revenue_type')
      .sum({ total: 'asset_revenues.amount' })
      .count({ count: 'asset_revenues.id' })
      .groupBy('asset_revenues.revenue_type'),

    // Breakdown by Category
    liveAssets(user)
      .join('asset_categories as c', 'c.id', 'assets.category_id')
      .select('c.id', 'c.name')
      .count({ count: 'assets.id' })
      .sum({ valuation: 'assets.current_valuation', acquisition: 'assets.acquisition_cost' })
      .groupBy('c.id', 'c.name')
      .orderBy('c.name'),

    // Breakdown by Sector
    liveAssets(user)
      .join('sectors as s', 's.id', 'assets.sector_id')
      .select('s.id', 's.code', 's.name')
      .count({ count: 'assets.id' })
      .sum({ valuation: 'assets.current_valuation', acquisition: 'assets.acquisition_cost' })
      .groupBy('s.id', 's.code', 's.name')
      .orderBy('s.code'),

    // Recent 10 valuations
    applyScope(db('asset_valuations as v').join('assets as a', 'a.id', 'v.asset_id'), user, 'a')
      .leftJoin('users as u', 'u.id', 'v.recorded_by')
      .select(
        'v.id', 'v.asset_id', 'v.valuation_date', 'v.value', 'v.method', 'v.notes', 'v.created_at',
        'a.asset_code', 'a.name as asset_name', 'u.full_name as recorder_name',
      )
      .orderBy('v.valuation_date', 'desc')
      .orderBy('v.id', 'desc')
      .limit(10),

    // Recent 10 revenues
    applyScope(db('asset_revenues as r').join('assets as a', 'a.id', 'r.asset_id'), user, 'a')
      .leftJoin('users as u', 'u.id', 'r.recorded_by')
      .select(
        'r.id', 'r.asset_id', 'r.revenue_type', 'r.amount', 'r.received_date', 'r.payer', 'r.reference', 'r.created_at',
        'a.asset_code', 'a.name as asset_name', 'u.full_name as recorder_name',
      )
      .orderBy('r.received_date', 'desc')
      .orderBy('r.id', 'desc')
      .limit(10),
  ]);

  const totalAssets = n(assetStats?.total_assets);
  const valuedCount = n(assetStats?.valued_count);
  const coveragePct = totalAssets > 0 ? Math.round((valuedCount / totalAssets) * 1000) / 10 : 0;

  res.json({
    totals: {
      total_assets: totalAssets,
      total_acquisition: n(assetStats?.total_acquisition),
      total_valuation: n(assetStats?.total_valuation),
      valued_count: valuedCount,
      unvalued_count: n(assetStats?.unvalued_count),
      revaluation_due_count: n(assetStats?.revaluation_due_count),
      total_revenue: n(revenueTotal?.total),
      revenue_count: n(revenueTotal?.count),
      total_maintenance: n(maintTotal?.total),
      valuation_coverage_pct: coveragePct,
    },
    by_category: categoryRows.map((r) => ({
      id: r.id,
      name: r.name,
      count: n(r.count),
      valuation: n(r.valuation),
      acquisition: n(r.acquisition),
    })),
    by_sector: sectorRows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      count: n(r.count),
      valuation: n(r.valuation),
      acquisition: n(r.acquisition),
    })),
    by_revenue_type: REVENUE_TYPES.map((type) => {
      const match = revenueTypes.find((r) => r.revenue_type === type);
      return {
        type,
        total: n(match?.total),
        count: n(match?.count),
      };
    }),
    recent_valuations: recentValuations,
    recent_revenues: recentRevenues,
  });
});

// ------------------------------------------------------------------ Valuations Ledger
router.get('/valuations', async (req, res) => {
  const { q, from, to, method } = parse(ledgerFilters({ method: z.preprocess((v) => v || undefined, z.string().trim().max(200).optional()) }), req.query);
  let query = applyScope(db('asset_valuations as v').join('assets as a', 'a.id', 'v.asset_id'), req.user, 'a')
    .leftJoin('users as u', 'u.id', 'v.recorded_by')
    .leftJoin('asset_categories as c', 'c.id', 'a.category_id')
    .leftJoin('sectors as s', 's.id', 'a.sector_id')
    .leftJoin('kifle_ketemas as k', 'k.id', 'a.kifle_ketema_id')
    .leftJoin('kebeles as kb', 'kb.id', 'a.kebele_id')
    .select(
      'v.id', 'v.asset_id', 'v.valuation_date', 'v.value', 'v.method', 'v.notes', 'v.created_at',
      'a.asset_code', 'a.name as asset_name', 'a.status as asset_status',
      'c.name as category_name', 's.name as sector_name', 's.code as sector_code',
      'k.name as kifle_name', 'kb.name as kebele_name',
      'u.full_name as recorder_name', 'u.username as recorder_username',
    );

  if (q && q.trim()) {
    const term = likePattern(q.trim());
    query = query.where((b) => b
      .where('a.asset_code', 'like', term)
      .orWhere('a.name', 'like', term)
      .orWhere('v.method', 'like', term)
      .orWhere('v.notes', 'like', term));
  }
  if (from) query = query.where('v.valuation_date', '>=', from);
  if (to) query = query.where('v.valuation_date', '<=', to);
  if (method) query = query.where('v.method', method);

  const rows = await query.orderBy('v.valuation_date', 'desc').orderBy('v.id', 'desc').limit(200);
  res.json(rows);
});

// ------------------------------------------------------------------ Revenues Ledger
router.get('/revenues', async (req, res) => {
  const { q, from, to, revenue_type } = parse(ledgerFilters({ revenue_type: z.preprocess((v) => v || undefined, z.enum(REVENUE_TYPES).optional()) }), req.query);
  let query = applyScope(db('asset_revenues as r').join('assets as a', 'a.id', 'r.asset_id'), req.user, 'a')
    .leftJoin('users as u', 'u.id', 'r.recorded_by')
    .leftJoin('asset_categories as c', 'c.id', 'a.category_id')
    .leftJoin('sectors as s', 's.id', 'a.sector_id')
    .leftJoin('kifle_ketemas as k', 'k.id', 'a.kifle_ketema_id')
    .leftJoin('kebeles as kb', 'kb.id', 'a.kebele_id')
    .select(
      'r.id', 'r.asset_id', 'r.revenue_type', 'r.amount', 'r.received_date',
      'r.period_start', 'r.period_end', 'r.payer', 'r.reference', 'r.notes', 'r.created_at',
      'a.asset_code', 'a.name as asset_name', 'a.status as asset_status',
      'c.name as category_name', 's.name as sector_name',
      'k.name as kifle_name', 'kb.name as kebele_name',
      'u.full_name as recorder_name', 'u.username as recorder_username',
    );

  if (q && q.trim()) {
    const term = likePattern(q.trim());
    query = query.where((b) => b
      .where('a.asset_code', 'like', term)
      .orWhere('a.name', 'like', term)
      .orWhere('r.payer', 'like', term)
      .orWhere('r.reference', 'like', term)
      .orWhere('r.notes', 'like', term));
  }
  if (from) query = query.where('r.received_date', '>=', from);
  if (to) query = query.where('r.received_date', '<=', to);
  if (revenue_type) query = query.where('r.revenue_type', revenue_type);

  const rows = await query.orderBy('r.received_date', 'desc').orderBy('r.id', 'desc').limit(200);
  res.json(rows);
});

// ------------------------------------------------------------------ Valuation Backlog & Pipeline
router.get('/backlog', async (req, res) => {
  const oneYearAgo = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
  const rows = await liveAssets(req.user)
    .leftJoin('asset_categories as c', 'c.id', 'assets.category_id')
    .leftJoin('sectors as s', 's.id', 'assets.sector_id')
    .leftJoin('kifle_ketemas as k', 'k.id', 'assets.kifle_ketema_id')
    .leftJoin('kebeles as kb', 'kb.id', 'assets.kebele_id')
    .where((b) => b
      .whereNull('assets.current_valuation')
      .orWhere('assets.current_valuation', 0)
      .orWhereNull('assets.valuation_date')
      .orWhere('assets.valuation_date', '<', oneYearAgo))
    .select(
      'assets.id', 'assets.asset_code', 'assets.name', 'assets.status', 'assets.condition',
      'assets.acquisition_cost', 'assets.current_valuation', 'assets.valuation_date',
      'c.name as category_name', 's.name as sector_name', 's.code as sector_code',
      'k.name as kifle_name', 'kb.name as kebele_name',
    )
    .orderByRaw('CASE WHEN assets.current_valuation IS NULL OR assets.current_valuation = 0 THEN 0 ELSE 1 END')
    .orderBy('assets.valuation_date', 'asc')
    .limit(150);

  res.json(rows);
});

// ------------------------------------------------------------------ Asset search for financial logging
router.get('/assets-search', async (req, res) => {
  const q = sanitizeSearchQuery(req.query.q);
  let query = liveAssets(req.user)
    .leftJoin('asset_categories as c', 'c.id', 'assets.category_id')
    .select('assets.id', 'assets.asset_code', 'assets.name', 'assets.current_valuation', 'assets.valuation_date', 'c.name as category_name')
    .limit(25);

  if (q && q.trim()) {
    const term = likePattern(q.trim());
    query = query.where((b) => b.where('assets.asset_code', 'like', term).orWhere('assets.name', 'like', term));
  }
  const results = await query;
  res.json(results);
});

// ------------------------------------------------------------------ Record Valuation
router.post('/valuations', async (req, res) => {
  if (!has(req.user, 'financial.edit')) throw fail('forbidden', 'You do not have permission to record valuations.');
  const { asset_id: assetId, ...d } = parse(valuationSchema.extend({ asset_id: z.coerce.number().int().positive() }), req.body);
  const asset = await scopedAsset(req.user, assetId);
  if (!asset) throw fail('asset_id', 'Asset not found or not in your jurisdiction.');
  assertNotDisposed(asset);
  res.status(201).json(await recordValuation(req.user, asset, d));
});

// ------------------------------------------------------------------ Record Revenue
router.post('/revenues', async (req, res) => {
  if (!has(req.user, 'financial.edit')) throw fail('forbidden', 'You do not have permission to record revenue.');
  const { asset_id: assetId, ...d } = parse(revenueSchema.extend({ asset_id: z.coerce.number().int().positive() }), req.body);
  const asset = await scopedAsset(req.user, assetId);
  if (!asset) throw fail('asset_id', 'Asset not found or not in your jurisdiction.');
  assertNotDisposed(asset);
  res.status(201).json(await recordRevenue(req.user, asset, d));
});

export default router;
