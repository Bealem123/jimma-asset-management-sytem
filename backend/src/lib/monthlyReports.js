// Monthly reports up the chain of responsibility. Everyone except the Mayor has a boss who receives their report:
//   Sector Administrator                                   -> Kebele Administrator of its Kebele
//   Kebele Administrator, Financial Officer, Inspector     -> Kifle Ketema Administrator of their Kifle Ketema
//   Kifle Ketema Administrator, Internal Auditor           -> Mayor / Executive
// The Super Administrator sees every report but decides none (it runs the system, it is nobody's boss).
// Months follow the calendar chosen in System -> Settings (Ethiopian by default); each level has its own deadline,
// so the reports flow upwards: day 5, day 10 and day 15 after the month ends.
import { db } from '../db.js';
import { ROLES } from './constants.js';
import { applyScope, has } from './permissions.js';
import { nextInspections } from './inspections.js';
import { getRule, notify } from './notify.js';
import { addDays, endedPeriods, periodName, todayIso } from './calendar.js';

export const REPORTS_TO = {
  [ROLES.SECTOR_ADMIN]: { to: ROLES.KEBELE_ADMIN, days: 5 },
  [ROLES.KEBELE_ADMIN]: { to: ROLES.KIFLE_ADMIN, days: 10 },
  [ROLES.FINANCIAL_OFFICER]: { to: ROLES.KIFLE_ADMIN, days: 10 },
  [ROLES.INSPECTOR]: { to: ROLES.KIFLE_ADMIN, days: 10 },
  [ROLES.KIFLE_ADMIN]: { to: ROLES.EXECUTIVE, days: 15 },
  [ROLES.AUDITOR]: { to: ROLES.EXECUTIVE, days: 15 },
};
/** Roles that receive monthly reports and accept or return them. */
export const RECEIVER_ROLES = [ROLES.KEBELE_ADMIN, ROLES.KIFLE_ADMIN, ROLES.EXECUTIVE];
const ROLE_ORDER = [ROLES.KIFLE_ADMIN, ROLES.AUDITOR, ROLES.KEBELE_ADMIN, ROLES.FINANCIAL_OFFICER, ROLES.INSPECTOR, ROLES.SECTOR_ADMIN];
const USER_COLS = ['id', 'username', 'full_name', 'role', 'is_active'];
export const MONTHLY_LINK = '/monthly-reports';

export const deadlineOf = (period, role) => addDays(period.end, REPORTS_TO[role]?.days ?? 0);

/** ET (Ethiopian, the default) or GC (Gregorian): which months the reports follow. */
export async function reportCalendar() {
  const row = await db('system_settings').where({ key: 'report_calendar' }).first();
  return row?.value === 'GC' ? 'GC' : 'ET';
}

/** A report's frozen figures (MySQL returns a JSON column parsed, MariaDB as text). */
export const parseSnapshot = (s) => (typeof s === 'string' ? JSON.parse(s) : s);

// ---------------------------------------------------------------------------------------------- who reports to whom

const group = (rows, key) => rows.reduce((m, r) => ((m[r.user_id] ||= []).push(r[key]), m), {});
const overlap = (a, b) => a.some((x) => b.includes(x));

/** Users with their assigned areas. */
export async function withScopes(users) {
  const ids = users.map((u) => u.id);
  if (!ids.length) return [];
  const [kifle, kebeles, sectors] = await Promise.all([
    db('user_kifle_ketemas').whereIn('user_id', ids), db('user_kebeles').whereIn('user_id', ids), db('user_sectors').whereIn('user_id', ids),
  ]);
  const gk = group(kifle, 'kifle_ketema_id');
  const gb = group(kebeles, 'kebele_id');
  const gs = group(sectors, 'sector_id');
  return users.map((u) => ({ ...u, scope: { kifle: gk[u.id] || [], kebeles: gb[u.id] || [], sectors: gs[u.id] || [] } }));
}

/** Every active person in the chain, with their areas, and the names of the areas. */
export async function loadPeople() {
  const [users, kebeles, sectors, kifle] = await Promise.all([
    db('users').where({ is_active: true }).whereIn('role', [...Object.keys(REPORTS_TO), ROLES.EXECUTIVE]).select(USER_COLS),
    db('kebeles').select('id', 'name', 'kifle_ketema_id'), db('sectors').select('id', 'name'), db('kifle_ketemas').select('id', 'name'),
  ]);
  return { users: await withScopes(users), kebeles, sectors, kifle };
}

