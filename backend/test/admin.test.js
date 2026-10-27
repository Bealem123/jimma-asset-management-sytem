import './env.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { db } from '../src/db.js';
import { app, setupFixture, api, createAsset, activateAsset, closeDb, PASSWORD } from './helpers.js';

describe('master data', () => {
  let fx;
  before(async () => { fx = await setupFixture(); });

  it('anyone signed in can read the lookups; the starting data is marked not validated', async () => {
    const res = await api('get', '/api/master/lookups', fx.users.inspector).expect(200);
    assert.equal(res.body.sectors.length, 13);
    assert.equal(res.body['kifle-ketemas'].length, 3);
    assert.ok(res.body.sectors.every((s) => s.is_validated === false));
    assert.ok(res.body['asset-categories'].length >= 7);
    await request(app).get('/api/master/lookups').expect(401);
  });

  it('only the Super Administrator can add or change master data', async () => {
    await api('post', '/api/master/kebeles', fx.users.officer).send({ name: 'X', kifle_ketema_id: fx.jiren.id }).expect(403);
    const res = await api('post', '/api/master/kebeles', fx.users.super).send({ name: 'New Kebele', kifle_ketema_id: fx.jiren.id }).expect(201);
    assert.equal(res.body.is_validated, false);
    await api('patch', `/api/master/kebeles/${res.body.id}`, fx.users.super).send({ is_validated: true }).expect(200);
    assert.equal((await db('kebeles').where({ id: res.body.id }).first()).is_validated, 1); // stored as 1
  });

  it('a partial update leaves other fields alone', async () => {
    const s = await db('sectors').where({ code: 'LND' }).first();
    await api('patch', `/api/master/sectors/${s.id}`, fx.users.super).send({ name: 'Land (renamed)' }).expect(200);
    const after = await db('sectors').where({ id: s.id }).first();
    assert.equal(after.name, 'Land (renamed)');
    assert.equal(after.description, s.description);
  });

  it('validates references and uniqueness', async () => {
    const bad = await api('post', '/api/master/kebeles', fx.users.super).send({ name: 'Orphan', kifle_ketema_id: 9999 }).expect(400);
    assert.ok(bad.body.details.kifle_ketema_id);
    await api('post', '/api/master/kebeles', fx.users.super).send({ name: 'Jiren Kebele A', kifle_ketema_id: fx.jiren.id }).expect(400);
    // names are unique City-wide, even before a Kebele is linked to its Kifle Ketema
    await api('post', '/api/master/kebeles', fx.users.super).send({ name: 'jiren' }).expect(400);
    await api('post', '/api/master/sectors', fx.users.super).send({ code: '', name: '' }).expect(400);
    await api('get', '/api/master/nothing', fx.users.super).expect(404);
  });

  it('master data changes are audited', async () => {
    assert.ok(await db('audit_logs').where({ entity: 'kebeles', action: 'CREATE' }).first());
  });

  it('an inactive category cannot be chosen for a new asset', async () => {
    const cat = await db('asset_categories').where({ name: 'Other Assets' }).first();
    await api('patch', `/api/master/asset-categories/${cat.id}`, fx.users.super).send({ is_active: false }).expect(200);
    const res = await api('post', '/api/assets', fx.users.officer)
      .send({ name: 'Misc', category_id: cat.id, sector_id: fx.construction.id, kebele_id: fx.k1 }).expect(400);
    assert.ok(res.body.details.category_id);
  });
});

