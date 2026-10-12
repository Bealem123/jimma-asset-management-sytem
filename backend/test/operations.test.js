import './env.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  api, activateAsset, closeDb, createAsset, makeUser, setupFixture, assetBody,
} from './helpers.js';
import { db } from '../src/db.js';
import { DEFAULT_ROLE_PERMISSIONS } from '../src/lib/constants.js';
import { useTestChannels } from '../src/lib/channels.js';

after(closeDb);

const dayOffset = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const active = async (fx, user, over = {}) => {
  const a = await createAsset(fx, user, over);
  await activateAsset(fx, a);
  return a;
};

describe('physical verification', () => {
  let fx; let A; let B; let C; let D; let inspector; let campaign;
  before(async () => {
    fx = await setupFixture();
    inspector = await makeUser('field_inspector', 'INSPECTOR', { kebeles: [fx.k1, fx.k2] });
    A = await active(fx, fx.users.officer, { name: 'Asset A' });
    B = await active(fx, fx.users.officer, { name: 'Asset B' });
    C = await active(fx, fx.users.officer, { name: 'Asset C' });
    D = await active(fx, fx.users.officer, { name: 'Asset D', kebele_id: fx.k2 });
  });

  it('only a verification manager can open a campaign, and it snapshots what the database says', async () => {
    await api('post', '/api/verification', inspector).send({ name: 'x', kebele_id: fx.k1 }).expect(403);
    await api('post', '/api/verification', fx.users.hirmataAdmin).send({ name: 'Nothing here', kebele_id: fx.k3 }).expect(400);
    const res = await api('post', '/api/verification', fx.users.jirenAdmin).send({ name: 'Kebele A check', kebele_id: fx.k1 }).expect(201);
    campaign = res.body;
    assert.equal(campaign.summary.total, 3);
    assert.equal(campaign.summary.pending, 3);
    const items = (await api('get', `/api/verification/${campaign.id}`, fx.users.jirenAdmin)).body.items;
    assert.ok(items.every((i) => i.expected_kebele_name === 'Jiren Kebele A'));
  });

  it('finds an asset in place, in the wrong place, or not at all', async () => {
    const ok = await api('post', `/api/verification/${campaign.id}/record`, inspector).send({ asset: A.asset_code, found_condition: 'GOOD' }).expect(200);
    assert.equal(ok.body.result, 'FOUND');
    assert.equal(ok.body.discrepancy_status, 'NONE');

    const wrong = await api('post', `/api/verification/${campaign.id}/record`, inspector).send({ asset: B.asset_code, found_kebele_id: fx.k2, found_location_detail: 'Depot 7' }).expect(200);
    assert.equal(wrong.body.result, 'WRONG_LOCATION');
    assert.equal(wrong.body.discrepancy_status, 'OPEN');
    assert.equal(wrong.body.expected_kebele_name, 'Jiren Kebele A');
    assert.equal(wrong.body.found_kebele_name, 'Jiren Kebele B');

    const missing = await api('post', `/api/verification/${campaign.id}/record`, inspector)
      .send({ asset: `https://jimma.example/scan/${C.asset_code}`, result: 'MISSING', method: 'SCAN', notes: 'Not at the depot' }).expect(200);
    assert.equal(missing.body.result, 'MISSING');
    assert.ok(await db('scan_events').where({ asset_id: C.id, context: 'VERIFICATION', user_id: inspector.id }).first(), 'scan is logged with who and when');

    await api('post', `/api/verification/${campaign.id}/record`, inspector).send({ asset: D.asset_code }).expect(404); // not part of this campaign
    await api('post', `/api/verification/${campaign.id}/record`, fx.users.finance).send({ asset: A.asset_code }).expect(403);
    await api('post', `/api/verification/${campaign.id}/record`, inspector).send({ asset: 'AST-999999' }).expect(404);
    const summary = (await api('get', `/api/verification/${campaign.id}`, fx.users.jirenAdmin)).body.summary;
    assert.deepEqual([summary.found, summary.wrong_location, summary.missing, summary.pending, summary.open_discrepancies], [1, 1, 1, 0, 2]);
    assert.equal(summary.progress, 100);
  });

  it('tells the verification managers about each discrepancy', async () => {
    const mine = (await api('get', '/api/notifications', fx.users.jirenAdmin)).body;
    assert.ok(mine.some((n) => n.type === 'VERIFICATION_DISCREPANCY' && n.asset_id === B.id));
    assert.ok(mine.some((n) => n.type === 'ASSET_MISSING' && n.asset_id === C.id));
  });

  it('investigates, then corrects the register without losing the old values', async () => {
    const items = (await api('get', `/api/verification/${campaign.id}?discrepancy=open`, fx.users.jirenAdmin)).body.items;
    const wrong = items.find((i) => i.asset_id === B.id);
    const missing = items.find((i) => i.asset_id === C.id);
    await api('post', `/api/verification/items/${wrong.id}/resolve`, fx.users.officer).send({ action: 'CORRECT', note: 'ok' }).expect(403);
    await api('post', `/api/verification/items/${wrong.id}/resolve`, fx.users.jirenAdmin).send({ action: 'INVESTIGATE', note: 'Calling the depot' }).expect(200);
    await api('post', `/api/verification/items/${wrong.id}/resolve`, fx.users.jirenAdmin).send({ action: 'CORRECT' }).expect(400); // needs a reason
    await api('post', `/api/verification/items/${wrong.id}/resolve`, fx.users.jirenAdmin).send({ action: 'CORRECT', note: 'Moved to Depot 7 in June' }).expect(200);

    const b = await db('assets').where({ id: B.id }).first();
    assert.equal(b.kebele_id, fx.k2);
    assert.equal(b.location_detail, 'Depot 7');
    const t = await db('asset_transfers').where({ asset_id: B.id }).first();
    assert.equal(t.from_kebele_id, fx.k1);
    assert.equal(t.to_kebele_id, fx.k2);
    assert.match(t.reason, /corrected after physical verification/);
    const history = (await api('get', `/api/assets/${B.id}`, fx.users.jirenAdmin)).body.history.map((h) => h.action);
    assert.ok(history.includes('LOCATION_CORRECTION') && history.includes('VERIFICATION_RECORD'));

    await api('post', `/api/verification/items/${missing.id}/resolve`, fx.users.jirenAdmin).send({ action: 'CORRECT', note: 'Confirmed missing; police report filed' }).expect(200);
    assert.equal((await db('assets').where({ id: C.id }).first()).status, 'LOST');
    await api('post', `/api/verification/items/${missing.id}/resolve`, fx.users.jirenAdmin).send({ action: 'DISMISS', note: 'again' }).expect(409); // already resolved
    const summary = (await api('get', `/api/verification/${campaign.id}`, fx.users.jirenAdmin)).body.summary;
    assert.equal(summary.open_discrepancies, 0);
    assert.equal(summary.corrected, 2);
  });

  it('does not let the person who recorded a finding approve its correction', async () => {
    // the Kebele Administrator of Kebele B both records findings and manages verification
    const c2 = (await api('post', '/api/verification', fx.users.jirenAdmin).send({ name: 'Second', kebele_id: fx.k2 }).expect(201)).body;
    const rec = await api('post', `/api/verification/${c2.id}/record`, fx.users.kebeleB).send({ asset: D.asset_code, result: 'MISSING' }).expect(200);
    await api('post', `/api/verification/items/${rec.body.id}/resolve`, fx.users.kebeleB).send({ action: 'DISMISS', note: 'my own finding' }).expect(409);
    await api('post', `/api/verification/items/${rec.body.id}/resolve`, fx.users.jirenAdmin).send({ action: 'DISMISS', note: 'Found in the next room' }).expect(200);
    assert.equal((await db('assets').where({ id: D.id }).first()).status, 'ACTIVE', 'dismissing changes nothing');
  });

  it('closes a campaign, can mark everything unchecked as missing, and then refuses new results', async () => {
    const c3 = (await api('post', '/api/verification', fx.users.jirenAdmin).send({ name: 'Third', kebele_id: fx.k2 }).expect(201)).body;
    const closed = await api('post', `/api/verification/${c3.id}/close`, fx.users.jirenAdmin).send({ mark_unverified_missing: true }).expect(200);
    assert.equal(closed.body.status, 'CLOSED');
    assert.equal(closed.body.summary.missing, 2);
    assert.equal(closed.body.summary.open_discrepancies, 2);
    await api('post', `/api/verification/${c3.id}/record`, fx.users.kebeleB).send({ asset: D.asset_code }).expect(409);
    await api('post', `/api/verification/${c3.id}/close`, fx.users.jirenAdmin).send({}).expect(409);
  });

  it('exports the comparison of expected and found as CSV', async () => {
    const res = await api('get', `/api/verification/${campaign.id}/report.csv`, fx.users.jirenAdmin).expect(200);
    assert.match(res.text, /Expected Kebele/);
    assert.match(res.text, /WRONG_LOCATION/);
    assert.match(res.text, new RegExp(A.asset_code));
  });
});