/** The active people a reporter's monthly report goes to. */
export function reviewersOf(people, reporter) {
  const of = (role) => people.users.filter((u) => u.role === role);
  const { scope } = reporter;
  switch (reporter.role) {
    case ROLES.SECTOR_ADMIN:
      return of(ROLES.KEBELE_ADMIN).filter((u) => overlap(u.scope.kebeles, scope.kebeles));
    case ROLES.KEBELE_ADMIN: {
      const kifle = people.kebeles.filter((k) => scope.kebeles.includes(k.id)).map((k) => k.kifle_ketema_id).filter(Boolean);
      return of(ROLES.KIFLE_ADMIN).filter((u) => overlap(u.scope.kifle, kifle));
    }
    case ROLES.FINANCIAL_OFFICER:
    case ROLES.INSPECTOR:
      return of(ROLES.KIFLE_ADMIN).filter((u) => overlap(u.scope.kifle, scope.kifle));
    case ROLES.KIFLE_ADMIN:
    case ROLES.AUDITOR:
      return of(ROLES.EXECUTIVE);
    default:
      return [];
  }
}

/** The people whose monthly reports come to `boss` (for the Super Administrator: everybody's, to follow). */
export function teamOf(people, boss) {
  const reporters = people.users.filter((u) => REPORTS_TO[u.role] && u.id !== boss.id);
  if (boss.role === ROLES.SUPER_ADMIN) return reporters;
  return reporters.filter((r) => reviewersOf(people, r).some((b) => b.id === boss.id));
}

/** The area a person answers for, as names (translated on screen). */
export function areaOf(people, u) {
  if ([ROLES.AUDITOR, ROLES.EXECUTIVE, ROLES.SUPER_ADMIN].includes(u.role)) return { city: true, kifle: [], kebeles: [], sectors: [] };
  const names = (list, ids) => ids.map((id) => list.find((x) => x.id === id)?.name).filter(Boolean);
  return { city: false, kifle: names(people.kifle, u.scope.kifle), kebeles: names(people.kebeles, u.scope.kebeles), sectors: names(people.sectors, u.scope.sectors) };
}
const areaText = (a) => (a.city ? 'Whole city' : [...a.sectors, ...a.kebeles, ...a.kifle].join(' · '));

export const sortTeam = (members) => members.sort((a, b) => ROLE_ORDER.indexOf(a.user.role) - ROLE_ORDER.indexOf(b.user.role)
  || areaText(a.area).localeCompare(areaText(b.area)) || a.user.full_name.localeCompare(b.user.full_name));

/** Where a report stands: NOT_SUBMITTED, SUBMITTED, RETURNED or ACCEPTED; late while it is owed after the deadline. */
export function statusOf(row, deadline, today) {
  const owed = !row || row.status === 'RETURNED';
  return {
    status: row ? row.status : 'NOT_SUBMITTED',
    late: owed && today > deadline,
    sent_late: row ? String(row.submitted_at).slice(0, 10) > deadline : false,
  };
}

export async function reportRows(periodKeys, userIds) {
  if (!periodKeys.length || !userIds.length) return [];
  return db('monthly_reports').whereIn('period_key', periodKeys).whereIn('user_id', userIds)
    .select('id', 'period_key', 'user_id', 'role', 'status', 'version', 'comment', 'submitted_at', 'decided_at', 'decision_note');
}

// ---------------------------------------------------------------------------------------------- the report's figures

const row = (label, value, kind = 'number') => ({ label, value, kind });

/**
 * The figures of `user`'s area for `period`, generated by the system: where the assets stand on the day the report is
 * sent, what happened during the month, the money (for those who may see it), and what belongs to the role
 * (an Inspector's own inspections, the Auditor's view of the audit trail, a boss's view of the team's reports).
 */
