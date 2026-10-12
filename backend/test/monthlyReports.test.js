import './env.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { api, byName, closeDb, makeUser, resetDb } from './helpers.js';
import { db } from '../src/db.js';
import {
  addDays, endedPeriods, fromEthiopian, isoToJdn, jdnToEthiopian, ethiopianToJdn, periodByKey, periodOf, toEthiopian, todayIso,
} from '../src/lib/calendar.js';
import { remindMonthlyReports } from '../src/lib/monthlyReports.js';

after(closeDb);

describe('Ethiopian and Gregorian calendars', () => {
  it('converts known dates', () => {
    assert.deepEqual(toEthiopian('2024-09-11'), { year: 2017, month: 1, day: 1 }); // Enkutatash 2017
    assert.deepEqual(toEthiopian('2023-09-12'), { year: 2016, month: 1, day: 1 }); // a year that starts on 12 September
    assert.deepEqual(toEthiopian('2023-09-11'), { year: 2015, month: 13, day: 6 }); // Pagume 6 of a leap year
    assert.deepEqual(toEthiopian('2027-01-07'), { year: 2019, month: 4, day: 29 }); // Genna: Tahsas 29
    assert.equal(fromEthiopian(2019, 2, 1), '2026-10-11');
  });

  it('converts every day both ways', () => {
    for (let j = isoToJdn('2000-01-01'); j < isoToJdn('2040-01-01'); j += 1) {
      const e = jdnToEthiopian(j);
      assert.equal(ethiopianToJdn(e.year, e.month, e.day), j);
    }
  });

  it('builds monthly periods; Pagume belongs to the report of Nehase', () => {
    assert.deepEqual(periodOf('2026-10-11', 'ET'), { key: 'ET-2019-02', calendar: 'ET', year: 2019, month: 2, start: '2026-10-11', end: '2026-11-09' });
    const nehase = periodOf('2026-09-08', 'ET'); // Pagume 3, 2018
    assert.deepEqual([nehase.key, nehase.start, nehase.end], ['ET-2018-12', '2026-08-07', '2026-09-10']);
    assert.deepEqual(periodOf('2026-02-14', 'GC'), { key: 'GC-2026-02', calendar: 'GC', year: 2026, month: 2, start: '2026-02-01', end: '2026-02-28' });
    assert.deepEqual(endedPeriods('2026-10-11', 'ET', 2).map((p) => p.key), ['ET-2019-01', 'ET-2018-12']);
    assert.deepEqual(endedPeriods('2026-10-11', 'GC', 2).map((p) => p.key), ['GC-2026-09', 'GC-2026-08']);
    assert.equal(periodByKey('ET-2019-13'), null);
    assert.equal(periodByKey('nonsense'), null);
  });
});