describe('inspections, follow-ups, alerts and notifications', () => {
  let fx; let X; let inspector; let sent;
  before(async () => {
    fx = await setupFixture();
    inspector = await makeUser('field_inspector', 'INSPECTOR', { kebeles: [fx.k1, fx.k2] });
    X = await createAsset(fx, fx.users.officer, { name: 'Generator' });
    sent = { mail: [], sms: [] };
    useTestChannels({ mail: { sendMail: async (m) => { sent.mail.push(m); } }, sms: async (m) => { sent.sms.push(m); } });
  });
  after(() => useTestChannels());

  const inspect = (user, body) => api('post', `/api/assets/${X.id}/inspections`, user).send({ inspection_date: '2026-06-01', inspector: 'I. Spector', condition_found: 'GOOD', ...body });

  it('a failed inspection creates a follow-up and a critical one alerts the people responsible', async () => {
    const res = await inspect(inspector, { result: 'FAILED', condition_found: 'CRITICAL', notes: 'Cracked housing', follow_up: 'Replace the housing', follow_up_due: dayOffset(14), method: 'SCAN', latitude: '7.67', longitude: '36.83' }).expect(201);
    assert.equal(res.body.result, 'FAILED');
    assert.equal(res.body.method, 'SCAN');
    const d = (await api('get', `/api/assets/${X.id}`, fx.users.officer)).body;
    assert.equal(d.asset.condition, 'CRITICAL');
    assert.equal(d.follow_ups.length, 1);
    assert.equal(d.follow_ups[0].description, 'Replace the housing');
    assert.equal(d.follow_ups[0].source_type, 'INSPECTION');
    const alerts = (await api('get', '/api/notifications', fx.users.officer)).body.filter((n) => n.type === 'CRITICAL_CONDITION');
    assert.equal(alerts.length, 1);
    assert.equal((await api('get', '/api/notifications', inspector)).body.filter((n) => n.type === 'CRITICAL_CONDITION').length, 0, 'the person who acted is not alerted');
    await inspect(inspector, { condition_found: 'CRITICAL', result: 'FAILED', notes: 'Still cracked' }).expect(201);
    assert.equal((await api('get', '/api/notifications', fx.users.officer)).body.filter((n) => n.type === 'CRITICAL_CONDITION').length, 1, 'no repeat alert while it stays critical');
    assert.equal((await db('follow_up_actions').where({ asset_id: X.id })).length, 2);
  });

  it('closes a follow-up with what was done', async () => {
    const open = (await api('get', '/api/assets/follow-ups/open', fx.users.officer)).body;
    assert.equal(open.length, 2);
    const id = open[0].id;
    await api('post', `/api/assets/${X.id}/follow-ups/${id}/close`, fx.users.officer).send({}).expect(400);
    await api('post', `/api/assets/${X.id}/follow-ups/${id}/close`, fx.users.officer).send({ resolution: 'Housing replaced' }).expect(200);
    await api('post', `/api/assets/${X.id}/follow-ups/${id}/close`, fx.users.officer).send({ resolution: 'again' }).expect(409);
    await api('post', `/api/assets/${X.id}/follow-ups`, fx.users.officer).send({ description: 'Order spare filter', due_date: dayOffset(30) }).expect(201);
    assert.equal((await api('get', '/api/assets/follow-ups/open', fx.users.officer)).body.length, 2);
    assert.equal((await api('get', '/api/assets/follow-ups/open', fx.users.nobody)).body.length, 0);
  });

  it('keeps notifications private to each user, and lets them be read', async () => {
    const mine = (await api('get', '/api/notifications', fx.users.officer)).body;
    const unread = (await api('get', '/api/notifications/count', fx.users.officer)).body.unread;
    assert.ok(unread >= 1);
    await api('post', `/api/notifications/${mine[0].id}/read`, fx.users.mayor).expect(404);
    await api('post', `/api/notifications/${mine[0].id}/read`, fx.users.officer).expect(200);
    assert.equal((await api('get', '/api/notifications/count', fx.users.officer)).body.unread, unread - 1);
    await api('post', '/api/notifications/read-all', fx.users.officer).expect(200);
    assert.equal((await api('get', '/api/notifications/count', fx.users.officer)).body.unread, 0);
  });

  it('scans for due and overdue maintenance, inspections, expiring documents and leases, once each', async () => {
    const m = (body) => api('post', `/api/assets/${X.id}/maintenance`, fx.users.officer).send({ maintenance_date: '2026-01-10', maintenance_type: 'Service', ...body });
    await m({ next_maintenance_date: '2026-02-01' }).expect(201); // long overdue
    const Y = await createAsset(fx, fx.users.officer, { name: 'Pump' });
    await api('post', `/api/assets/${Y.id}/maintenance`, fx.users.officer).send({ maintenance_date: '2026-01-10', maintenance_type: 'Service', next_maintenance_date: dayOffset(5) }).expect(201);
    await api('post', `/api/assets/${Y.id}/inspections`, inspector).send({ inspection_date: '2026-01-10', inspector: 'x', condition_found: 'GOOD', next_inspection_date: dayOffset(3) }).expect(201);
    await db('asset_documents').insert({
      asset_id: Y.id, doc_type: 'OTHER', title: 'Insurance', original_name: 'i.pdf', stored_name: 'none.pdf', mime_type: 'application/pdf', size_bytes: 1, expires_on: dayOffset(10),
    });
    await api('post', `/api/assets/${Y.id}/utilizations`, fx.users.officer).send({ use_type: 'LEASE', user_party: 'Tenant B', start_date: '2026-01-01', end_date: dayOffset(20) }).expect(201);

    await api('post', '/api/notifications/run', fx.users.mayor).expect(403);
    const first = (await api('post', '/api/notifications/run', fx.users.super).expect(200)).body.created;
    for (const type of ['MAINTENANCE_OVERDUE', 'MAINTENANCE_DUE', 'INSPECTION_DUE', 'DOCUMENT_EXPIRING', 'LEASE_EXPIRING']) assert.ok(first[type] >= 1, type);
    const second = (await api('post', '/api/notifications/run', fx.users.super).expect(200)).body.created;
    assert.deepEqual(Object.values(second).filter(Boolean), [], 'the same alert is never raised twice');
    const types = (await api('get', '/api/notifications?limit=100', fx.users.officer)).body.map((n) => n.type);
    assert.ok(types.includes('MAINTENANCE_OVERDUE') && types.includes('LEASE_EXPIRING'));
  });

  it('lets an administrator switch an alert off or change when it fires', async () => {
    await api('get', '/api/notifications/rules', fx.users.mayor).expect(403);
    const rules = (await api('get', '/api/notifications/rules', fx.users.super).expect(200)).body;
    assert.ok(rules.rules.length >= 12);
    await api('put', '/api/notifications/rules/MAINTENANCE_OVERDUE', fx.users.super).send({ enabled: false }).expect(200);
    const Z = await createAsset(fx, fx.users.officer, { name: 'Roller' });
    await api('post', `/api/assets/${Z.id}/maintenance`, fx.users.officer).send({ maintenance_date: '2026-01-10', maintenance_type: 'Service', next_maintenance_date: '2026-01-20' }).expect(201);
    const off = (await api('post', '/api/notifications/run', fx.users.super)).body.created;
    assert.ok(!off.MAINTENANCE_OVERDUE);
    await api('put', '/api/notifications/rules/MAINTENANCE_OVERDUE', fx.users.super).send({ enabled: true }).expect(200);
    const on = (await api('post', '/api/notifications/run', fx.users.super)).body.created;
    assert.ok(on.MAINTENANCE_OVERDUE >= 1);
    await api('put', '/api/notifications/rules/NOPE', fx.users.super).send({ enabled: true }).expect(404);
  });

  it('sends e-mail and SMS when the rule asks for it and the user has an address', async () => {
    await db('users').where({ id: fx.users.officer.id }).update({ email: 'officer@jimma.example', phone: '+251911000000' });
    await api('put', '/api/notifications/rules/CRITICAL_CONDITION', fx.users.super).send({ enabled: true, email: true, sms: true }).expect(200);
    const W = await createAsset(fx, fx.users.officer, { name: 'Loader' });
    await api('post', `/api/assets/${W.id}/inspections`, inspector).send({ inspection_date: '2026-06-01', inspector: 'I', condition_found: 'CRITICAL', result: 'FAILED' }).expect(201);
    assert.equal(sent.mail.length, 1);
    assert.equal(sent.mail[0].to, 'officer@jimma.example');
    assert.match(sent.mail[0].subject, /critical condition/);
    assert.equal(sent.sms.length, 1);
    assert.equal(sent.sms[0].to, '+251911000000');
    const note = (await api('get', '/api/notifications', fx.users.officer)).body.find((n) => n.asset_id === W.id);
    assert.equal(note.email_status, 'SENT');
    assert.equal(note.sms_status, 'SENT');
    const rules = (await api('get', '/api/notifications/rules', fx.users.super)).body;
    assert.equal(rules.channels.email, true);
  });

  it('tracks a maintenance job from planned to completed', async () => {
    const m = (await api('post', `/api/assets/${X.id}/maintenance`, fx.users.officer).send({ maintenance_date: '2026-06-01', maintenance_type: 'Overhaul', kind: 'OVERHAUL', status: 'PLANNED', cost: 1000 }).expect(201)).body;
    assert.equal(m.kind, 'OVERHAUL');
    const done = await api('patch', `/api/assets/${X.id}/maintenance/${m.id}`, fx.users.officer).send({ status: 'COMPLETED', cost: 1250, provider: 'Jimma Garage' }).expect(200);
    assert.equal(done.body.status, 'COMPLETED');
    assert.equal(done.body.cost, 1250);
    await api('patch', `/api/assets/${X.id}/maintenance/${m.id}`, inspector).send({ status: 'CANCELLED' }).expect(403);
    assert.ok(await db('audit_logs').where({ action: 'MAINTENANCE_UPDATE', asset_id: X.id }).first());
  });
});

