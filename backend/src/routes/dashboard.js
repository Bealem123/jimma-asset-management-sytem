import { Router } from 'express';
import { db } from '../db.js';
import { authenticate, require_ } from '../middleware/auth.js';
import {
  applyScope, canApprove, canDecideRequests, canReview, canViewFinancial, has, hasAllScope, permissionCheck, seesKebeleLevel,
} from '../lib/permissions.js';
import { applyFilters } from '../lib/assetQuery.js';
import { nextInspections } from '../lib/inspections.js';
import { monthlyQueue } from '../lib/monthlyReports.js';
import { CONDITIONS, DUE_WINDOW_DAYS, STATUSES, APPROVAL_STATES, ROLES } from '../lib/constants.js';

const router = Router();

// The dashboard's "What happened" card: outcomes on the assets in this person's area that someone acts on — the
// registration and its approval steps, decisions on requests, use, maintenance, inspections, changes of status.
// Opening, downloading and exporting files stay in the audit log (the Audit page), as do money entries for those
// who may not see money.
const ACTIVITY = [
  'CREATE', 'UPDATE', 'SUBMIT', 'REVIEW', 'APPROVE', 'ACTIVATE', 'REJECT', 'STATUS_CHANGE', 'CONDITION_CHANGE', 'LOCATION_CORRECTION',
  'TRANSFER', 'ASSIGN', 'OWNERSHIP_CHANGE', 'REQUEST_CREATE', 'REQUEST_REVIEW', 'REQUEST_APPROVE', 'REQUEST_REJECT', 'REQUEST_CANCEL',
  'MAINTENANCE_ADD', 'MAINTENANCE_UPDATE', 'INSPECTION_ADD', 'UTILIZATION_ADD', 'UTILIZATION_END', 'RESERVATION_APPROVE', 'RESERVATION_REJECT',
  'FOLLOW_UP_ADD', 'FOLLOW_UP_CLOSE', 'VERIFICATION_RECORD', 'ARCHIVE', 'UNARCHIVE',
];
const MONEY_ACTIVITY = ['VALUATION_ADD', 'REVENUE_ADD'];
const ACTIVITY_SIZE = 50;
const parseJson = (v) => { if (!v || typeof v === 'object') return v; try { return JSON.parse(v); } catch { return null; } };

/** One entry of the card: who (by name and role), which asset, what happened, and the detail that matters. */
const activityRow = (r) => {
  const changes = parseJson(r.changes);
  return {
    id: r.id, created_at: r.created_at, action: r.action, summary: r.summary,
    asset_id: r.asset_id, asset_code: r.asset_code, asset_name: r.asset_name,
    who: r.full_name || r.username, who_role: r.role ?? null,
    // why it was sent back (the reason is the last bracket of the summary)
    ...(r.action === 'REJECT' && { reason: /\((.*)\)$/s.exec(r.summary)?.[1] ?? null }),
    // what the Kebele Administrator found on site
    ...(r.action === 'REVIEW' && { site_check: changes?.site_check ?? null }),
  };
};
router.use(authenticate);

const isoDay = (offsetDays = 0) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);

