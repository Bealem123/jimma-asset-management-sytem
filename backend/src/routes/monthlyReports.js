import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { HttpError, conflict, forbidden, notFound, parse } from '../middleware/errors.js';
import { logAudit } from '../lib/audit.js';
import { notify } from '../lib/notify.js';
import { ROLES } from '../lib/constants.js';
import { optStr, reqStr } from '../lib/schemas.js';
import { addDays, endedPeriods, periodByKey, periodName, todayIso } from '../lib/calendar.js';
import {
  MONTHLY_LINK, RECEIVER_ROLES, REPORTS_TO, areaOf, buildSnapshot, deadlineOf, loadPeople, monthlyReminder, parseSnapshot, reportCalendar, reportRows,
  reviewersOf, sortTeam, statusOf, teamOf, withScopes,
} from '../lib/monthlyReports.js';

// Monthly reports up the chain of responsibility (see lib/monthlyReports.js for who reports to whom).
const router = Router();
router.use(authenticate);

const HISTORY = 6; // months listed
const SENT = ['SUBMITTED', 'ACCEPTED'];

const summary = (r) => r && {
  id: r.id, status: r.status, version: r.version, comment: r.comment, submitted_at: r.submitted_at, decided_at: r.decided_at, decision_note: r.decision_note,
};
const person = (u) => ({ id: u.id, username: u.username, full_name: u.full_name, role: u.role });
/** What the Super Administrator may know of a report: where it stands, never what it says (no comment, no decision note). */
const statusOnly = (r) => r && { status: r.status, version: r.version, submitted_at: r.submitted_at, decided_at: r.decided_at };

/** The period this user may report on now: a role that sends reports, a valid month, and one that has ended. */
function reportable(req) {
  if (!REPORTS_TO[req.user.role]) throw forbidden('Your role does not send monthly reports.');
  const period = periodByKey(req.params.periodKey);
  if (!period) throw notFound('Unknown reporting period.');
  if (period.end >= todayIso()) throw conflict(`This month has not ended yet: its report can be sent from ${addDays(period.end, 1)}.`);
  return period;
}

// ---------------------------------------------------------------- the user's own reports

/** For the banner on every dashboard: this user's report while it is owed, and the reports waiting for their decision. */
router.get('/reminder', async (req, res) => res.json(await monthlyReminder(req.user)));

router.get('/', async (req, res) => {
  const calendar = await reportCalendar();
  const today = todayIso();
  const periods = endedPeriods(today, calendar, HISTORY);
  const rule = REPORTS_TO[req.user.role];
  let mine = [];
  let reviewers = [];
  if (rule) {
    const rows = await reportRows(periods.map((p) => p.key), [req.user.id]);
    mine = periods.map((p) => {
      const r = rows.find((x) => x.period_key === p.key);
      const deadline = deadlineOf(p, req.user.role);
      return { period: p, deadline, ...statusOf(r, deadline, today), report: summary(r) };
    });
    reviewers = reviewersOf(await loadPeople(), req.user).map(person);
  }
  res.json({
    calendar, today, sends: Boolean(rule), sends_to: rule?.to ?? null, deadline_days: rule?.days ?? null, reviewers, periods: mine,
    receives: RECEIVER_ROLES.includes(req.user.role) || req.user.role === ROLES.SUPER_ADMIN,
  });
});

/** The figures the report would carry if it were sent now. */
router.get('/preview/:periodKey', async (req, res) => {
  const period = reportable(req);
  res.json(await buildSnapshot(req.user, period, await loadPeople()));
});

router.post('/:periodKey/submit', async (req, res) => {
  const period = reportable(req);
  const { comment } = parse(z.object({ comment: optStr(4000) }), req.body);
  const existing = await db('monthly_reports').where({ period_key: period.key, user_id: req.user.id }).first();
  if (existing?.status === 'SUBMITTED') throw conflict('This report has already been sent and is waiting for a decision.');
  if (existing?.status === 'ACCEPTED') throw conflict('This report has been accepted and is locked.');
  const people = await loadPeople();
  // a boss may send before the whole team has, but must say why some reports are missing
  const team = teamOf(people, req.user);
  if (team.length) {
    const sent = (await reportRows([period.key], team.map((u) => u.id))).filter((r) => SENT.includes(r.status)).map((r) => r.user_id);
    if (team.some((u) => !sent.includes(u.id)) && (comment || '').length < 10) {
      throw new HttpError(400, 'Please correct the highlighted fields.', { comment: 'Some reports from your team have not been sent yet: explain why (at least 10 characters).' });
    }
  }
  const snapshot = JSON.stringify(await buildSnapshot(req.user, period, people));
  const version = existing ? existing.version + 1 : 1;
  const id = await db.transaction(async (trx) => {
    let reportId = existing?.id;
    if (existing) {
      await trx('monthly_reports').where({ id: existing.id }).update({
        status: 'SUBMITTED', role: req.user.role, snapshot, comment, version, submitted_at: db.fn.now(), decided_by: null, decided_at: null, decision_note: null,
      });
    } else {
      [reportId] = await trx('monthly_reports').insert({
        period_key: period.key, period_start: period.start, period_end: period.end, user_id: req.user.id, role: req.user.role, status: 'SUBMITTED', snapshot, comment,
      });
    }
    await logAudit(trx, req.user, {
      action: 'MONTHLY_REPORT_SUBMIT', entity: 'monthly_report', entityId: reportId,
      summary: `Monthly report for ${periodName(period)} sent${version > 1 ? ` again (version ${version})` : ''}`,
    });
    return reportId;
  });
  await notify({
    type: 'MONTHLY_REPORT_SUBMITTED', userIds: reviewersOf(people, req.user).map((u) => u.id), link: `${MONTHLY_LINK}/report/${id}`,
    dedupeKey: `MR:${period.key}:SENT:${req.user.id}:${version}`, title: `${req.user.full_name} sent the monthly report for ${periodName(period)}`,
  });
  res.status(201).json(await reportPayload(req, id));
});