describe('monthly reports up the chain of responsibility', () => {
  const u = {};
  let period; let sector; let asset;
  const mine = async (who) => (await api('get', '/api/monthly-reports', who).expect(200)).body;
  const team = async (who, key = period.key) => (await api('get', `/api/monthly-reports/team?period=${key}`, who).expect(200)).body;
  const submit = (who, body = {}, key = period.key) => api('post', `/api/monthly-reports/${key}/submit`, who).send(body);
  const titles = async (who) => (await api('get', '/api/notifications?limit=200', who).expect(200)).body.map((n) => n.title);
  const section = (snapshot, title) => snapshot.sections.find((s) => s.title === title);
  const value = (snapshot, title, label) => section(snapshot, title)?.rows.find((r) => r.label === label)?.value;

  before(async () => {
    await resetDb();
    const jiren = await byName('kifle_ketemas', 'Jiren');
    const hirmata = await byName('kifle_ketemas', 'Hirmata');
    const [k1] = await db('kebeles').insert({ name: 'Jiren Kebele A', kifle_ketema_id: jiren.id });
    const [k2] = await db('kebeles').insert({ name: 'Jiren Kebele B', kifle_ketema_id: jiren.id });
    const [k3] = await db('kebeles').insert({ name: 'Hirmata Kebele C', kifle_ketema_id: hirmata.id });
    sector = await db('sectors').where({ code: 'CON' }).first();
    const trade = await db('sectors').where({ code: 'BUS' }).first();
    Object.assign(u, {
      super: await makeUser('super', 'SUPER_ADMIN'),
      mayor: await makeUser('mayor', 'EXECUTIVE'),
      auditor: await makeUser('auditor', 'AUDITOR'),
      kj: await makeUser('kifle.jiren', 'KIFLE_ADMIN', { kifle: [jiren.id] }),
      kh: await makeUser('kifle.hirmata', 'KIFLE_ADMIN', { kifle: [hirmata.id] }),
      finance: await makeUser('finance.jiren', 'FINANCIAL_OFFICER', { kifle: [jiren.id] }),
      inspector: await makeUser('inspector.jiren', 'INSPECTOR', { kifle: [jiren.id] }),
      kb1: await makeUser('kebele.a', 'KEBELE_ADMIN', { kebeles: [k1] }),
      kb2: await makeUser('kebele.b', 'KEBELE_ADMIN', { kebeles: [k2] }),
      kb3: await makeUser('kebele.c', 'KEBELE_ADMIN', { kebeles: [k3] }),
      sa1: await makeUser('sector.con.a', 'SECTOR_ADMIN', { sectors: [sector.id], kebeles: [k1] }),
      sa2: await makeUser('sector.bus.a', 'SECTOR_ADMIN', { sectors: [trade.id], kebeles: [k1] }),
      sa3: await makeUser('sector.con.c', 'SECTOR_ADMIN', { sectors: [sector.id], kebeles: [k3] }),
    });
    const cat = await db('asset_categories').first();
    asset = (await api('post', '/api/assets', u.sa1).send({ name: 'Grader', category_id: cat.id, sector_id: sector.id, kebele_id: k1 }).expect(201)).body;
    [period] = endedPeriods(todayIso(), 'ET', 1);
  });

  it('each person sees their own months, deadline and boss; the month in progress cannot be reported yet', async () => {
    const me = await mine(u.sa1);
    assert.deepEqual([me.calendar, me.sends, me.sends_to, me.deadline_days, me.receives], ['ET', true, 'KEBELE_ADMIN', 5, false]);
    assert.deepEqual(me.reviewers.map((r) => r.username), ['kebele.a']);
    assert.equal(me.periods.length, 6);
    assert.deepEqual([me.periods[0].period.key, me.periods[0].status, me.periods[0].deadline], [period.key, 'NOT_SUBMITTED', addDays(period.end, 5)]);
    assert.deepEqual((await mine(u.kb1)).reviewers.map((r) => r.username), ['kifle.jiren']);
    assert.deepEqual((await mine(u.finance)).reviewers.map((r) => r.username), ['kifle.jiren']);
    assert.deepEqual((await mine(u.kj)).reviewers.map((r) => r.username), ['mayor']);
    assert.deepEqual((await mine(u.auditor)).reviewers.map((r) => r.username), ['mayor']); // the auditor is independent of the Kifle Ketemas
    const mayor = await mine(u.mayor);
    assert.deepEqual([mayor.sends, mayor.receives, mayor.periods], [false, true, []]);
    await submit(u.mayor).expect(403);
    await submit(u.sa1, {}, periodOf(todayIso(), 'ET').key).expect(409);
    await submit(u.sa1, {}, 'ET-2019-13').expect(404);
  });

  it('the figures are generated by the system for the reporter\'s own area', async () => {
    const preview = (await api('get', `/api/monthly-reports/preview/${period.key}`, u.sa1).expect(200)).body;
    assert.equal(value(preview, 'Position of the assets', 'Assets in the register'), 1);
    assert.ok(section(preview, 'Money'), 'a Sector Administrator may see the money of its assets');
    assert.equal(value((await api('get', `/api/monthly-reports/preview/${period.key}`, u.sa3).expect(200)).body, 'Position of the assets', 'Assets in the register'), 0);
    const inspector = (await api('get', `/api/monthly-reports/preview/${period.key}`, u.inspector).expect(200)).body;
    assert.ok(section(inspector, 'Your inspections'));
    assert.equal(section(inspector, 'Money'), undefined);
    const auditor = (await api('get', `/api/monthly-reports/preview/${period.key}`, u.auditor).expect(200)).body;
    assert.ok(section(auditor, 'Recorded in the audit trail'));
    assert.deepEqual(auditor.area, { city: true, kifle: [], kebeles: [], sectors: [] });
  });

  it('a report goes to the boss only, who accepts it or returns it with a reason', async () => {
    const sent = (await submit(u.sa1, { comment: 'All in order.' }).expect(201)).body;
    assert.deepEqual([sent.status, sent.version, sent.reporter.username], ['SUBMITTED', 1, 'sector.con.a']);
    await submit(u.sa1).expect(409); // already waiting for a decision
    assert.ok((await titles(u.kb1)).some((x) => /sent the monthly report/.test(x)));
    const sentNote = (await api('get', '/api/notifications', u.kb1).expect(200)).body.find((n) => n.type === 'MONTHLY_REPORT_SUBMITTED');
    assert.equal(sentNote.link, `/monthly-reports/report/${sent.id}`); // opens the report's own page

    // only the boss sees it; the levels above see the Kebele's report, not each sector's, and the Super Administrator not at all
    for (const who of [u.kb2, u.kj, u.mayor, u.sa2, u.super]) await api('get', `/api/monthly-reports/report/${sent.id}`, who).expect(404);
    assert.equal((await api('get', `/api/monthly-reports/report/${sent.id}`, u.kb1).expect(200)).body.can_decide, true);
    await api('post', `/api/monthly-reports/report/${sent.id}/accept`, u.super).expect(404); // the Super Administrator neither reads nor decides
    assert.equal((await api('get', '/api/dashboard/queue', u.kb1).expect(200)).body.monthly, 2); // one to decide, and its own report

    await api('post', `/api/monthly-reports/report/${sent.id}/return`, u.kb1).send({}).expect(400);
    await api('post', `/api/monthly-reports/report/${sent.id}/return`, u.kb1).send({ note: 'The grader is missing its location.' }).expect(200);
    assert.ok((await titles(u.sa1)).some((x) => /was returned for correction/.test(x)));
    const back = (await api('get', '/api/notifications', u.sa1).expect(200)).body.find((n) => n.type === 'MONTHLY_REPORT_RETURNED');
    assert.match(back.link, /^\/monthly-reports\/prepare\//); // straight to correcting it
    assert.equal((await mine(u.sa1)).periods[0].status, 'RETURNED');
    const again = (await submit(u.sa1, { comment: 'Location added.' }).expect(201)).body;
    assert.deepEqual([again.id, again.version, again.status], [sent.id, 2, 'SUBMITTED']);
    await api('post', `/api/monthly-reports/report/${sent.id}/accept`, u.kb1).send({}).expect(200);
    assert.ok((await titles(u.sa1)).some((x) => /was accepted/.test(x)));
    await submit(u.sa1).expect(409); // accepted: locked
    await api('post', `/api/monthly-reports/report/${sent.id}/return`, u.kb1).send({ note: 'x' }).expect(409);
  });

  it('each boss sees exactly the reports that come to it; the Super Administrator follows the status of them all', async () => {
    const names = async (who) => (await team(who)).members.map((m) => m.user.username);
    assert.deepEqual(await names(u.kb1), ['sector.bus.a', 'sector.con.a']);
    assert.deepEqual(await names(u.kj), ['kebele.a', 'kebele.b', 'finance.jiren', 'inspector.jiren']);
    assert.deepEqual(await names(u.kh), ['kebele.c']);
    assert.deepEqual(await names(u.mayor), ['kifle.hirmata', 'kifle.jiren', 'auditor']);
    const all = await team(u.super);
    assert.equal(all.members.length, 11);
    assert.equal(all.decides, false);
    // where each report stands, never what it says
    const followed = all.members.find((m) => m.user.username === 'sector.con.a');
    assert.equal(followed.status, 'ACCEPTED');
    assert.deepEqual(Object.keys(followed.report).sort(), ['decided_at', 'status', 'submitted_at', 'version']);
    const boss = (await team(u.kb1)).members.find((m) => m.user.username === 'sector.con.a');
    assert.equal(boss.report.comment, 'Location added.'); // the person it is sent to reads it
    await api('get', '/api/monthly-reports/team', u.sa1).expect(403);
    const kebele = await team(u.kb1);
    assert.deepEqual(kebele.members.map((m) => m.status), ['NOT_SUBMITTED', 'ACCEPTED']);
    assert.equal(kebele.periods.length, 6);
  });

  it('a boss may send its report before the whole team, but must explain what is missing', async () => {
    const res = await submit(u.kb1, { comment: 'short' }).expect(400);
    assert.ok(res.body.details.comment);
    const sent = (await submit(u.kb1, { comment: 'Trade sector report still missing: the administrator is on leave.' }).expect(201)).body;
    assert.equal(value(sent.snapshot, 'Reports from your team', 'Reports expected'), 2);
    assert.equal(value(sent.snapshot, 'Reports from your team', 'Not sent'), 1);
    assert.match(value(sent.snapshot, 'Reports from your team', 'Not sent by'), /Test sector\.bus\.a/);

    await submit(u.kj, {}).expect(400); // Kebele B, the Financial Officer and the Inspector have not sent theirs
    const kifle = (await submit(u.kj, { comment: 'Kebele B and the specialists are late.' }).expect(201)).body;
    assert.equal(value(kifle.snapshot, 'Reports from your team', 'Sent'), 1);
    assert.equal(value(kifle.snapshot, 'Reports from your team', 'Sector reports expected in your Kebeles'), 2);
    assert.equal(value(kifle.snapshot, 'Reports from your team', 'Sector reports sent'), 1);
    assert.ok((await titles(u.mayor)).some((x) => /Test kifle\.jiren sent the monthly report/.test(x)));

    const audit = (await submit(u.auditor, { comment: 'No findings this month.' }).expect(201)).body;
    assert.equal(section(audit.snapshot, 'Reports from your team'), undefined);
    await api('post', `/api/monthly-reports/report/${audit.id}/accept`, u.mayor).send({ note: 'Thank you.' }).expect(200);
    await api('post', `/api/monthly-reports/report/${kifle.id}/accept`, u.kh).send({}).expect(404); // not its report to see
    const view = await team(u.mayor);
    assert.deepEqual(view.members.map((m) => [m.user.username, m.status]), [['kifle.hirmata', 'NOT_SUBMITTED'], ['kifle.jiren', 'SUBMITTED'], ['auditor', 'ACCEPTED']]);
  });

  it('reminds people before the deadline, and tells them and their boss once it has passed, once each', async () => {
    const due = await remindMonthlyReports(new Date(`${addDays(period.end, 3)}T09:00:00Z`));
    assert.ok(due.MONTHLY_REPORT_DUE >= 2, 'the Sector Administrators who still owe a report (deadline: day 5)'); // sa2 and sa3
    assert.ok((await titles(u.sa2)).some((x) => /is due on/.test(x)));
    assert.ok(!(await titles(u.kb2)).some((x) => /is due on/.test(x)), 'the Kebele deadline (day 10) is still a week away');

    const late = await remindMonthlyReports(new Date(`${addDays(period.end, 16)}T09:00:00Z`));
    assert.ok(late.MONTHLY_REPORT_LATE > 0);
    assert.ok((await titles(u.sa2)).some((x) => /is late/.test(x)));
    assert.ok((await titles(u.kb1)).some((x) => /Test sector\.bus\.a has not sent the monthly report/.test(x)), 'the boss is told');
    assert.ok((await titles(u.kj)).some((x) => /Test finance\.jiren has not sent/.test(x)));
    assert.ok((await titles(u.mayor)).some((x) => /Test kifle\.hirmata has not sent/.test(x)));
    assert.ok(!(await titles(u.sa1)).some((x) => /is late/.test(x)), 'an accepted report is not late');
    const again = await remindMonthlyReports(new Date(`${addDays(period.end, 16)}T10:00:00Z`));
    assert.deepEqual(Object.values(again).filter(Boolean), [], 'nobody is told twice');
  });

  it('the Super Administrator chooses the calendar; dates follow it', async () => {
    await api('put', '/api/admin/settings', u.super).send({ report_calendar: 'XX' }).expect(400);
    const set = (await api('put', '/api/admin/settings', u.super).send({ report_calendar: 'GC' }).expect(200)).body;
    assert.equal(set.values.report_calendar, 'GC');
    const me = await mine(u.sa1);
    assert.equal(me.calendar, 'GC');
    assert.match(me.periods[0].period.key, /^GC-\d{4}-\d{2}$/);
    await api('put', '/api/admin/settings', u.super).send({ report_calendar: 'ET' }).expect(200);
    assert.equal((await api('get', '/api/admin/settings', u.super).expect(200)).body.values.report_calendar, 'ET');
  });
});