describe('QR codes, scanning, map and bulk import', () => {
  let fx; let a; let far;
  before(async () => {
    fx = await setupFixture();
    a = await createAsset(fx, fx.users.officer, { latitude: 7.6735, longitude: 36.8344 });
    await createAsset(fx, fx.users.officer, { latitude: 7.68, longitude: 36.84, kebele_id: fx.k2 });
    await createAsset(fx, fx.users.officer, { name: 'No coordinates' });
    far = await createAsset(fx, fx.users.sectorAdmin, { kebele_id: fx.k3, latitude: 7.7, longitude: 36.9 });
  });

  it('generates a QR code for each asset, as SVG or PNG, only for people who may see the asset', async () => {
    const svg = await api('get', `/api/assets/${a.id}/qr.svg`, fx.users.officer).expect(200);
    assert.match(svg.headers['content-type'], /svg/);
    assert.match(String(svg.body), /<svg/);
    const png = await api('get', `/api/assets/${a.id}/qr.png`, fx.users.officer).expect(200);
    assert.equal(png.headers['content-type'], 'image/png');
    assert.equal(png.body.subarray(1, 4).toString(), 'PNG');
    await api('get', `/api/assets/${a.id}/qr.svg`, fx.users.nobody).expect(404);
    await api('get', `/api/assets/${a.id}/qr.svg`).expect(401);
  });

  it('opens the asset when its QR code or barcode is scanned, and records who scanned and when', async () => {
    const res = await api('post', '/api/assets/scan', fx.users.officer).send({ code: `https://jimma.example/scan/${a.asset_code}`, context: 'INSPECTION', latitude: 7.67, longitude: 36.83 }).expect(200);
    assert.equal(res.body.asset_code, a.asset_code);
    const plain = await api('post', '/api/assets/scan', fx.users.officer).send({ code: a.asset_code.toLowerCase() }).expect(200);
    assert.equal(plain.body.id, a.id);
    const ev = await db('scan_events').where({ asset_id: a.id }).orderBy('id');
    assert.equal(ev.length, 2);
    assert.equal(ev[0].user_id, fx.users.officer.id);
    assert.equal(ev[0].context, 'INSPECTION');
    assert.ok(ev[0].created_at);
    const trail = (await api('get', `/api/assets/${a.id}/scans`, fx.users.officer)).body;
    assert.equal(trail.length, 2);
    await api('post', '/api/assets/scan', fx.users.officer).send({ code: 'hello world' }).expect(400);
    await api('post', '/api/assets/scan', fx.users.kebeleA).send({ code: far.asset_code }).expect(404);
  });

  it('puts assets on the map with the same filters and area limits as the list', async () => {
    const all = (await api('get', '/api/assets/map', fx.users.mayor).expect(200)).body;
    assert.equal(all.length, 3, 'assets without coordinates are not mapped');
    assert.ok(all.every((p) => p.latitude && p.longitude && p.asset_code));
    const one = (await api('get', `/api/assets/map?kebele_id=${fx.k2}`, fx.users.mayor)).body;
    assert.equal(one.length, 1);
    const mine = (await api('get', '/api/assets/map', fx.users.officer)).body;
    assert.equal(mine.length, 2, 'the officer cannot see the far asset');
    assert.equal((await api('get', '/api/assets/map', fx.users.nobody)).body.length, 0);
    assert.equal((await api('get', `/api/assets/map?kifle_ketema_id=${fx.hirmata.id}`, fx.users.mayor)).body.length, 1);
  });

  const HEADER = 'name,category,asset_type,sector,department,kifle_ketema,kebele,location_detail,latitude,longitude,serial_number,registration_number,owner_name,condition,acquisition_date,acquisition_cost';
  // No role imports by default: the Super Administrator allows it for Sector Administrators (System -> Roles and permissions).
  // The importer is the Transport Sector Administrator of Kebeles A and B.
  let importer;
  const allowImport = async () => {
    await api('put', '/api/admin/permissions/SECTOR_ADMIN', fx.users.super).send({ permissions: [...DEFAULT_ROLE_PERMISSIONS.SECTOR_ADMIN, 'import.run'] }).expect(200);
    const transport = await db('sectors').where({ code: 'TRN' }).first();
    importer ??= await makeUser('transport_ab', 'SECTOR_ADMIN', { sectors: [transport.id], kebeles: [fx.k1, fx.k2] });
  };
  const csvUpload = (user, text, query = '') => api('post', `/api/assets/import${query}`, user).attach('file', Buffer.from(text), { filename: 'assets.csv', contentType: 'text/csv' });

  it('validates a whole file first and imports nothing if any row is wrong', async () => {
    await allowImport();
    const before = await db('assets').count({ n: 'id' }).first().then((r) => Number(r.n));
    const bad = [
      HEADER,
      'Good pickup,Vehicles,Pickup,TRN,,,Jiren Kebele A,Yard,7.6,36.8,SN-I1,REG-I1,,GOOD,2024-01-02,800000',
      'Mystery,Spaceships,,TRN,,,Jiren Kebele A,,,,,,,,,',
      'Repeat,Vehicles,Pickup,TRN,,,Jiren Kebele A,,,,SN-I1,,,,,',
      'Wrong place,Vehicles,Pickup,TRN,,,Hirmata Kebele C,,,,,,,,,',
      'Bad condition,Vehicles,Pickup,TRN,,,Jiren Kebele A,,,,,,,SHINY,,',
      'No location,Vehicles,Pickup,TRN,,,,,,,,,,,,',
    ].join('\n');
    const res = await csvUpload(importer, bad).expect(400);
    assert.match(res.body.error, /Nothing was imported/);
    const byRow = Object.fromEntries(res.body.errors.map((e) => [e.row, e.problems.join(' | ')]));
    assert.match(byRow[3], /Unknown category/);
    assert.match(byRow[4], /repeated in this file/);
    assert.match(byRow[5], /outside your assigned area/);
    assert.match(byRow[6], /Condition/);
    assert.match(byRow[7], /Kebele or a Kifle/);
    assert.equal(byRow[2], undefined, 'good rows are not reported');
    assert.equal(await db('assets').count({ n: 'id' }).first().then((r) => Number(r.n)), before);
  });

  it('can check a file without importing it, then imports it as drafts with a full trail', async () => {
    const good = [
      HEADER,
      'Pickup One,Vehicles,Pickup,Transportation,,,Jiren Kebele A,Yard,7.6,36.8,SN-J1,REG-J1,,GOOD,2024-01-02,800000',
      'Pickup Two,Vehicles,Pickup,TRN,,Jiren,Jiren Kebele B,Yard,,,SN-J2,REG-J2,,FAIR,,',
    ].join('\n');
    const before = await db('assets').count({ n: 'id' }).first().then((r) => Number(r.n));
    const dry = await csvUpload(importer, good, '?dry_run=true').expect(200);
    assert.equal(dry.body.valid, 2);
    assert.equal(await db('assets').count({ n: 'id' }).first().then((r) => Number(r.n)), before);
    const done = await csvUpload(importer, good).expect(201);
    assert.equal(done.body.imported, 2);
    const rows = await db('assets').whereIn('serial_number', ['SN-J1', 'SN-J2']).orderBy('serial_number');
    assert.equal(rows.length, 2);
    assert.ok(rows.every((r) => r.approval_state === 'DRAFT' && /^AST-\d{6}$/.test(r.asset_code) && r.created_by === importer.id));
    assert.equal(rows[1].condition, 'FAIR');
    assert.ok(await db('audit_logs').where({ action: 'IMPORT' }).first());
    // importing it again is refused as a duplicate
    const again = await csvUpload(importer, good).expect(400);
    assert.match(JSON.stringify(again.body.errors), /Already used by/);
  });

  it('is limited to people allowed to import, and explains a wrong layout', async () => {
    await csvUpload(fx.users.inspector, HEADER).expect(403);
    await csvUpload(fx.users.kebeleA, HEADER).expect(403);
    const res = await csvUpload(importer, 'foo,bar\n1,2').expect(400);
    assert.match(res.body.error, /Missing column/);
    await api('post', '/api/assets/import', importer).expect(400);
    const tpl = await api('get', '/api/assets/import/template.csv', importer).expect(200);
    assert.ok(tpl.text.startsWith('name,category'));
  });

  it('finds assets that share a serial or registration number (for data cleaning)', async () => {
    const first = await createAsset(fx, fx.users.officer, { name: 'Twin 1', registration_number: 'TWIN-1' });
    const { id, asset_code, ...clone } = await db('assets').where({ id: first.id }).first(); // legacy data can predate the rule
    await db('assets').insert({ ...clone, name: 'Twin 2' });
    const groups = (await api('get', '/api/assets/duplicates/scan', fx.users.mayor).expect(200)).body;
    const g = groups.find((x) => x.value === 'TWIN-1');
    assert.equal(g.assets.length, 2);
    assert.equal(g.field, 'registration_number');
    assert.ok(id && asset_code);
  });
});