export async function buildSnapshot(user, period, people) {
  const within = [period.start, period.end];
  const until = addDays(period.end, 1); // timestamps: from the first day up to (not including) the day after the last
  const live = () => applyScope(db('assets'), user).whereNull('assets.archived_at').whereNot('assets.status', 'DISPOSED');
  const joined = (table, alias) => applyScope(db(`${table} as ${alias}`).join('assets', 'assets.id', `${alias}.asset_id`), user);
  const n = async (q, col = 'assets.id') => Number((await q.count({ n: col }).first()).n);
  const sum = async (q, col) => Number((await q.sum({ s: col }).first()).s || 0);
  const today = todayIso();

  const [total, active, waiting, drafts, maintenance, damaged, lost, poor, followUps, discrepancies, nextDates] = await Promise.all([
    n(live()),
    n(live().where('assets.approval_state', 'ACTIVE')),
    n(live().whereIn('assets.approval_state', ['SUBMITTED', 'REVIEWED', 'APPROVED'])),
    n(live().where('assets.approval_state', 'DRAFT')),
    n(live().where('assets.status', 'UNDER_MAINTENANCE')),
    n(live().where('assets.status', 'DAMAGED')),
    n(live().where('assets.status', 'LOST')),
    n(live().whereIn('assets.condition', ['POOR', 'CRITICAL'])),
    n(joined('follow_up_actions', 'f').whereIn('f.status', ['OPEN', 'REPORTED']), 'f.id'),
    n(joined('verification_items', 'v').whereIn('v.discrepancy_status', ['OPEN', 'INVESTIGATING']), 'v.id'),
    nextInspections(user),
  ]);
  const [registered, transfers, disposals, jobs, inspections, failed] = await Promise.all([
    n(applyScope(db('assets'), user).where('assets.created_at', '>=', period.start).where('assets.created_at', '<', until)),
    n(joined('asset_transfers', 't').whereBetween('t.transfer_date', within), 't.id'),
    n(joined('asset_disposals', 'd').whereBetween('d.disposal_date', within), 'd.id'),
    n(joined('maintenance_records', 'm').whereNot('m.status', 'CANCELLED').whereBetween('m.maintenance_date', within), 'm.id'),
    n(joined('inspection_records', 'i').whereBetween('i.inspection_date', within), 'i.id'),
    n(joined('inspection_records', 'i').where('i.result', 'FAILED').whereBetween('i.inspection_date', within), 'i.id'),
  ]);

  const sections = [
    {
      title: 'Position of the assets', note: 'On the day the report was sent.',
      rows: [
        row('Assets in the register', total), row('Approved and active', active), row('Waiting for verification or approval', waiting),
        row('Drafts and returned registrations', drafts), row('Under maintenance', maintenance), row('Damaged', damaged), row('Missing / lost', lost),
        row('In poor or critical condition', poor), row('Open follow-up actions', followUps), row('Open verification discrepancies', discrepancies),
        row('Inspections overdue', nextDates.filter((d) => d < today).length),
      ],
    },
    {
      title: 'During the month',
      rows: [
        row('Assets registered', registered), row('Transfers', transfers), row('Retirements and disposals', disposals),
        row('Maintenance jobs', jobs), row('Inspections', inspections), row('Failed inspections', failed),
      ],
    },
  ];

  if (has(user, 'financial.view')) {
    const [acquisition, valuation, spent, revenue, valuations] = await Promise.all([
      sum(live(), 'assets.acquisition_cost'),
      sum(live(), 'assets.current_valuation'),
      sum(joined('maintenance_records', 'm').whereNot('m.status', 'CANCELLED').whereBetween('m.maintenance_date', within), 'm.cost'),
      sum(joined('asset_revenues', 'r').whereBetween('r.received_date', within), 'r.amount'),
      n(joined('asset_valuations', 'av').whereBetween('av.valuation_date', within), 'av.id'),
    ]);
    sections.push({
      title: 'Money',
      rows: [
        row('Acquisition cost of the assets', acquisition, 'money'), row('Current valuation of the assets', valuation, 'money'),
        row('Maintenance spending during the month', spent, 'money'), row('Revenue received during the month', revenue, 'money'),
        row('Valuations recorded during the month', valuations),
      ],
    });
  }

  if (user.role === ROLES.INSPECTOR) {
    const mine = () => joined('inspection_records', 'i').where('i.recorded_by', user.id).whereBetween('i.inspection_date', within);
    const [count, failedMine, assets] = await Promise.all([
      n(mine(), 'i.id'), n(mine().where('i.result', 'FAILED'), 'i.id'),
      mine().countDistinct({ n: 'i.asset_id' }).first().then((r) => Number(r.n)),
    ]);
    sections.push({ title: 'Your inspections', rows: [row('Inspections you recorded', count), row('Of them failed', failedMine), row('Assets you inspected', assets)] });
  }

  if (user.role === ROLES.AUDITOR) {
    const actions = await db('audit_logs').where('created_at', '>=', period.start).where('created_at', '<', until)
      .select('action').count({ n: 'id' }).groupBy('action').orderBy('n', 'desc').limit(15);
    sections.push({ title: 'Recorded in the audit trail', note: 'The most frequent actions during the month, across the whole city.', rows: actions.map((a) => row(a.action, Number(a.n), 'action')) });
  }

  const team = teamOf(people, user);
  if (team.length) {
    const rows = await reportRows([period.key], team.map((u) => u.id));
    const status = (u) => rows.find((r) => r.user_id === u.id)?.status;
    const missing = team.filter((u) => !['SUBMITTED', 'ACCEPTED'].includes(status(u)));
    const teamRows = [
      row('Reports expected', team.length), row('Sent', team.length - missing.length),
      row('Accepted', team.filter((u) => status(u) === 'ACCEPTED').length), row('Returned for correction', team.filter((u) => status(u) === 'RETURNED').length),
      row('Not sent', missing.length),
    ];
    if (missing.length) teamRows.push(row('Not sent by', missing.map((u) => `${u.full_name} (${areaText(areaOf(people, u))})`).join('; '), 'text'));
    if (user.role === ROLES.KIFLE_ADMIN) {
      // the Sector Administrators report to the Kebele Administrators: their numbers, rolled up for the Kifle Ketema
      const myKebeles = people.kebeles.filter((k) => user.scope.kifle.includes(k.kifle_ketema_id)).map((k) => k.id);
      const sectors = people.users.filter((u) => u.role === ROLES.SECTOR_ADMIN && overlap(u.scope.kebeles, myKebeles));
      const sent = (await reportRows([period.key], sectors.map((u) => u.id))).filter((r) => ['SUBMITTED', 'ACCEPTED'].includes(r.status)).length;
      teamRows.push(row('Sector reports expected in your Kebeles', sectors.length), row('Sector reports sent', sent));
    }
    sections.push({ title: 'Reports from your team', rows: teamRows });
  }

  return { generated_at: new Date().toISOString(), period: { key: period.key, start: period.start, end: period.end }, role: user.role, area: areaOf(people, user), sections };
}