describe('users', () => {
  let fx;
  before(async () => {
    fx = await setupFixture();
    // this suite creates the Hirmata Kifle Ketema Administrator itself (there is one per Kifle Ketema)
    await db('user_kifle_ketemas').where({ user_id: fx.users.hirmataAdmin.id }).del();
    await db('users').where({ id: fx.users.hirmataAdmin.id }).del();
  });

  const body = (over = {}) => ({ username: 'kifle.hirmata', full_name: 'Hirmata Admin', password: 'Another-Strong-1', role: 'KIFLE_ADMIN', ...over });

  it('only the Super Administrator, Kifle Ketema and Kebele administrators can open the user list', async () => {
    await api('get', '/api/users', fx.users.mayor).expect(403);
    await api('get', '/api/users', fx.users.officer).expect(403);
    await api('post', '/api/users', fx.users.mayor).send({}).expect(403);
    const list = await api('get', '/api/users', fx.users.super).expect(200);
    assert.equal(list.body.find((u) => u.username === 'officer'), undefined, 'the Super Administrator sees only the accounts it creates');
    assert.ok(list.body.every((u) => ['KIFLE_ADMIN', 'EXECUTIVE', 'AUDITOR', 'FINANCIAL_OFFICER', 'INSPECTOR'].includes(u.role) && !u.read_only));
    assert.equal(list.body.find((u) => u.username === 'jirenadmin').read_only, false);
    assert.ok(list.body.every((u) => u.password_hash === undefined));
  });

  it('the Super Administrator creates Kifle Ketema Administrators, who must choose their own password at first sign-in', async () => {
    const created = await api('post', '/api/users', fx.users.super).send(body({ kifle_ketema_ids: [fx.hirmata.id] })).expect(201);
    assert.deepEqual(created.body.kifle_ketema_ids, [fx.hirmata.id]);
    assert.deepEqual(created.body.kebele_ids, []);
    const first = await request(app).post('/api/auth/login').send({ username: 'kifle.hirmata', password: 'Another-Strong-1' }).expect(200);
    assert.equal(first.body.user.must_change_password, true);
    assert.equal(first.body.user.role_label, 'Kifle Ketema Administrator');
  });

  it('refuses every other role, and extra areas, when the Super Administrator creates an account', async () => {
    for (const role of ['KEBELE_ADMIN', 'SECTOR_ADMIN', 'SUPER_ADMIN']) {
      await api('post', '/api/users', fx.users.super).send(body({ username: `x.${role.toLowerCase()}`, role, kebele_ids: [fx.k1], sector_ids: [fx.construction.id] })).expect(403);
    }
    await api('post', '/api/users', fx.users.super).send(body({ username: 'god', role: 'GOD' })).expect(400);
    const noArea = await api('post', '/api/users', fx.users.super).send(body({ username: 'no.area' })).expect(400);
    assert.ok(noArea.body.details.kifle_ketema_ids);
    // a Kifle Ketema Administrator never gets a Kebele or sector, even if one is sent
    const gibe = await db('kifle_ketemas').where({ name: 'Gibe' }).first();
    const ok = await api('post', '/api/users', fx.users.super).send(body({ username: 'kifle.gibe', kifle_ketema_ids: [gibe.id], kebele_ids: [fx.k1], sector_ids: [fx.construction.id] })).expect(201);
    assert.deepEqual([ok.body.kebele_ids, ok.body.sector_ids], [[], []]);
  });

  it('rejects weak passwords, bad usernames and duplicates; one Kifle Ketema Administrator per Kifle Ketema', async () => {
    const weak = await api('post', '/api/users', fx.users.super).send(body({ username: 'abc', password: 'short', kifle_ketema_ids: [fx.jiren.id] })).expect(400);
    assert.ok(weak.body.details.password);
    await api('post', '/api/users', fx.users.super).send(body({ username: 'has space', kifle_ketema_ids: [fx.jiren.id] })).expect(400);
    const dup = await api('post', '/api/users', fx.users.super).send(body({ username: 'another', kifle_ketema_ids: [fx.jiren.id] })).expect(409);
    assert.match(dup.body.error, /already has a Kifle Ketema Administrator: jirenadmin/);
    await api('post', '/api/users', fx.users.super).send(body({ kifle_ketema_ids: [fx.hirmata.id] })).expect(409); // username taken
  });

  it('the Super Administrator resets a Kifle Ketema Administrator password, and cannot change any other account', async () => {
    const id = fx.users.jirenAdmin.id;
    await api('patch', `/api/users/${id}`, fx.users.super).send({ password: 'Reset-Password-77' }).expect(200);
    await request(app).post('/api/auth/login').send({ username: 'jirenadmin', password: PASSWORD }).expect(401);
    const ok = await request(app).post('/api/auth/login').send({ username: 'jirenadmin', password: 'Reset-Password-77' }).expect(200);
    assert.equal(ok.body.user.password, undefined);
    for (const u of [fx.users.officer, fx.users.kebeleA, fx.users.sectorAdmin]) {
      await api('patch', `/api/users/${u.id}`, fx.users.super).send({ password: 'Reset-Password-77' }).expect(404); // not its account: not even visible
      await api('post', `/api/users/${u.id}/end-sessions`, fx.users.super).expect(404);
    }
  });

  it('changes a username: the person signs in with the new one, and a name already in use is refused', async () => {
    const gibe = await db('users').where({ username: 'kifle.gibe' }).first();
    await api('patch', `/api/users/${gibe.id}`, fx.users.super).send({ username: 'bam' }).expect(200);
    await request(app).post('/api/auth/login').send({ username: 'kifle.gibe', password: 'Another-Strong-1' }).expect(401);
    await request(app).post('/api/auth/login').send({ username: 'bam', password: 'Another-Strong-1' }).expect(200);
    await api('patch', `/api/users/${gibe.id}`, fx.users.super).send({ username: 'jirenadmin' }).expect(409);
    await api('patch', `/api/users/${gibe.id}`, fx.users.super).send({ username: 'has space' }).expect(400);
    await db('users').where({ id: gibe.id }).update({ username: 'kifle.gibe' });
  });

  it('a deactivated user can no longer use their token', async () => {
    const gibe = await db('users').where({ username: 'kifle.gibe' }).first();
    const token = (await request(app).post('/api/auth/login').send({ username: 'kifle.gibe', password: 'Another-Strong-1' }).expect(200)).body.token;
    await api('get', '/api/auth/me', { headers: { Authorization: `Bearer ${token}` } }).expect(200);
    await api('patch', `/api/users/${gibe.id}`, fx.users.super).send({ is_active: false }).expect(200);
    await api('get', '/api/auth/me', { headers: { Authorization: `Bearer ${token}` } }).expect(401);
  });

  it('cannot change its own account', async () => {
    // its own account is not among the accounts it manages (each person changes their own details under My account)
    await api('patch', `/api/users/${fx.users.super.id}`, fx.users.super).send({ is_active: false }).expect(404);
    await api('patch', `/api/users/${fx.users.super.id}`, fx.users.super).send({ role: 'AUDITOR' }).expect(404);
  });
});