describe('dashboard and analytics', () => {
  let fx; let asset; let inspector;
  before(async () => {
    fx = await setupFixture();
    inspector = await makeUser('field_inspector', 'INSPECTOR', { kebeles: [fx.k1] });
    asset = await createAsset(fx, fx.users.officer, {
      serial_number: 'SN-R1', acquisition_date: '2020-01-01', acquisition_cost: 1000000, useful_life_years: 10, salvage_value: 100000, condition: 'POOR',
      acquisition: { method: 'PURCHASE', supplier_name: 'Supplier S', acquisition_date: '2020-01-01', cost: 1000000 },
    });
    await api('post', `/api/assets/${asset.id}/maintenance`, fx.users.officer).send({ maintenance_date: '2026-03-01', maintenance_type: 'Repair', kind: 'REPAIR', cost: 600000, next_maintenance_date: '2026-04-01' }).expect(201);
    await api('post', `/api/assets/${asset.id}/inspections`, inspector).send({ inspection_date: '2026-05-01', inspector: 'x', condition_found: 'POOR', result: 'FAILED' }).expect(201);
    await api('post', `/api/assets/${asset.id}/revenues`, fx.users.finance).send({ revenue_type: 'LEASE', amount: 25000, received_date: '2026-06-01', payer: 'Lessee' }).expect(201);
    await api('post', `/api/assets/${asset.id}/utilizations`, fx.users.officer).send({ use_type: 'GOVERNMENT_USE', start_date: '2025-01-01' }).expect(201);
    const other = await createAsset(fx, fx.users.officer, { name: 'To dispose' });
    await api('put', '/api/admin/workflows/DISPOSAL', fx.users.super).send({ requires_approval: false }).expect(200);
    await api('post', `/api/assets/${other.id}/disposal`, fx.users.officer).send({ kind: 'DISPOSAL', reason: 'Scrap', method: 'SCRAP', disposal_date: '2026-07-01', disposal_value: 500 }).expect(201);
    await activateAsset(fx, asset);
    await api('post', '/api/verification', fx.users.kebeleA).send({ name: 'R check', kebele_id: fx.k1 }).expect(201);
  });

  it('shows the whole city on the dashboard, hiding money from people who may not see it', async () => {
    const d = (await api('get', '/api/dashboard', fx.users.mayor).expect(200)).body;
    for (const k of ['pending_requests', 'pending_reservations', 'open_discrepancies', 'open_follow_ups', 'open_maintenance_jobs', 'maintenance_overdue', 'maintenance_due_soon', 'revenue_received']) {
      assert.equal(typeof d.totals[k], 'number', k);
    }
    assert.equal(d.totals.revenue_received, 25000);
    assert.equal(d.totals.maintenance_overdue, 1);
    assert.deepEqual(d.by_kebele, [], 'the Mayor sees Kifle Ketemas, not Kebeles');
    assert.ok(d.by_kifle_ketema.length >= 1);
    assert.ok((await api('get', '/api/dashboard', fx.users.auditor)).body.by_kebele.length >= 1, 'the Auditor still sees every Kebele');
    assert.equal(d.can_see_money, true);
    assert.ok(d.by_status.some((s) => s.key === 'RETIRED'));
    const v = (await api('get', '/api/dashboard', fx.users.inspector)).body;
    assert.equal(v.totals.acquisition_cost, null);
    assert.equal(v.totals.revenue_received, null);
    assert.equal(v.can_see_money, false);
  });

  it('gives decision support: indicators, comparisons, trends, replacement candidates', async () => {
    await api('get', '/api/analytics', fx.users.inspector).expect(403);
    const a = (await api('get', '/api/analytics', fx.users.mayor).expect(200)).body;
    assert.ok(a.indicators.length >= 4);
    assert.ok(a.indicators.every((i) => ['good', 'warn', 'bad'].includes(i.status)));
    assert.ok(a.sector_comparison.some((s) => s.code === 'CON' && s.assets >= 1));
    assert.ok(a.geographic_comparison.kifle_ketema.length >= 1);
    assert.deepEqual([a.kebele_level, a.geographic_comparison.kebele], [false, []], 'the Mayor compares Kifle Ketemas only');
    const audit = (await api('get', '/api/analytics', fx.users.auditor).expect(200)).body;
    assert.ok(audit.kebele_level && audit.geographic_comparison.kebele.length >= 1);
    assert.equal(a.trends.registrations.length, 12);
    assert.equal(a.trends.maintenance.length, 12);
    assert.ok(a.high_maintenance.some((h) => h.asset_code === asset.asset_code && h.cost_ratio === 60));
    const cand = a.replacement_candidates.find((r) => r.asset_code === asset.asset_code);
    assert.ok(cand, 'repairs cost 60% of the price and the asset is past 50% of its life');
    assert.ok(cand.reasons.some((r) => /60%/.test(r)));
    assert.ok(a.value_analysis.assets_with_depreciation >= 1);
    assert.ok(a.lifecycle_cost[0].total_cost >= 1600000);
    const sector = (await api('get', '/api/analytics', fx.users.sectorAdmin).expect(200)).body;
    assert.equal(sector.can_see_money, true);
  });

  it('shows the Mayor the performance of each Kifle Ketema, not of each Kebele', async () => {
    const mayor = (await api('get', '/api/dashboard/performance', fx.users.mayor).expect(200)).body;
    assert.equal(mayor.kebele_level, false);
    assert.deepEqual(mayor.kebeles, []);
    assert.ok(mayor.kifle_ketemas.length >= 2 && mayor.kifle_ketemas.some((k) => k.admin?.username === 'jirenadmin'));
    const jiren = (await api('get', '/api/dashboard/performance', fx.users.jirenAdmin).expect(200)).body;
    assert.ok(jiren.kebele_level && jiren.kebeles.length >= 1, 'the Kifle Ketema Administrator follows its own Kebeles');
  });

  it('calculates depreciation from cost, salvage value and useful life', async () => {
    const d = (await api('get', `/api/assets/${asset.id}`, fx.users.mayor)).body;
    assert.equal(d.depreciation.method, 'STRAIGHT_LINE');
    assert.equal(d.depreciation.annual, 90000);
    assert.ok(d.depreciation.book_value < 1000000 && d.depreciation.book_value > 100000);
    assert.equal((await api('get', `/api/assets/${asset.id}`, fx.users.inspector)).body.depreciation, null);
  });
});