// ---------------------------------------------------------------------------------------------- reminders and badges

/**
 * Reminds people whose report for the month that just ended is due soon, and once the deadline has passed tells both
 * them and their boss. Run by the hourly alert scan; dedupe keys make sure nobody is told the same thing twice.
 */
export async function remindMonthlyReports(now = new Date()) {
  const created = {};
  const add = (type, n) => { created[type] = (created[type] || 0) + n; };
  const today = todayIso(now);
  const [period] = endedPeriods(today, await reportCalendar(), 1);
  const name = periodName(period);
  const people = await loadPeople();
  const reporters = people.users.filter((u) => REPORTS_TO[u.role]);
  const rows = await reportRows([period.key], reporters.map((u) => u.id));
  const lead = (await getRule('MONTHLY_REPORT_DUE')).lead_days ?? 3;
  for (const r of reporters) {
    const report = rows.find((x) => x.user_id === r.id);
    if (report && report.status !== 'RETURNED') continue;
    const deadline = deadlineOf(period, r.role);
    if (today > deadline) {
      add('MONTHLY_REPORT_LATE', await notify({
        type: 'MONTHLY_REPORT_LATE', userIds: [r.id], link: `${MONTHLY_LINK}/prepare/${period.key}`, dedupeKey: `MR:${period.key}:LATE`,
        title: `Your monthly report for ${name} is late: it was due on ${deadline}`,
      }));
      add('MONTHLY_REPORT_LATE', await notify({
        type: 'MONTHLY_REPORT_LATE', userIds: reviewersOf(people, r).map((u) => u.id), link: `${MONTHLY_LINK}?period=${period.key}`,
        dedupeKey: `MR:${period.key}:LATE:${r.id}`, title: `${r.full_name} has not sent the monthly report for ${name}: it was due on ${deadline}`,
      }));
    } else if (today >= addDays(deadline, -lead)) {
      add('MONTHLY_REPORT_DUE', await notify({
        type: 'MONTHLY_REPORT_DUE', userIds: [r.id], link: `${MONTHLY_LINK}/prepare/${period.key}`, dedupeKey: `MR:${period.key}:DUE`,
        title: `Your monthly report for ${name} is due on ${deadline}`,
      }));
    }
  }
  return created;
}

/**
 * Where this user stands, for the banner on their dashboard: their own report for the month that just ended while it
 * is still owed (from the first day after the month, with its deadline), and the reports waiting for their decision.
 */
export async function monthlyReminder(user, now = new Date()) {
  const today = todayIso(now);
  let own = null;
  if (REPORTS_TO[user.role]) {
    const [period] = endedPeriods(today, await reportCalendar(), 1);
    const [mine] = await reportRows([period.key], [user.id]);
    if (!mine || mine.status === 'RETURNED') {
      const deadline = deadlineOf(period, user.role);
      const lead = (await getRule('MONTHLY_REPORT_DUE')).lead_days ?? 3; // the same warning time as the reminders
      own = { period, deadline, returned: Boolean(mine), late: today > deadline, due_soon: today >= addDays(deadline, -lead) };
    }
  }
  let waiting = 0;
  if (RECEIVER_ROLES.includes(user.role)) {
    const ids = teamOf(await loadPeople(), user).map((u) => u.id);
    if (ids.length) waiting = Number((await db('monthly_reports').whereIn('user_id', ids).where('status', 'SUBMITTED').count({ n: 'id' }).first()).n);
  }
  return { own, waiting };
}

/** For the side-menu badge: reports waiting for this user's decision, plus their own report if it is still owed. */
export async function monthlyQueue(user) {
  const { own, waiting } = await monthlyReminder(user);
  return waiting + (own ? 1 : 0);
}