describe('dashboard data for the four levels', () => {
  let fx;
  before(async () => { fx = await setupFixture(); });

  it('gives every level the extra figures, and the set-up gaps only to the city-wide roles', async () => {
    for (const u of [fx.users.super, fx.users.jirenAdmin, fx.users.kebeleA, fx.users.sectorAdmin]) {
      const t = (await api('get', '/api/dashboard', u).expect(200)).body.totals;
      assert.equal(typeof t.inspection_due, 'number');
      assert.equal(typeof t.pending_by_type, 'object');
    }
    const sup = (await api('get', '/api/dashboard', fx.users.super)).body;
    assert.equal(typeof sup.setup.kebeles_without_kifle_ketema, 'number');
    assert.equal(sup.setup.kifle_ketemas_without_admin, 1, 'Gibe has no administrator; Jiren and Hirmata have one');
    assert.equal((await api('get', '/api/dashboard', fx.users.jirenAdmin)).body.setup, null);
    assert.equal((await api('get', '/api/dashboard', fx.users.sectorAdmin)).body.setup, null);
  });

  it('counts waiting requests by kind, inside the viewer own area', async () => {
    const a = await createAsset(fx, fx.users.officer, { kebele_id: fx.k1 });
    await api('post', `/api/assets/${a.id}/transfers`, fx.users.officer).send({ to_kebele_id: fx.k2, transfer_date: '2026-06-01', reason: 'x', authorized_by: 'y' }).expect(202);
    assert.equal((await api('get', '/api/dashboard', fx.users.super)).body.totals.pending_by_type.TRANSFER, 1);
    assert.equal((await api('get', '/api/dashboard', fx.users.jirenAdmin)).body.totals.pending_by_type.TRANSFER, 1);
    assert.equal((await api('get', '/api/dashboard', fx.users.nobody)).body.totals.pending_by_type.TRANSFER, undefined);
  });
});