describe('system administration, API access and sessions', () => {
  let fx;
  before(async () => { fx = await setupFixture(); });
  after(async () => {
    const fs = await import('node:fs');
    const { backupDir } = await import('../src/lib/backup.js');
    fs.rmSync(backupDir(), { recursive: true, force: true });
  });

  it('reports system health to Super Administrators only, with plain warnings', async () => {
    await api('get', '/api/admin/health', fx.users.mayor).expect(403);
    const h = (await api('get', '/api/admin/health', fx.users.super).expect(200)).body;
    assert.equal(h.database.ok, true);
    assert.equal(h.status, 'ATTENTION');
    assert.ok(h.warnings.some((w) => /backup/.test(w)));
    assert.equal(typeof h.counts.assets, 'number');
  });

  it('keeps the calendar of the monthly reports', async () => {
    await api('put', '/api/admin/settings', fx.users.mayor).send({ report_calendar: 'GC' }).expect(403);
    assert.equal((await api('get', '/api/admin/settings', fx.users.super)).body.values.report_calendar, 'ET'); // Ethiopian by default
    await api('put', '/api/admin/settings', fx.users.super).send({ report_calendar: 'XX' }).expect(400);
    const res = await api('put', '/api/admin/settings', fx.users.super).send({ report_calendar: 'GC' }).expect(200);
    assert.equal(res.body.values.report_calendar, 'GC');
    await api('put', '/api/admin/settings', fx.users.super).send({ report_calendar: 'ET' }).expect(200);
  });

  it('backs up the uploaded files and the database, and checks the backup can be read back', async () => {
    const fs = await import('node:fs');
    const dump = 'C:\\wamp64\\bin\\mysql\\mysql8.4.7\\bin\\mysqldump.exe';
    if (!process.env.MYSQLDUMP_PATH && fs.existsSync(dump)) process.env.MYSQLDUMP_PATH = dump;
    const a = await createAsset(fx, fx.users.officer);
    await api('post', `/api/assets/${a.id}/documents`, fx.users.officer).field('doc_type', 'PHOTO').field('title', 'p').attach('file', Buffer.from('%PDF-1.4 x'), { filename: 'a.pdf', contentType: 'application/pdf' }).expect(201);
    const files = await api('post', '/api/admin/backups', fx.users.super).send({ kind: 'files' }).expect(201);
    assert.equal(files.body[0].status, 'OK');
    assert.match(files.body[0].note, /\d+ files copied/);
    if (process.env.MYSQLDUMP_PATH) {
      const db_ = await api('post', '/api/admin/backups', fx.users.super).send({ kind: 'database' }).expect(201);
      assert.equal(db_.body[0].status, 'OK');
      assert.ok(db_.body[0].size_bytes > 1000);
      const again = await api('post', `/api/admin/backups/${db_.body[0].id}/verify`, fx.users.super).expect(200);
      assert.equal(again.body.status, 'OK');
      assert.equal((await api('get', '/api/admin/health', fx.users.super)).body.backups.database.status, 'OK');
    }
    const list = (await api('get', '/api/admin/backups', fx.users.super)).body;
    assert.ok(list.backups.length >= 1);
    await api('post', '/api/admin/backups', fx.users.mayor).send({}).expect(403);
  });

  it('lets other City systems read the register with an API key, but never the money', async () => {
    await api('post', '/api/admin/api-keys', fx.users.mayor).send({ name: 'GIS' }).expect(403);
    const made = (await api('post', '/api/admin/api-keys', fx.users.super).send({ name: 'GIS server' }).expect(201)).body;
    assert.match(made.key, /^jam_[0-9a-f]{48}$/);
    const listed = (await api('get', '/api/admin/api-keys', fx.users.super)).body;
    assert.equal(listed.length, 1);
    assert.ok(!JSON.stringify(listed).includes(made.key) && listed[0].key_hash === undefined, 'the key is shown once only');

    const a = await createAsset(fx, fx.users.officer, { acquisition_cost: 777, latitude: 7.6, longitude: 36.8 });
    const get = (path, key = made.key) => api('get', `/api/integration/v1${path}`).set('X-API-Key', key);
    const res = await get('/assets').expect(200);
    const row = res.body.data.find((r) => r.asset_id === a.asset_code);
    assert.equal(row.latitude, 7.6);
    assert.ok(!JSON.stringify(res.body).includes('777') && row.acquisition_cost === undefined && row.current_valuation === undefined);
    assert.equal((await get(`/assets/${a.asset_code}`).expect(200)).body.name, a.name);
    await get('/assets/AST-999999').expect(404);
    assert.ok((await get('/locations').expect(200)).body.some((k) => k.name === 'Jiren'));
    assert.ok((await get('/sectors').expect(200)).body.length === 13);
    assert.ok((await get('/categories').expect(200)).body.length >= 5);
    assert.equal((await get('/assets?page_size=1').expect(200)).body.data.length, 1);
    assert.equal((await get('/assets?status=ACTIVE').expect(200)).body.data.length, 0);
    await api('get', '/api/integration/v1/openapi.json').expect(200);
    await api('get', '/api/integration/v1/assets').expect(401);
    await get('/assets', 'jam_wrong').expect(401);
    await api('post', '/api/integration/v1/assets').set('X-API-Key', made.key).send({}).expect(404); // read-only
    await api('post', `/api/admin/api-keys/${made.id}/disable`, fx.users.super).expect(200);
    await get('/assets').expect(401);
  });

  it('ends open sessions when a password changes, an account is reset or deactivated, or an administrator says so', async () => {
    const ka = await makeUser('kebele_boss', 'KEBELE_ADMIN', { kebeles: [fx.k1] }); // a Kebele Administrator manages the Sector Administrators of its Kebele
    const target = await makeUser('target_sector', 'SECTOR_ADMIN', { sectors: [fx.construction.id], kebeles: [fx.k1] });
    const login = async (username = 'target_sector') => (await api('post', '/api/auth/login').send({ username, password: 'Correct-Horse-9' }).expect(200)).body.token;
    const bearer = (t) => ({ headers: { Authorization: `Bearer ${t}` } });
    const me = (t) => api('get', '/api/auth/me', bearer(t));

    const t1 = await login();
    const t2 = await login();
    await me(t1).expect(200);
    const changed = await api('post', '/api/auth/change-password', bearer(t1)).send({ current_password: 'Correct-Horse-9', new_password: 'Another-Long-Pass-1' }).expect(200);
    await me(t1).expect(401);
    await me(t2).expect(401);
    await me(changed.body.token).expect(200); // this browser keeps working
    const tokenAfterReset = changed.body.token;

    await api('patch', `/api/users/${target.id}`, ka).send({ password: 'Brand-New-Password-2' }).expect(200);
    await me(tokenAfterReset).expect(401);
    const t3 = (await api('post', '/api/auth/login').send({ username: 'target_sector', password: 'Brand-New-Password-2' }).expect(200)).body.token;
    await me(t3).expect(200);
    await api('post', `/api/users/${target.id}/end-sessions`, fx.users.mayor).expect(403);
    await api('post', `/api/users/${target.id}/end-sessions`, ka).expect(200);
    await me(t3).expect(401);
    const t4 = (await api('post', '/api/auth/login').send({ username: 'target_sector', password: 'Brand-New-Password-2' }).expect(200)).body.token;
    await api('patch', `/api/users/${target.id}`, ka).send({ is_active: false }).expect(200);
    await me(t4).expect(401);
  });

  it('records e-mail, phone and department for users and keeps a history of each account', async () => {
    const dep = fx.dep;
    const ka = await makeUser('kebele_boss2', 'KEBELE_ADMIN', { kebeles: [fx.k1] });
    const transport = await db('sectors').where({ code: 'TRN' }).first(); // Construction and Business already have their administrator in Kebele A
    await api('post', '/api/users', ka).send({ username: 'newuser1', full_name: 'New User', password: 'Long-Enough-Pass-1', role: 'SECTOR_ADMIN', email: 'bad', kebele_ids: [fx.k1], sector_ids: [transport.id] }).expect(400);
    const created = await api('post', '/api/users', ka).send({
      username: 'newuser1', full_name: 'New User', password: 'Long-Enough-Pass-1', role: 'SECTOR_ADMIN', email: 'new@jimma.example', phone: '+251911222333', department_id: dep, kebele_ids: [fx.k1], sector_ids: [transport.id],
    }).expect(201);
    assert.equal(created.body.email, 'new@jimma.example');
    assert.equal(created.body.department_id, dep);
    assert.equal(created.body.role_label, 'Sector Administrator');
    await api('patch', `/api/users/${created.body.id}`, ka).send({ full_name: 'Renamed Person' }).expect(200);
    await api('post', '/api/auth/login').send({ username: 'newuser1', password: 'Long-Enough-Pass-1' }).expect(200);
    const history = (await api('get', `/api/users/${created.body.id}/history`, ka)).body;
    const actions = history.map((h) => h.action);
    assert.ok(actions.includes('USER_CREATE') && actions.includes('USER_UPDATE') && actions.includes('LOGIN'));
    await api('get', `/api/users/${created.body.id}/history`, fx.users.mayor).expect(403);
    // the history page: the account itself, older entries page by page
    const one = (await api('get', `/api/users/${created.body.id}`, ka).expect(200)).body;
    assert.equal(one.full_name, 'Renamed Person');
    assert.equal(one.read_only, false);
    const older = (await api('get', `/api/users/${created.body.id}/history?before=${history[0].id}`, ka).expect(200)).body;
    assert.deepEqual(older.map((h) => h.id), history.slice(1).map((h) => h.id));
    // the edit form sends every field; only what really changed is recorded
    const form = {
      username: one.username, full_name: one.full_name, role: one.role, is_active: Boolean(one.is_active), email: one.email, phone: '+251911000000',
      kifle_ketema_ids: one.kifle_ketema_ids, kebele_ids: one.kebele_ids, sector_ids: one.sector_ids,
    };
    await api('patch', `/api/users/${created.body.id}`, ka).send(form).expect(200);
    const last = (await api('get', `/api/users/${created.body.id}/history`, ka)).body[0];
    assert.equal(last.summary, 'Updated user newuser1: phone');
    // switching the account off and on is recorded with the reason given
    await api('patch', `/api/users/${created.body.id}`, ka).send({ is_active: false, reason: 'On leave until December' }).expect(200);
    await api('post', '/api/auth/login').send({ username: 'newuser1', password: 'Long-Enough-Pass-1' }).expect(403);
    await api('patch', `/api/users/${created.body.id}`, ka).send({ is_active: true, reason: 'Back from leave' }).expect(200);
    const entries = (await api('get', `/api/users/${created.body.id}/history`, ka)).body;
    assert.equal(entries.find((h) => h.action === 'USER_DEACTIVATE').summary, 'Deactivated user newuser1: On leave until December');
    assert.equal(entries.find((h) => h.action === 'USER_REACTIVATE').summary, 'Reactivated user newuser1: Back from leave');
    assert.ok(entries.some((h) => h.action === 'LOGIN_FAILED'), 'the blocked sign-in attempt is recorded too');
    await api('post', '/api/auth/login').send({ username: 'newuser1', password: 'Long-Enough-Pass-1' }).expect(200);
  });

  it('refuses requests for the new features from people who are not signed in', async () => {
    for (const path of ['/api/requests', '/api/reservations', '/api/verification', '/api/notifications', '/api/analytics', '/api/admin/health', '/api/assets/map']) {
      await api('get', path).expect(401);
    }
  });

  it('still rejects asset input that cannot be right', async () => {
    const bad = await api('post', '/api/assets', fx.users.officer).send(assetBody(fx, { useful_life_years: 'abc', latitude: 123 })).expect(400);
    assert.ok(bad.body.details.latitude);
    assert.ok(bad.body.details.useful_life_years);
  });
});