// ---------------------------------------------------------------- the reports that come to the user

router.get('/team', async (req, res) => {
  if (!RECEIVER_ROLES.includes(req.user.role) && req.user.role !== ROLES.SUPER_ADMIN) throw forbidden('Nobody sends monthly reports to your role.');
  const calendar = await reportCalendar();
  const today = todayIso();
  const periods = endedPeriods(today, calendar, HISTORY);
  const period = req.query.period ? periodByKey(req.query.period) : periods[0];
  if (!period) throw notFound('Unknown reporting period.');
  const people = await loadPeople();
  const team = teamOf(people, req.user);
  const rows = await reportRows([period.key], team.map((u) => u.id));
  const decides = req.user.role !== ROLES.SUPER_ADMIN; // the Super Administrator follows, it does not decide
  const members = sortTeam(team.map((u) => {
    const r = rows.find((x) => x.user_id === u.id);
    const deadline = deadlineOf(period, u.role);
    // what a level reports stays between the sender and its boss: the Super Administrator follows the status only
    return { user: person(u), area: areaOf(people, u), deadline, ...statusOf(r, deadline, today), report: decides ? summary(r) : statusOnly(r), can_decide: decides && r?.status === 'SUBMITTED' };
  }));
  res.json({ calendar, today, period, periods, members, decides });
});

// ---------------------------------------------------------------- one report

/** A report, only for the person who sent it and the person it is sent to (not even the Super Administrator). */
async function loadVisible(req, id = req.params.id) {
  const report = await db('monthly_reports').where({ id }).first();
  if (!report) throw notFound('Report not found.');
  const [reporter] = await withScopes(await db('users').where({ id: report.user_id }).select('id', 'username', 'full_name', 'role', 'is_active'));
  const people = await loadPeople();
  const isReviewer = reviewersOf(people, { ...reporter, role: report.role }).some((u) => u.id === req.user.id);
  if (report.user_id !== req.user.id && !isReviewer) throw notFound('Report not found.');
  return { report, reporter, people, isReviewer };
}

async function reportPayload(req, id) {
  const { report, reporter, people, isReviewer } = await loadVisible(req, id);
  const period = periodByKey(report.period_key);
  const deadline = deadlineOf(period, report.role);
  const decider = report.decided_by ? await db('users').where({ id: report.decided_by }).first('full_name', 'role') : null;
  return {
    ...summary(report), period, deadline, ...statusOf(report, deadline, todayIso()),
    reporter: person({ ...reporter, role: report.role }), area: areaOf(people, reporter),
    decided_by: decider, snapshot: parseSnapshot(report.snapshot), can_decide: isReviewer && report.status === 'SUBMITTED',
    can_resend: report.user_id === req.user.id && report.status === 'RETURNED', // its sender corrects it and sends it again
  };
}

router.get('/report/:id', async (req, res) => {
  res.json(await reportPayload(req));
});

async function decide(req, res, accept) {
  const { report, isReviewer } = await loadVisible(req);
  if (!isReviewer) throw forbidden('Only the person this report is sent to can accept it or return it.');
  if (report.status !== 'SUBMITTED') throw conflict('This report is not waiting for a decision.');
  const { note } = parse(z.object({ note: accept ? optStr(1000) : reqStr(1000, 'The reason') }), req.body);
  const status = accept ? 'ACCEPTED' : 'RETURNED';
  const period = periodByKey(report.period_key);
  await db.transaction(async (trx) => {
    await trx('monthly_reports').where({ id: report.id }).update({ status, decided_by: req.user.id, decided_at: db.fn.now(), decision_note: note });
    await logAudit(trx, req.user, {
      action: accept ? 'MONTHLY_REPORT_ACCEPT' : 'MONTHLY_REPORT_RETURN', entity: 'monthly_report', entityId: report.id,
      summary: `Monthly report for ${periodName(period)} ${accept ? 'accepted' : 'returned for correction'}${note ? `: ${note}` : ''}`,
    });
  });
  await notify({
    type: accept ? 'MONTHLY_REPORT_ACCEPTED' : 'MONTHLY_REPORT_RETURNED', userIds: [report.user_id],
    link: accept ? `${MONTHLY_LINK}/report/${report.id}` : `${MONTHLY_LINK}/prepare/${report.period_key}`, // a returned report is corrected
    dedupeKey: `MR:${report.period_key}:${status}:${report.version}`,
    title: accept ? `Your monthly report for ${periodName(period)} was accepted` : `Your monthly report for ${periodName(period)} was returned for correction`,
    body: note || null,
  });
  res.json(await reportPayload(req));
}

router.post('/report/:id/accept', (req, res) => decide(req, res, true));
router.post('/report/:id/return', (req, res) => decide(req, res, false));

export default router;