describe('dashboard and audit log', () => {
  let fx;
  before(async () => {
    fx = await setupFixture();
    const a = await createAsset(fx, fx.users.officer, { name: 'Excavator', acquisition_cost: 8500000, condition: 'POOR' });
    await activateAsset(fx, a);
    await api('post', `/api/assets/${a.id}/utilizations`, fx.users.officer).send({
      use_type: 'EQUIPMENT_HIRE', start_date: '2026-01-01', generates_revenue: true, revenue_sector_id: fx.construction.id,
    }).expect(201);
    const tomorrow = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
    await api('post', `/api/assets/${a.id}/maintenance`, fx.users.officer).send({
      maintenance_date: '2026-02-01', maintenance_type: 'Service', cost: 45000, next_maintenance_date: tomorrow,
    }).expect(201);
    await createAsset(fx, fx.users.sectorAdmin, { name: 'Ambulance', kebele_id: fx.k3 }); // no revenue, different Kifle Ketema
  });

  it('the dashboard summarises assets, revenue vs non-revenue assets, attention and upcoming maintenance', async () => {
    const d = (await api('get', '/api/dashboard', fx.users.mayor).expect(200)).body;
    assert.equal(d.totals.assets, 2);
    assert.equal(d.totals.active, 1);
    assert.equal(d.totals.generating_revenue, 1);
    assert.equal(d.totals.not_generating_revenue, 1);
    assert.equal(d.totals.needs_attention, 1);
    assert.equal(d.totals.maintenance_cost, 45000);
    assert.equal(d.totals.acquisition_cost, 8500000);
    assert.equal(d.by_kifle_ketema.length, 2);
    assert.equal(d.by_condition.find((c) => c.key === 'POOR').n, 1);
    assert.equal(d.by_condition.find((c) => c.key === 'EXCELLENT').n, 0); // zero-count values still listed
    assert.equal(d.maintenance_due.length, 1);
    assert.equal(d.maintenance_due[0].overdue, false);
  });

  it('the money totals leave out disposed assets, as Finance does', async () => {
    const a = await db('assets').where({ name: 'Excavator' }).first();
    await db('assets').where({ id: a.id }).update({ status: 'DISPOSED' });
    try {
      const d = (await api('get', '/api/dashboard', fx.users.mayor).expect(200)).body;
      assert.equal(d.totals.acquisition_cost, 0);
      assert.equal(d.totals.maintenance_cost, 45000); // money already spent stays counted
    } finally {
      await db('assets').where({ id: a.id }).update({ status: a.status });
    }
  });

  it('waiting times count from the step a registration reached, not from its last edit', async () => {
    const a = await db('assets').where({ name: 'Ambulance' }).first();
    const longAgo = new Date(Date.now() - 20.5 * 86400000);
    await db('assets').where({ id: a.id }).update({ approval_state: 'SUBMITTED', approval_state_at: longAgo, updated_at: db.fn.now() });
    try {
      const perf = (await api('get', '/api/dashboard/performance', fx.users.mayor).expect(200)).body;
      assert.equal(perf.kifle_ketemas.find((k) => k.id === a.kifle_ketema_id).oldest_wait_days, 20); // a correction today hides nothing
    } finally {
      await db('assets').where({ id: a.id }).update({ approval_state: a.approval_state, approval_state_at: a.approval_state_at });
    }
    // each step of the chain restarts the clock
    const excavator = await db('assets').where({ name: 'Excavator' }).first();
    assert.ok(Date.now() - new Date(excavator.approval_state_at).getTime() < 3600000);
  });

  it('an asset in use that was never inspected is due for its first inspection', async () => {
    const due = async () => (await api('get', '/api/dashboard', fx.users.mayor).expect(200)).body.totals.inspection_due;
    assert.equal(await due(), 1); // the Excavator: active, never inspected (the Ambulance is not in use yet)
    const excavator = await db('assets').where({ name: 'Excavator' }).first();
    const [id] = await db('inspection_records').insert({ asset_id: excavator.id, inspection_date: '2026-03-01', inspector: 'x', condition_found: 'GOOD' });
    try {
      assert.equal(await due(), 0); // inspected, and no next date was set
    } finally {
      await db('inspection_records').where({ id }).del();
    }
  });

  it('a scoped user sees a scoped dashboard', async () => {
    const d = (await api('get', '/api/dashboard', fx.users.kebeleA).expect(200)).body;
    assert.equal(d.totals.assets, 1);
    assert.equal((await api('get', '/api/dashboard', fx.users.nobody).expect(200)).body.totals.assets, 0);
  });

  it('only administrators and auditors can read the full audit log', async () => {
    for (const u of [fx.users.officer, fx.users.mayor, fx.users.kebeleA, fx.users.inspector]) await api('get', '/api/audit', u).expect(403);
    for (const u of [fx.users.super, fx.users.auditor]) {
      const res = await api('get', '/api/audit?page_size=5', u).expect(200);
      assert.ok(res.body.total > 5);
      assert.equal(res.body.rows.length, 5);
    }
    const filtered = (await api('get', '/api/audit?action=CREATE&entity=asset', fx.users.auditor)).body;
    assert.ok(filtered.rows.every((r) => r.action === 'CREATE' && r.entity === 'asset'));
  });

  it('the Internal Auditor sees every account and the stock-takings, and changes neither', async () => {
    const users = (await api('get', '/api/users', fx.users.auditor).expect(200)).body;
    assert.equal(users.length, await db('users').count({ n: 'id' }).first().then((r) => Number(r.n)));
    assert.ok(users.every((u) => u.read_only));
    await api('get', `/api/users/${fx.users.kebeleA.id}/history`, fx.users.auditor).expect(200);
    await api('patch', `/api/users/${fx.users.kebeleA.id}`, fx.users.auditor).send({ is_active: false }).expect(403);
    await api('post', '/api/users', fx.users.auditor).send({ username: 'x.y', full_name: 'X Y', password: PASSWORD, role: 'SECTOR_ADMIN' }).expect(403);
    await api('post', `/api/users/${fx.users.kebeleA.id}/end-sessions`, fx.users.auditor).expect(403);

    await api('get', '/api/verification', fx.users.auditor).expect(200);
    await api('post', '/api/verification', fx.users.auditor).send({ name: 'Audit stock-taking' }).expect(403);
    // the Mayor, who does not audit, still sees neither
    await api('get', '/api/users', fx.users.mayor).expect(403);
    await api('get', '/api/verification', fx.users.mayor).expect(403);
  });

  it('the audit log records who did what, and exports are logged too', async () => {
    await api('get', '/api/assets/export.csv', fx.users.officer).expect(200);
    const last = await db('audit_logs').where({ action: 'EXPORT' }).orderBy('id', 'desc').first();
    assert.equal(last.username, 'officer');
  });
});

describe('API hygiene', () => {
  let fx;
  before(async () => { fx = await setupFixture(); });

  it('returns JSON errors for unknown routes, bad ids and malformed bodies', async () => {
    const r1 = await api('get', '/api/nothing-here', fx.users.officer).expect(404);
    assert.ok(r1.body.error);
    await api('get', '/api/assets/999999', fx.users.officer).expect(404);
    await api('get', '/api/assets/not-a-number', fx.users.officer).expect(404);
    const r2 = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{bad json').expect(400);
    assert.ok(r2.body.error);
  });

  it('sets security headers and does not reveal the framework', async () => {
    const res = await request(app).get('/api/health').expect(200);
    assert.equal(res.headers['x-powered-by'], undefined);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
  });

  it('does not allow SQL injection through search or sort parameters', async () => {
    await createAsset(fx, fx.users.officer);
    const res = await api('get', "/api/assets?q=' OR 1=1 --", fx.users.officer).expect(200);
    assert.equal(res.body.total, 0);
    await api('get', '/api/assets?sort=name;DROP TABLE assets', fx.users.officer).expect(400);
    assert.equal((await api('get', '/api/assets', fx.users.officer)).body.total, 1);
  });
});

after(closeDb); // one pool for the whole file