router.get('/', async (req, res) => {
  const user = req.user;
  const scoped = () => applyScope(db('assets'), user).whereNull('assets.archived_at');
  const money = canViewFinancial(user);
  const count = { n: 'assets.id' };

  const grouped = async (table, fk, { nullable = false, label = 'Not specified' } = {}) => {
    const q = scoped();
    if (nullable) q.leftJoin(table, `${table}.id`, `assets.${fk}`);
    else q.join(table, `${table}.id`, `assets.${fk}`);
    const rows = await q
      .select(`${table}.id as id`, db.raw(`COALESCE(${table}.name, ?) as name`, [label]))
      .count(count)
      .groupBy(`${table}.id`, `${table}.name`)
      .orderBy('n', 'desc');
    return rows.map((r) => ({ id: r.id, name: r.name, n: Number(r.n) }));
  };

  // counts for a fixed list of values, so zero-count values still appear
  const simple = async (col, order) => {
    const rows = await scoped().select(`assets.${col} as key`).count(count).groupBy(`assets.${col}`);
    const map = Object.fromEntries(rows.map((r) => [r.key, Number(r.n)]));
    return order.map((k) => ({ key: k, n: map[k] || 0 }));
  };

  const [
    totals, byStatus, byCondition, byApproval, bySector, byKifle, byCategory, revenue, attention, maintCost, recent,
    byKebele, pendingRequests, pendingReservations, discrepancies, openFollowUps, revenueReceived, openMaintenance, reservable,
  ] = await Promise.all([
    // what the city holds is worth: disposed assets are no longer held (as in Finance, Analytics and Performance)
    scoped().count({ total: 'assets.id' })
      .select(db.raw(`SUM(CASE WHEN assets.status <> 'DISPOSED' THEN assets.acquisition_cost END) AS acquisition,
        SUM(CASE WHEN assets.status <> 'DISPOSED' THEN assets.current_valuation END) AS valuation`))
      .first(),
    simple('status', STATUSES),
    simple('condition', CONDITIONS),
    simple('approval_state', APPROVAL_STATES),
    grouped('sectors', 'sector_id'),
    grouped('kifle_ketemas', 'kifle_ketema_id'),
    grouped('asset_categories', 'category_id'),
    applyFilters(scoped(), { revenue: 'yes' }).count({ n: 'assets.id' }).first(),
    scoped()
      .where((b) => b.whereIn('assets.condition', ['POOR', 'CRITICAL']).orWhereIn('assets.status', ['DAMAGED', 'LOST']))
      .whereNot('assets.status', 'DISPOSED')
      .count({ n: 'assets.id' }).first(),
    applyScope(db('maintenance_records').join('assets', 'assets.id', 'maintenance_records.asset_id'), user)
      .whereNot('maintenance_records.status', 'CANCELLED')
      .sum({ s: 'maintenance_records.cost' }).first(),
    db('audit_logs as l').leftJoin('users as u', 'u.id', 'l.user_id').leftJoin('assets as a', 'a.id', 'l.asset_id')
      .whereIn('l.asset_id', applyScope(db('assets').select('assets.id'), user))
      .whereIn('l.action', money ? [...ACTIVITY, ...MONEY_ACTIVITY] : ACTIVITY)
      .select('l.id', 'l.created_at', 'l.action', 'l.summary', 'l.changes', 'l.asset_id', 'l.username', 'u.full_name', 'u.role', 'a.asset_code', 'a.name as asset_name')
      .orderBy('l.id', 'desc').limit(ACTIVITY_SIZE),
    grouped('kebeles', 'kebele_id', { nullable: true, label: '(no Kebele recorded)' }),
    applyScope(db('approval_requests as r').join('assets', 'assets.id', 'r.asset_id'), user).whereIn('r.status', ['PENDING', 'REVIEWED']).count({ n: 'r.id' }).first(),
    applyScope(db('asset_reservations as r').join('assets', 'assets.id', 'r.asset_id'), user).where('r.status', 'PENDING').count({ n: 'r.id' }).first(),
    applyScope(db('verification_items as i').join('assets', 'assets.id', 'i.asset_id'), user).whereIn('i.discrepancy_status', ['OPEN', 'INVESTIGATING']).count({ n: 'i.id' }).first(),
    applyScope(db('follow_up_actions as f').join('assets', 'assets.id', 'f.asset_id'), user).whereIn('f.status', ['OPEN', 'REPORTED']).count({ n: 'f.id' }).first(),
    money
      ? applyScope(db('asset_revenues as r').join('assets', 'assets.id', 'r.asset_id'), user).sum({ s: 'r.amount' }).first()
      : Promise.resolve({ s: null }),
    applyScope(db('maintenance_records as m').join('assets', 'assets.id', 'm.asset_id'), user).whereIn('m.status', ['PLANNED', 'IN_PROGRESS']).count({ n: 'm.id' }).first(),
    scoped().where('assets.is_reservable', 1).count({ n: 'assets.id' }).first(),
  ]);

  // Latest maintenance record per asset that names a next date; list those due soon or overdue.
  const withNext = await applyScope(
    db('maintenance_records').join('assets', 'assets.id', 'maintenance_records.asset_id'),
    user,
  )
    .whereNotNull('maintenance_records.next_maintenance_date')
    .whereNot('maintenance_records.status', 'CANCELLED')
    .whereNot('assets.status', 'DISPOSED')
    .select(
      'maintenance_records.asset_id', 'maintenance_records.maintenance_date', 'maintenance_records.id',
      'maintenance_records.next_maintenance_date', 'assets.asset_code', 'assets.name',
    );
  const latest = new Map();
  for (const r of withNext) {
    const cur = latest.get(r.asset_id);
    if (!cur || r.maintenance_date > cur.maintenance_date || (r.maintenance_date === cur.maintenance_date && r.id > cur.id)) {
      latest.set(r.asset_id, r);
    }
  }
  const today = new Date().toISOString().slice(0, 10);
  const limit = new Date(Date.now() + DUE_WINDOW_DAYS * 86400000).toISOString().slice(0, 10);
  const maintenance_due = [...latest.values()]
    .filter((r) => r.next_maintenance_date <= limit)
    .map((r) => ({
      asset_id: r.asset_id, asset_code: r.asset_code, name: r.name,
      next_maintenance_date: r.next_maintenance_date, overdue: r.next_maintenance_date < today,
    }))
    .sort((a, b) => a.next_maintenance_date.localeCompare(b.next_maintenance_date));

  const inspection_due = (await nextInspections(user)).filter((date) => date <= limit).length;

  // What is waiting, by kind of request (transfers, disposals ...)
  const pendingByType = await applyScope(db('approval_requests as r').join('assets', 'assets.id', 'r.asset_id'), user)
    .whereIn('r.status', ['PENDING', 'REVIEWED']).select('r.request_type').count({ n: 'r.id' }).groupBy('r.request_type');

  // For an approver: how long the oldest item waiting for approval has waited (a registration verified on site, or
  // approved and not yet activated, from the day it reached that step; a request from the day it was made: as in Performance)
  let oldestApproval = null;
  let oldestRequest = null;
  if (canApprove(user) || canDecideRequests(user)) {
    const [reg, req] = await Promise.all([
      scoped().whereIn('assets.approval_state', ['REVIEWED', 'APPROVED']).min({ oldest: 'assets.approval_state_at' }).first(),
      applyScope(db('approval_requests as r').join('assets', 'assets.id', 'r.asset_id'), user).whereIn('r.status', ['PENDING', 'REVIEWED'])
        .min({ oldest: 'r.requested_at' }).first(),
    ]);
    oldestApproval = days(reg?.oldest);
    oldestRequest = days(req?.oldest);
  }

  // The last 12 months: assets registered and maintenance jobs (with their cost, for those who may see money)
  const months = [];
  const now = new Date();
  for (let i = 11; i >= 0; i -= 1) months.push(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
  const since = `${months[0]}-01`;
  const [regByMonth, maintByMonth] = await Promise.all([
    scoped().where('assets.created_at', '>=', since).select(db.raw("DATE_FORMAT(assets.created_at, '%Y-%m') as month")).count(count).groupBy('month'),
    applyScope(db('maintenance_records as m').join('assets', 'assets.id', 'm.asset_id'), user).whereNot('m.status', 'CANCELLED').where('m.maintenance_date', '>=', since)
      .select(db.raw("DATE_FORMAT(m.maintenance_date, '%Y-%m') as month")).count({ n: 'm.id' }).sum({ cost: 'm.cost' }).groupBy('month'),
  ]);
  const trend = months.map((month) => {
    const r = regByMonth.find((x) => x.month === month);
    const m = maintByMonth.find((x) => x.month === month);
    return { month, registered: Number(r?.n || 0), maintenance_jobs: Number(m?.n || 0), ...(money ? { maintenance_cost: Number(m?.cost || 0) } : {}) };
  });

  // Set-up gaps only the city-wide roles can fix
  let setup = null;
  if (hasAllScope(user)) {
    const without = (role) => db('kifle_ketemas').where({ is_active: 1 })
      .whereNotExists(db('user_kifle_ketemas as uk').join('users as u', 'u.id', 'uk.user_id')
        .whereRaw('uk.kifle_ketema_id = kifle_ketemas.id').where({ 'u.role': role, 'u.is_active': 1 }))
      .count({ n: 'id' }).first();
    const [unlinked, noAdmin, noInspector, noKebeleAdmin] = await Promise.all([
      db('kebeles').where({ is_active: 1 }).whereNull('kifle_ketema_id').count({ n: 'id' }).first(),
      without(ROLES.KIFLE_ADMIN),
      without(ROLES.INSPECTOR), // only Inspectors record inspections: without one, nobody inspects there
      // only the Kebele Administrator verifies new registrations on site: without one, they wait there for ever
      db('kebeles').where({ is_active: 1 }).whereNotNull('kifle_ketema_id')
        .whereNotExists(db('user_kebeles as ub').join('users as u', 'u.id', 'ub.user_id')
          .whereRaw('ub.kebele_id = kebeles.id').where({ 'u.role': ROLES.KEBELE_ADMIN, 'u.is_active': 1 }))
        .count({ n: 'id' }).first(),
    ]);
    setup = {
      kebeles_without_kifle_ketema: Number(unlinked.n), kifle_ketemas_without_admin: Number(noAdmin.n), kifle_ketemas_without_inspector: Number(noInspector.n),
      kebeles_without_admin: Number(noKebeleAdmin.n),
    };
  }

  const total = Number(totals.total);
  const generating = Number(revenue.n);
  const approval = (key) => byApproval.find((a) => a.key === key)?.n ?? 0;
  res.json({
    totals: {
      assets: total,
      active: approval('ACTIVE'),
      pending_approval: approval('SUBMITTED') + approval('REVIEWED'),
      generating_revenue: generating,
      not_generating_revenue: total - generating,
      needs_attention: Number(attention.n),
      acquisition_cost: money ? Number(totals.acquisition || 0) : null,
      current_valuation: money ? Number(totals.valuation || 0) : null,
      maintenance_cost: money ? Number(maintCost.s || 0) : null,
      pending_requests: Number(pendingRequests.n),
      pending_reservations: Number(pendingReservations.n),
      open_discrepancies: Number(discrepancies.n),
      open_follow_ups: Number(openFollowUps.n),
      open_maintenance_jobs: Number(openMaintenance.n),
      reservable_assets: Number(reservable.n),
      revenue_received: revenueReceived.s == null ? null : Number(revenueReceived.s),
      maintenance_overdue: maintenance_due.filter((m) => m.overdue).length,
      maintenance_due_soon: maintenance_due.filter((m) => !m.overdue).length,
      oldest_approval_days: oldestApproval, // registrations waiting for an approver
      oldest_request_days: oldestRequest, // transfers, disposals ... waiting for a decision
      inspection_due,
      pending_by_type: Object.fromEntries(pendingByType.map((r) => [r.request_type, Number(r.n)])),
    },
    setup,
    by_kebele: seesKebeleLevel(user) ? byKebele : [],
    can_see_money: money,
    by_status: byStatus,
    by_condition: byCondition,
    by_approval_state: byApproval,
    by_sector: bySector,
    by_kifle_ketema: byKifle,
    by_category: byCategory,
    maintenance_due,
    maintenance_due_window_days: DUE_WINDOW_DAYS,
    trend,
    recent_activity: recent.map(activityRow),
  });
});

// ---------------------------------------------------------------- what is waiting for this user (side-menu badges)

/** Only the work that is this user's own next step: nothing for roles that merely watch. */
router.get('/queue', async (req, res) => {
  const user = req.user;
  const states = [...(canReview(user) ? ['SUBMITTED'] : []), ...(canApprove(user) ? ['REVIEWED', 'APPROVED'] : [])];
  const none = { n: 0 };
  const [registrations, requests, discrepancies] = await Promise.all([
    states.length
      ? applyScope(db('assets'), user).whereNull('assets.archived_at').whereNot('assets.status', 'DISPOSED').whereIn('assets.approval_state', states).count({ n: 'assets.id' }).first()
      : none,
    canDecideRequests(user)
      ? applyScope(db('approval_requests as r').join('assets', 'assets.id', 'r.asset_id'), user).whereIn('r.status', ['PENDING', 'REVIEWED']).count({ n: 'r.id' }).first()
      : none,
    has(user, 'verification.manage')
      ? applyScope(db('verification_items as i').join('assets', 'assets.id', 'i.asset_id'), user).whereIn('i.discrepancy_status', ['OPEN', 'INVESTIGATING']).count({ n: 'i.id' }).first()
      : none,
  ]);
  res.json({ approvals: Number(registrations.n) + Number(requests.n), verification: Number(discrepancies.n), monthly: await monthlyQueue(user) });
});

// ---------------------------------------------------------------- the Inspectors of an area (supervision)

const RECENT_DAYS = 30;

/**
 * The Inspectors working in the user's Kifle Ketemas and what they have done there, the inspections that are overdue or
 * due soon, and the Kifle Ketemas no Inspector covers (only Inspectors record inspections, so nobody inspects there).
 * For the Kifle Ketema Administrator, who follows the Inspectors of its area.
 */
router.get('/inspectors', require_(permissionCheck('inspection.oversee'), 'Your role cannot follow the Inspectors.'), async (req, res) => {
  const user = req.user;
  const kifle = await db('kifle_ketemas').where({ is_active: 1 }).modify((q) => { if (!hasAllScope(user)) q.whereIn('id', user.scope.kifle); })
    .select('id', 'name').orderBy('name');
  const links = await db('user_kifle_ketemas as uk').join('users as u', 'u.id', 'uk.user_id')
    .where('u.role', ROLES.INSPECTOR).whereIn('uk.kifle_ketema_id', kifle.map((k) => k.id))
    .select('u.id', 'u.username', 'u.full_name', 'u.is_active', 'u.last_login_at', 'uk.kifle_ketema_id');
  const byUser = new Map();
  for (const l of links) {
    const u = byUser.get(l.id) || { ...l, kifle_ketema_ids: [] };
    u.kifle_ketema_ids.push(l.kifle_ketema_id);
    delete u.kifle_ketema_id;
    byUser.set(l.id, u);
  }
  const ids = [...byUser.keys()];
  const since = isoDay(-RECENT_DAYS);
  const [work, dates] = await Promise.all([
    ids.length
      ? applyScope(db('inspection_records as i').join('assets', 'assets.id', 'i.asset_id'), user).whereIn('i.recorded_by', ids)
        .groupBy('i.recorded_by')
        .select('i.recorded_by', db.raw('SUM(CASE WHEN i.inspection_date >= ? THEN 1 ELSE 0 END) as recent', [since]), db.raw("SUM(CASE WHEN i.result = 'FAILED' AND i.inspection_date >= ? THEN 1 ELSE 0 END) as failed", [since]))
        .max({ last: 'i.inspection_date' })
      : [],
    nextInspections(user),
  ]);
  const done = Object.fromEntries(work.map((w) => [w.recorded_by, w]));
  const today = isoDay();
  const limit = isoDay(DUE_WINDOW_DAYS);
  const covered = new Set(links.filter((l) => l.is_active).map((l) => l.kifle_ketema_id));
  res.json({
    recent_days: RECENT_DAYS,
    due_window_days: DUE_WINDOW_DAYS,
    overdue: dates.filter((d) => d < today).length,
    due_soon: dates.filter((d) => d >= today && d <= limit).length,
    uncovered: kifle.filter((k) => !covered.has(k.id)),
    inspectors: [...byUser.values()]
      .map((u) => ({
        ...u, is_active: Boolean(u.is_active),
        inspections_recent: Number(done[u.id]?.recent || 0), failed_recent: Number(done[u.id]?.failed || 0), last_inspection: done[u.id]?.last ?? null,
      }))
      .sort((a, b) => Number(b.is_active) - Number(a.is_active) || a.full_name.localeCompare(b.full_name)),
  });
});

// ---------------------------------------------------------------- performance of each area (accountability)

const days = (ts) => (ts ? Math.max(0, Math.floor((Date.now() - new Date(ts).getTime()) / 86400000)) : null);

/**
 * One row per Kifle Ketema and per Kebele the user can see: how much is registered and active, what is waiting
 * at which level and for how long, and what is at risk. Each area's administrator is named, so leadership can see
 * who is responsible. A registration's waiting time counts from the day it reached its current step (assets.approval_state_at).
 */
router.get('/performance', require_(permissionCheck('analytics.view'), 'Your role cannot see analytics.'), async (req, res) => {
  const user = req.user;
  const money = canViewFinancial(user);
  const live = () => applyScope(db('assets'), user).whereNot('assets.status', 'DISPOSED').whereNull('assets.archived_at');

  async function measure(col) {
    const [main, idle, requests, discrepancies] = await Promise.all([
      live().whereNotNull(`assets.${col}`).select(`assets.${col} as id`).count({ assets: 'assets.id' })
        .select(db.raw(`SUM(assets.approval_state = 'ACTIVE') AS active,
          SUM(assets.approval_state = 'SUBMITTED') AS with_kebele,
          SUM(assets.approval_state IN ('REVIEWED','APPROVED')) AS with_kifle,
          SUM(assets.\`condition\` IN ('POOR','CRITICAL')) AS poor,
          SUM(assets.status = 'LOST') AS lost,
          SUM(assets.current_valuation) AS value,
          MIN(CASE WHEN assets.approval_state IN ('SUBMITTED','REVIEWED','APPROVED') THEN assets.approval_state_at END) AS oldest_registration`))
        .groupBy(`assets.${col}`),
      // active assets with no current use, or only an IDLE use (the same rule as Analytics)
      live().whereNotNull(`assets.${col}`).where('assets.status', 'ACTIVE').where('assets.approval_state', 'ACTIVE')
        .whereRaw(`NOT EXISTS (SELECT 1 FROM utilizations u WHERE u.asset_id = assets.id AND u.use_type <> 'IDLE' AND u.start_date <= CURDATE() AND (u.end_date IS NULL OR u.end_date >= CURDATE()))`)
        .select(`assets.${col} as id`).count({ n: 'assets.id' }).groupBy(`assets.${col}`),
      applyScope(db('approval_requests as r').join('assets', 'assets.id', 'r.asset_id'), user).whereIn('r.status', ['PENDING', 'REVIEWED'])
        .select(`assets.${col} as id`).count({ n: 'r.id' }).min({ oldest: 'r.requested_at' }).groupBy(`assets.${col}`),
      applyScope(db('verification_items as i').join('assets', 'assets.id', 'i.asset_id'), user).whereIn('i.discrepancy_status', ['OPEN', 'INVESTIGATING'])
        .select(`assets.${col} as id`).count({ n: 'i.id' }).groupBy(`assets.${col}`),
    ]);
    const byId = (rows) => new Map(rows.map((r) => [r.id, r]));
    const [m, i, r, d] = [byId(main), byId(idle), byId(requests), byId(discrepancies)];
    return (id) => {
      const a = m.get(id) || {};
      const q = r.get(id) || {};
      const waits = [days(a.oldest_registration), days(q.oldest)].filter((x) => x != null);
      return {
        assets: Number(a.assets || 0),
        active: Number(a.active || 0),
        with_kebele: Number(a.with_kebele || 0),
        with_kifle: Number(a.with_kifle || 0),
        pending_requests: Number(q.n || 0),
        oldest_wait_days: waits.length ? Math.max(...waits) : null,
        poor: Number(a.poor || 0),
        lost: Number(a.lost || 0),
        idle: Number(i.get(id)?.n || 0),
        open_discrepancies: Number(d.get(id)?.n || 0),
        ...(money ? { value: Number(a.value || 0) } : {}),
      };
    };
  }

  // the areas this user answers for, including those with nothing registered yet
  const kifleQ = db('kifle_ketemas').where({ is_active: 1 }).select('id', 'name').orderBy('name');
  const kebeleQ = db('kebeles').where({ 'kebeles.is_active': 1 }).join('kifle_ketemas as k', 'k.id', 'kebeles.kifle_ketema_id')
    .select('kebeles.id', 'kebeles.name', 'kebeles.kifle_ketema_id', 'k.name as kifle_ketema_name').orderBy(['k.name', 'kebeles.name']);
  if (!hasAllScope(user)) {
    const { kifle, kebeles } = user.scope;
    if (user.role !== ROLES.KIFLE_ADMIN && kebeles.length) {
      kebeleQ.whereIn('kebeles.id', kebeles);
      kifleQ.whereIn('id', db('kebeles').whereIn('id', kebeles).select('kifle_ketema_id'));
    } else {
      kifleQ.whereIn('id', kifle);
      kebeleQ.whereIn('kebeles.kifle_ketema_id', kifle);
    }
  }
  const adminsOf = (role, table, col) => db('users').where({ 'users.role': role, 'users.is_active': 1 })
    .join(`${table} as x`, 'x.user_id', 'users.id').select(`x.${col} as area_id`, 'users.full_name', 'users.username', 'users.last_login_at').orderBy('users.id');

  const [kifleList, kebeleList, kifleAdmins, kebeleAdmins, perKifle, perKebele] = await Promise.all([
    kifleQ, kebeleQ,
    adminsOf(ROLES.KIFLE_ADMIN, 'user_kifle_ketemas', 'kifle_ketema_id'),
    adminsOf(ROLES.KEBELE_ADMIN, 'user_kebeles', 'kebele_id'),
    measure('kifle_ketema_id'), measure('kebele_id'),
  ]);
  // an area has one administrator; accounts made before that rule (or by hand) can leave two active, and both are shown
  const holders = (rows, id) => rows.filter((x) => x.area_id === id)
    .map((a) => ({ full_name: a.full_name, username: a.username, last_login_at: a.last_login_at }));
  const adminOf = (rows, id) => holders(rows, id)[0] ?? null;
  const people = (rows, id) => ({ admin: adminOf(rows, id), admins: holders(rows, id) });
  const kebelesOf = (kid) => kebeleList.filter((b) => b.kifle_ketema_id === kid);
  res.json({
    can_see_money: money,
    kebele_level: seesKebeleLevel(user),
    kifle_ketemas: kifleList.map((k) => ({
      id: k.id, name: k.name, ...people(kifleAdmins, k.id), ...perKifle(k.id),
      kebeles: kebelesOf(k.id).length,
      kebeles_without_admin: kebelesOf(k.id).filter((b) => !adminOf(kebeleAdmins, b.id)).length,
    })),
    kebeles: !seesKebeleLevel(user) ? [] : kebeleList.map((b) => ({
      id: b.id, name: b.name, kifle_ketema_id: b.kifle_ketema_id, kifle_ketema_name: b.kifle_ketema_name,
      ...people(kebeleAdmins, b.id), ...perKebele(b.id),
    })),
  });
});

export default router;
