import './env.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  addPhoto, api, activateAsset, closeDb, createAsset, makeUser, registerWithPhoto, resetDb, setupFixture, siteEvidence,
} from './helpers.js';
import { db } from '../src/db.js';
import { signToken } from '../src/middleware/auth.js';
import { planAdminAccounts, provisionAdminAccounts, temporaryPassword } from '../src/lib/provision.js';

after(closeDb);

describe('Sector administrator: one sector inside one Kebele', () => {
  let fx; let sa; let inScope; let otherKebele; let otherSector;
  before(async () => {
    fx = await setupFixture();
    // Construction sector administrator for Jiren Kebele A only
    sa = await makeUser('con_k1', 'SECTOR_ADMIN', { sectors: [fx.construction.id], kebeles: [fx.k1] });
    inScope = await createAsset(fx, fx.users.officer, { name: 'Construction in A', kebele_id: fx.k1 });
    otherKebele = await createAsset(fx, fx.users.officer, { name: 'Construction in B', kebele_id: fx.k2 }); // same Kifle Ketema, same sector
    otherSector = await createAsset(fx, fx.users.officer, { name: 'Trade in A', sector_id: fx.business.id, department_id: null, kebele_id: fx.k1 });
  });

  it('sees only that sector inside that Kebele', async () => {
    const list = (await api('get', '/api/assets', sa)).body;
    assert.deepEqual(list.rows.map((r) => r.name), ['Construction in A']);
    await api('get', `/api/assets/${inScope.id}`, sa).expect(200);
    await api('get', `/api/assets/${otherKebele.id}`, sa).expect(404); // same sector, other Kebele
    await api('get', `/api/assets/${otherSector.id}`, sa).expect(404); // same Kebele, other sector
  });

  it('cannot register or move assets outside its sector and Kebele', async () => {
    await api('post', '/api/assets', sa).send({
      name: 'x', category_id: fx.machinery.id, sector_id: fx.construction.id, kebele_id: fx.k2,
    }).expect(403);
    await api('post', '/api/assets', sa).send({
      name: 'x', category_id: fx.machinery.id, sector_id: fx.business.id, kebele_id: fx.k1,
    }).expect(403);
    const ok = await api('post', '/api/assets', sa).send({
      name: 'Own area', category_id: fx.machinery.id, sector_id: fx.construction.id, kebele_id: fx.k1,
    }).expect(201);
    assert.equal(ok.body.kifle_ketema_id, fx.jiren.id);
    await api('post', `/api/assets/${inScope.id}/transfers`, sa).send({ to_kebele_id: fx.k2, transfer_date: '2026-06-01', reason: 'x', authorized_by: 'y' }).expect(403);
  });

  it('only sees its own slice in dashboard numbers, the asset export and approval requests', async () => {
    const dash = (await api('get', '/api/dashboard', sa)).body;
    assert.equal(dash.totals.assets, 2); // Construction in A + Own area
    const csv = (await api('get', '/api/assets/export.csv', sa).expect(200)).text;
    assert.ok(csv.includes('Construction in A') && csv.includes('Own area'));
    assert.ok(!csv.includes('Construction in B') && !csv.includes('Trade in A')); // other Kebele, other sector
    const req = await api('post', `/api/assets/${otherKebele.id}/transfers`, fx.users.officer).send({ to_kebele_id: fx.k1, transfer_date: '2026-06-01', reason: 'x', authorized_by: 'y' }).expect(202);
    const waiting = (await api('get', '/api/requests?open=1', sa)).body;
    assert.ok(!waiting.some((r) => r.id === req.body.request.id));
    await api('post', `/api/requests/${req.body.request.id}/approve`, sa).expect(403); // a Sector Administrator requests, it does not decide
  });

  it('a sector administrator without a Kebele still covers the sector in every Kebele (older accounts)', async () => {
    const wide = await makeUser('con_all', 'SECTOR_ADMIN', { sectors: [fx.construction.id] });
    const names = (await api('get', '/api/assets', wide)).body.rows.map((r) => r.name).sort();
    assert.deepEqual(names, ['Construction in A', 'Construction in B', 'Own area']);
  });
});

describe('Kebele administrator', () => {
  let fx; let ka;
  before(async () => {
    fx = await setupFixture();
    ka = await makeUser('kebele_admin_a', 'KEBELE_ADMIN', { kebeles: [fx.k1] });
  });

  it('verifies assets in its own Kebele only: it reviews, it does not register or approve', async () => {
    const mine = await createAsset(fx, fx.users.officer, { kebele_id: fx.k1 });
    const other = await createAsset(fx, fx.users.officer, { kebele_id: fx.k2 });
    await api('get', `/api/assets/${other.id}`, ka).expect(404);
    await addPhoto(mine, fx.users.officer);
    await api('post', `/api/assets/${mine.id}/workflow`, fx.users.officer).send({ action: 'submit' }).expect(200);
    await api('post', `/api/assets/${mine.id}/workflow`, ka).send({ action: 'review', evidence: await siteEvidence(mine, ka) }).expect(200);
    await api('post', `/api/assets/${mine.id}/workflow`, ka).send({ action: 'approve' }).expect(403); // the Kifle Ketema Administrator approves
    await api('post', `/api/assets/${mine.id}/workflow`, fx.users.jirenAdmin).send({ action: 'approve' }).expect(200);
    await api('post', `/api/assets/${mine.id}/workflow`, ka).send({ action: 'activate' }).expect(403);
    await api('post', `/api/assets/${mine.id}/workflow`, fx.users.jirenAdmin).send({ action: 'activate' }).expect(200);
    assert.equal((await api('get', `/api/assets/${mine.id}`, ka)).body.asset.approval_state, 'ACTIVE');
  });

  it('cannot register assets (the Sector Administrator registers) or decide requests (the Kifle Ketema Administrator decides)', async () => {
    await api('post', '/api/assets', ka).send({ name: 'Mine', category_id: fx.machinery.id, sector_id: fx.construction.id, kebele_id: fx.k1 }).expect(403);
    const a = await createAsset(fx, fx.users.officer, { kebele_id: fx.k1 });
    const t = await api('post', `/api/assets/${a.id}/transfers`, fx.users.officer).send({ to_kebele_id: fx.k2, transfer_date: '2026-06-01', reason: 'x', authorized_by: 'y' }).expect(202);
    await api('post', `/api/requests/${t.body.request.id}/approve`, ka).expect(403);
    await api('post', `/api/requests/${t.body.request.id}/approve`, fx.users.jirenAdmin).expect(200);
  });

  it('has the Kebele Administrator label and verifier permissions', async () => {
    const me = (await api('get', '/api/auth/me', ka)).body.user;
    assert.equal(me.role_label, 'Kebele Administrator');
    for (const p of ['asset.review', 'verification.manage', 'user.manage_sector_admins']) assert.ok(me.permissions.includes(p), p);
    for (const p of ['asset.create', 'asset.approve', 'request.decide', 'maintenance.record', 'inspection.record', 'user.manage']) assert.ok(!me.permissions.includes(p), p);
  });
});

describe('creating the 186 administrator accounts', () => {
  before(async () => { await resetDb(); });

  it('plans exactly 1 + 3 + 13 + (13 x 13 = 169) = 186 accounts on an empty system', async () => {
    const plan = await planAdminAccounts();
    const count = (role) => plan.filter((p) => p.role === role).length;
    assert.equal(plan.length, 186);
    assert.equal(count('SUPER_ADMIN'), 1);
    assert.equal(count('KIFLE_ADMIN'), 3);
    assert.equal(count('KEBELE_ADMIN'), 13);
    assert.equal(count('SECTOR_ADMIN'), 169);
    assert.equal(new Set(plan.map((p) => p.username)).size, 186, 'usernames are unique');
    assert.ok(plan.every((p) => /^[a-z0-9._-]{3,}$/.test(p.username)));
  });

  let result;
  it('creates them with the right scope, a temporary password and a forced change', async () => {
    result = await provisionAdminAccounts();
    assert.equal(result.created.length, 186);
    assert.equal(await db('users').count({ n: 'id' }).first().then((r) => Number(r.n)), 186);
    const scopeOf = async (username) => {
      const u = await db('users').where({ username }).first();
      return {
        u,
        kifle: await db('user_kifle_ketemas').where({ user_id: u.id }).pluck('kifle_ketema_id'),
        kebeles: await db('user_kebeles').where({ user_id: u.id }).pluck('kebele_id'),
        sectors: await db('user_sectors').where({ user_id: u.id }).pluck('sector_id'),
      };
    };
    // super administrator: whole city, no area
    const sup = await scopeOf('superadmin');
    assert.equal(sup.u.role, 'SUPER_ADMIN');
    assert.deepEqual([sup.kifle, sup.kebeles, sup.sectors], [[], [], []]);
    // one administrator per Kifle Ketema
    const jiren = await db('kifle_ketemas').where({ name: 'Jiren' }).first();
    const k = await scopeOf('kifle.jiren');
    assert.equal(k.u.role, 'KIFLE_ADMIN');
    assert.deepEqual(k.kifle, [jiren.id]);
    // one administrator per Kebele (all 13 names)
    const kebeleAdmins = await db('users').where({ role: 'KEBELE_ADMIN' });
    assert.equal(kebeleAdmins.length, 13);
    const seto = await scopeOf('kebele.seto-semero');
    assert.equal(seto.kebeles.length, 1);
    assert.equal((await db('kebeles').where({ id: seto.kebeles[0] }).first()).name, 'Seto Semero');
    // one administrator per sector and Kifle Ketema
    const sa = await scopeOf('sector.con.seto-semero');
    assert.equal(sa.u.role, 'SECTOR_ADMIN');
    assert.equal(sa.sectors.length, 1);
    assert.equal(sa.kebeles.length, 1);
    assert.equal(sa.kifle.length, 0, 'a Sector Administrator belongs to a Kebele, whichever Kifle Ketema that is in');
    assert.equal((await db('sectors').where({ id: sa.sectors[0] }).first()).code, 'CON');
    assert.equal((await db('kebeles').where({ id: sa.kebeles[0] }).first()).name, 'Seto Semero');
    // every Kebele has all 13 sector administrators
    const perKebele = await db('user_kebeles as k').join('users as u', 'u.id', 'k.user_id').where('u.role', 'SECTOR_ADMIN').groupBy('k.kebele_id').count({ n: 'u.id' });
    assert.equal(perKebele.length, 13);
    assert.ok(perKebele.every((r) => Number(r.n) === 13));
    const pairs = new Set((await db('users').where({ role: 'SECTOR_ADMIN' })).map((u) => u.username));
    assert.equal(pairs.size, 169);
    assert.ok((await db('users')).every((u) => u.must_change_password && u.is_active && u.password_hash.startsWith('$2')));
  });

  it('gives every account its own strong, readable temporary password, and stores only a hash', () => {
    const pw = result.created.map((c) => c.password);
    assert.equal(new Set(pw).size, 186);
    assert.ok(pw.every((p) => /^[A-Za-z2-9]{14}$/.test(p) && !/[0OIl1]/.test(p)));
    assert.equal(temporaryPassword(20).length, 20);
  });

  it('is safe to run again: it creates nothing and leaves passwords alone', async () => {
    const before = await db('users').select('id', 'password_hash');
    const again = await provisionAdminAccounts();
    assert.equal(again.created.length, 0);
    assert.equal(again.skipped.length, 185); // the Super Administrator already exists, so it is not planned again
    assert.equal(again.planned, 185);
    assert.deepEqual(await db('users').select('id', 'password_hash'), before);
  });

  it('records the creation in the audit trail', async () => {
    assert.equal(await db('audit_logs').where({ action: 'USER_CREATE' }).count({ n: 'id' }).first().then((r) => Number(r.n)), 186);
  });

  it('forces a new password at first sign-in; nothing else works until it is changed', async () => {
    const who = result.created.find((c) => c.username === 'kebele.jiren');
    const login = await api('post', '/api/auth/login').send({ username: 'kebele.jiren', password: who.password }).expect(200);
    assert.equal(login.body.user.must_change_password, true);
    assert.equal(login.body.user.role_label, 'Kebele Administrator');
    const auth = { headers: { Authorization: `Bearer ${login.body.token}` } };
    await api('get', '/api/auth/me', auth).expect(200);
    const blocked = await api('get', '/api/assets', auth).expect(403);
    assert.match(blocked.body.error, /new password/);
    await api('get', '/api/dashboard', auth).expect(403);
    await api('post', '/api/auth/change-password', auth).send({ current_password: who.password, new_password: 'short' }).expect(400);
    const changed = await api('post', '/api/auth/change-password', auth).send({ current_password: who.password, new_password: 'My-Own-Strong-Pass-7' }).expect(200);
    const fresh = { headers: { Authorization: `Bearer ${changed.body.token}` } };
    await api('get', '/api/assets', fresh).expect(200);
    await api('post', '/api/auth/login').send({ username: 'kebele.jiren', password: who.password }).expect(401);
    const again = await api('post', '/api/auth/login').send({ username: 'kebele.jiren', password: 'My-Own-Strong-Pass-7' }).expect(200);
    assert.equal(again.body.user.must_change_password, false);
  });

  it('a password set by a Super Administrator is temporary too', async () => {
    const admin = result.created.find((c) => c.username === 'superadmin');
    const login = await api('post', '/api/auth/login').send({ username: 'superadmin', password: admin.password }).expect(200);
    const auth = { headers: { Authorization: `Bearer ${login.body.token}` } };
    const changed = await api('post', '/api/auth/change-password', auth).send({ current_password: admin.password, new_password: 'Super-Strong-Pass-1' }).expect(200);
    const sa = { headers: { Authorization: `Bearer ${changed.body.token}` } };
    const target = await db('users').where({ username: 'kifle.gibe' }).first();
    await api('patch', `/api/users/${target.id}`, sa).send({ password: 'Reset-By-Admin-9' }).expect(200);
    assert.equal((await db('users').where({ id: target.id }).first()).must_change_password, 1);
  });

  it('does not create a second Super Administrator when one exists', async () => {
    await resetDb();
    await makeUser('existing_super', 'SUPER_ADMIN');
    const plan = await planAdminAccounts();
    assert.equal(plan.length, 185);
    assert.ok(!plan.some((p) => p.role === 'SUPER_ADMIN'));
  });
});

describe('the hierarchy end to end: Super Admin -> Kifle Ketema -> Kebele -> Sector', () => {
  const as = {};
  let gibe; let jirenKifle; let hirmata; let kebJiren; let kebHirmata; let kebSeto; let asset;
  const login = async (username) => {
    const u = await db('users').where({ username }).first();
    await db('users').where({ id: u.id }).update({ must_change_password: false });
    return { id: u.id, username, headers: { Authorization: `Bearer ${signToken({ id: u.id })}` } };
  };

  before(async () => {
    await resetDb();
    await provisionAdminAccounts();
    for (const n of ['superadmin', 'kifle.jiren', 'kifle.gibe', 'kebele.jiren', 'kebele.hirmata', 'sector.con.jiren', 'sector.agr.jiren', 'sector.con.hirmata']) as[n] = await login(n);
    [jirenKifle, hirmata, gibe] = await Promise.all(['Jiren', 'Hirmata', 'Gibe'].map((n) => db('kifle_ketemas').where({ name: n }).first()));
    [kebJiren, kebHirmata, kebSeto] = await Promise.all(['Jiren', 'Hirmata', 'Seto Semero'].map((n) => db('kebeles').where({ name: n }).first()));
  });

  it('starts with the 13 Kebeles not yet assigned to any Kifle Ketema', async () => {
    assert.equal(await db('kebeles').whereNull('kifle_ketema_id').count({ n: 'id' }).first().then((r) => Number(r.n)), 13);
    // no asset can be registered until the Super Administrator has done the assignment
    const cat = await db('asset_categories').first();
    const sector = await db('sectors').where({ code: 'CON' }).first();
    const res = await api('post', '/api/assets', as['sector.con.jiren']).send({ name: 'Excavator', category_id: cat.id, sector_id: sector.id, kebele_id: kebJiren.id }).expect(400);
    // the Super Administrator oversees but does not register assets
    await api('post', '/api/assets', as.superadmin).send({ name: 'Excavator', category_id: cat.id, sector_id: sector.id, kebele_id: kebJiren.id }).expect(403);
    assert.match(JSON.stringify(res.body), /not yet linked to a Kifle Ketema/);
  });

  it('the Kebeles are assigned unevenly: the design does not depend on an equal split', async () => {
    // Jiren: 2 Kebeles, Hirmata: 1 Kebele, Gibe: 1 Kebele (the rest are still unassigned)
    const second = await db('kebeles').where({ name: 'Ginjo' }).first();
    for (const [k, kifle] of [[kebJiren, jirenKifle], [second, jirenKifle], [kebHirmata, hirmata], [kebSeto, gibe]]) {
      await api('patch', `/api/master/kebeles/${k.id}`, as.superadmin).send({ kifle_ketema_id: kifle.id }).expect(200);
    }
    // only the Super Administrator can assign
    await api('patch', `/api/master/kebeles/${kebJiren.id}`, as['kifle.jiren']).send({ kifle_ketema_id: gibe.id }).expect(403);
    await api('patch', `/api/master/kebeles/${kebJiren.id}`, as['kebele.jiren']).send({ kifle_ketema_id: gibe.id }).expect(403);
  });

  it('every asset carries its sector, Kifle Ketema and Kebele, and each tier sees its own part', async () => {
    const cat = await db('asset_categories').where({ name: 'Machinery & Equipment' }).first();
    const sector = await db('sectors').where({ code: 'CON' }).first();
    const created = await api('post', '/api/assets', as['sector.con.jiren']).send({ // the Construction Sector Administrator of that Kebele registers
      name: 'Excavator', category_id: cat.id, sector_id: sector.id, kebele_id: kebJiren.id, condition: 'GOOD', ownership_type: 'OWNED',
    }).expect(201);
    asset = created.body;
    assert.match(asset.asset_code, /^AST-\d{6}$/);
    assert.equal(asset.sector_id, sector.id);
    assert.equal(asset.kebele_id, kebJiren.id);
    assert.equal(asset.kifle_ketema_id, jirenKifle.id);
    assert.equal(asset.owner_name, 'Jiren Kebele'); // a Sector Administrator registers for its Kebele, the legal owner
    const sees = async (who) => (await api('get', `/api/assets/${asset.id}`, as[who])).status === 200;
    assert.equal(await sees('superadmin'), true);
    assert.equal(await sees('kifle.jiren'), true);
    assert.equal(await sees('kifle.gibe'), false);
    assert.equal(await sees('kebele.jiren'), true);
    assert.equal(await sees('kebele.hirmata'), false);
    assert.equal(await sees('sector.con.jiren'), true);
    assert.equal(await sees('sector.agr.jiren'), false); // same Kebele, other sector
    assert.equal(await sees('sector.con.hirmata'), false); // same sector, other Kebele
  });

  it('a Kifle Ketema Administrator sees the Kebele and Sector administrators of its own Kebeles, and nobody else', async () => {
    const list = (await api('get', '/api/users', as['kifle.jiren']).expect(200)).body;
    const names = list.map((u) => u.username);
    assert.ok(names.includes('kebele.jiren'));
    assert.ok(names.includes('sector.con.jiren') && names.includes('sector.agr.jiren'));
    assert.ok(!names.includes('kebele.hirmata') && !names.includes('sector.con.hirmata') && !names.includes('kifle.gibe') && !names.includes('superadmin'));
    assert.equal(list.find((u) => u.username === 'kebele.jiren').read_only, false);
    assert.equal(list.find((u) => u.username === 'sector.con.jiren').read_only, true);
    assert.equal(list.length, 2 * 14, 'two Kebeles: one Kebele Administrator and 13 Sector Administrators each');
  });

  it('a Kifle Ketema Administrator manages Kebele Administrators of its Kifle Ketema only', async () => {
    const kj = as['kifle.jiren'];
    const target = await db('users').where({ username: 'kebele.jiren' }).first();
    await api('patch', `/api/users/${target.id}`, kj).send({ full_name: 'Renamed Kebele Admin' }).expect(200);
    await api('patch', `/api/users/${target.id}`, kj).send({ password: 'Reset-By-Kifle-Admin-1' }).expect(200);
    assert.equal(Boolean((await db('users').where({ id: target.id }).first()).must_change_password), true);
    // outside its Kifle Ketema: not even visible
    const other = await db('users').where({ username: 'kebele.hirmata' }).first();
    await api('patch', `/api/users/${other.id}`, kj).send({ full_name: 'x' }).expect(404);
    await api('post', `/api/users/${other.id}/end-sessions`, kj).expect(404);
    // Sector Administrators can be seen but not changed; neither can its own Kifle Ketema Administrator or a role it may not create
    const sector = await db('users').where({ username: 'sector.con.jiren' }).first();
    await api('patch', `/api/users/${sector.id}`, kj).send({ full_name: 'x' }).expect(403);
    const body = { full_name: 'New Person', password: 'Long-Enough-Pass-1', kebele_ids: [kebJiren.id] };
    await api('post', '/api/users', kj).send({ ...body, username: 'new.sector', role: 'SECTOR_ADMIN', sector_ids: [1] }).expect(403);
    await api('post', '/api/users', kj).send({ ...body, username: 'new.kifle', role: 'KIFLE_ADMIN' }).expect(403);
    // cannot give a Kebele outside its Kifle Ketema
    await api('post', '/api/users', kj).send({ ...body, username: 'new.keb', role: 'KEBELE_ADMIN', kebele_ids: [kebHirmata.id] }).expect(403);
    // each Kebele has one Kebele Administrator
    const dup = await api('post', '/api/users', kj).send({ ...body, username: 'new.keb', role: 'KEBELE_ADMIN' }).expect(409);
    assert.match(dup.body.error, /already has a Kebele Administrator: kebele.jiren/);
    // replacing one: deactivate the old account first, then create the new one
    await api('patch', `/api/users/${target.id}`, kj).send({ is_active: false }).expect(200);
    const made = await api('post', '/api/users', kj).send({ ...body, username: 'new.keb', role: 'KEBELE_ADMIN' }).expect(201);
    assert.deepEqual(made.body.kebele_ids, [kebJiren.id]);
    assert.deepEqual(made.body.kifle_ketema_ids, []);
    assert.equal(Boolean(made.body.must_change_password), true);
    // and the old one cannot be switched back on while the new one is active
    await api('patch', `/api/users/${target.id}`, kj).send({ is_active: true }).expect(409);
  });

  it('a Sector Administrator cannot manage users; the Super Administrator sees every account but manages only Kifle Ketema Administrators', async () => {
    await api('get', '/api/users', as['sector.con.hirmata']).expect(403);
    const all = (await api('get', '/api/users', as.superadmin).expect(200)).body;
    assert.equal(all.length, 187); // the 186 accounts plus new.keb
    assert.deepEqual(all.filter((u) => !u.read_only).map((u) => u.role), ['KIFLE_ADMIN', 'KIFLE_ADMIN', 'KIFLE_ADMIN']);
    const kebele = await db('users').where({ username: 'kebele.hirmata' }).first();
    await api('patch', `/api/users/${kebele.id}`, as.superadmin).send({ full_name: 'x' }).expect(403);
    await api('post', '/api/users', as.superadmin).send({ username: 'late.kebele', full_name: 'x', password: 'Long-Enough-Pass-1', role: 'KEBELE_ADMIN', kebele_ids: [kebHirmata.id] }).expect(403);
    await api('post', '/api/users', as.superadmin).send({ username: 'late.sector', full_name: 'x', password: 'Long-Enough-Pass-1', role: 'SECTOR_ADMIN', kebele_ids: [kebHirmata.id], sector_ids: [1] }).expect(403);
  });

  it('the Super Administrator creates the Mayor / Executive accounts: read-only and city-wide, with no assigned area', async () => {
    const body = { username: 'mayor', full_name: 'Mayor of Jimma', password: 'Long-Enough-Pass-1', role: 'EXECUTIVE', kifle_ketema_ids: [hirmata.id], kebele_ids: [kebHirmata.id], sector_ids: [1] };
    // nobody below the Super Administrator may create one
    for (const who of ['kifle.jiren', 'kebele.hirmata']) await api('post', '/api/users', as[who]).send(body).expect(403);
    const made = await api('post', '/api/users', as.superadmin).send(body).expect(201);
    assert.deepEqual([made.body.kifle_ketema_ids, made.body.kebele_ids, made.body.sector_ids], [[], [], []]);
    assert.equal(Boolean(made.body.must_change_password), true);
    const listed = (await api('get', '/api/users', as.superadmin).expect(200)).body.find((u) => u.username === 'mayor');
    assert.equal(listed.read_only, false);
    // the City has one Mayor: a second one is refused while the first is active
    const second = await api('post', '/api/users', as.superadmin).send({ ...body, username: 'deputy.mayor' }).expect(409);
    assert.match(second.body.error, /already has a Mayor \/ Executive: mayor/);
    // the Super Administrator manages it like a Kifle Ketema Administrator
    await api('patch', `/api/users/${made.body.id}`, as.superadmin).send({ full_name: 'Renamed Mayor', kebele_ids: [kebJiren.id] }).expect(200);
    assert.deepEqual((await db('user_kebeles').where({ user_id: made.body.id })), []);
    // the Mayor sees the whole City and changes nothing
    const mayor = await login('mayor');
    await api('get', '/api/users', mayor).expect(403);
    const cat = await db('asset_categories').first();
    await api('post', '/api/assets', mayor).send({ name: 'x', category_id: cat.id, sector_id: 1, kebele_id: kebJiren.id }).expect(403);
    await api('get', '/api/assets', mayor).expect(200);
    // a new Mayor: deactivate the old account, then create the new one; the old one cannot come back beside it
    await api('patch', `/api/users/${made.body.id}`, as.superadmin).send({ is_active: false }).expect(200);
    await api('post', '/api/users', as.superadmin).send({ ...body, username: 'new.mayor' }).expect(201);
    await api('patch', `/api/users/${made.body.id}`, as.superadmin).send({ is_active: true }).expect(409);
  });

  it('the Super Administrator creates the Internal Auditor (city-wide), and the Financial Officers and Inspectors of one or more Kifle Ketemas', async () => {
    const body = { full_name: 'Specialist', password: 'Long-Enough-Pass-1', kifle_ketema_ids: [hirmata.id], kebele_ids: [kebHirmata.id], sector_ids: [1] };
    const roles = ['AUDITOR', 'FINANCIAL_OFFICER', 'INSPECTOR'];
    // nobody below the Super Administrator may create them
    for (const role of roles) {
      for (const who of ['kifle.jiren', 'kebele.hirmata']) await api('post', '/api/users', as[who]).send({ ...body, username: `x.${role}`, role }).expect(403);
    }
    // the Internal Auditor sees the whole City by role: no assigned area
    const auditor = await api('post', '/api/users', as.superadmin).send({ ...body, username: 'city.auditor', role: 'AUDITOR' }).expect(201);
    assert.deepEqual([auditor.body.kifle_ketema_ids, auditor.body.kebele_ids, auditor.body.sector_ids], [[], [], []]);
    // the City has one Internal Auditor: a second one waits until the first is deactivated
    const second = await api('post', '/api/users', as.superadmin).send({ ...body, username: 'second.auditor', role: 'AUDITOR' }).expect(409);
    assert.match(second.body.error, /already has an Internal Auditor: city.auditor/);
    await api('patch', `/api/users/${auditor.body.id}`, as.superadmin).send({ is_active: false }).expect(200);
    await api('post', '/api/users', as.superadmin).send({ ...body, username: 'second.auditor', role: 'AUDITOR' }).expect(201);
    await api('patch', `/api/users/${auditor.body.id}`, as.superadmin).send({ is_active: true }).expect(409);
    // a Financial Officer and an Inspector cover whole Kifle Ketemas: at least one, and no Kebele or sector of their own
    for (const role of ['FINANCIAL_OFFICER', 'INSPECTOR']) {
      const none = await api('post', '/api/users', as.superadmin).send({ ...body, username: `none.${role}`, role, kifle_ketema_ids: [] }).expect(400);
      assert.ok(none.body.details.kifle_ketema_ids);
    }
    const finance = await api('post', '/api/users', as.superadmin).send({ ...body, username: 'finance.jh', role: 'FINANCIAL_OFFICER', kifle_ketema_ids: [jirenKifle.id, hirmata.id] }).expect(201);
    assert.deepEqual([[...finance.body.kifle_ketema_ids].sort(), finance.body.kebele_ids, finance.body.sector_ids], [[jirenKifle.id, hirmata.id].sort(), [], []]);
    const inspector = await api('post', '/api/users', as.superadmin).send({ ...body, username: 'inspector.gibe', role: 'INSPECTOR', kifle_ketema_ids: [gibe.id] }).expect(201);
    assert.deepEqual(inspector.body.kifle_ketema_ids, [gibe.id]);
    // unlike the Internal Auditor, there can be several of them (e.g. one per Kifle Ketema)
    await api('post', '/api/users', as.superadmin).send({ ...body, username: 'finance.gibe', role: 'FINANCIAL_OFFICER', kifle_ketema_ids: [gibe.id] }).expect(201);
    // the Super Administrator manages all three; the levels below do not even see them
    const listed = (await api('get', '/api/users', as.superadmin).expect(200)).body.filter((u) => roles.includes(u.role));
    assert.deepEqual(listed.map((u) => [u.username, u.read_only]).sort(), [
      ['city.auditor', false], ['finance.gibe', false], ['finance.jh', false], ['inspector.gibe', false], ['second.auditor', false],
    ]);
    const kifleList = (await api('get', '/api/users', as['kifle.jiren']).expect(200)).body;
    assert.ok(!kifleList.some((u) => roles.includes(u.role)));
    // each does its own job only
    const cat = await db('asset_categories').first();
    const asset = { name: 'x', category_id: cat.id, sector_id: 1, kebele_id: kebJiren.id };
    for (const username of ['second.auditor', 'finance.jh', 'inspector.gibe']) {
      const who = await login(username);
      await api('get', '/api/users', who).expect(403);
      await api('post', '/api/assets', who).send(asset).expect(403);
      await api('get', '/api/assets', who).expect(200);
    }
    await api('get', '/api/audit', await login('second.auditor')).expect(200);
    await api('get', '/api/audit', await login('finance.jh')).expect(403);
    await api('get', '/api/audit', await login('inspector.gibe')).expect(403);
  });

  it('a Kebele Administrator sees and manages the Sector Administrators of its own Kebele only', async () => {
    const kh = as['kebele.hirmata'];
    const list = (await api('get', '/api/users', kh).expect(200)).body;
    assert.equal(list.length, 13, 'one Sector Administrator per sector');
    assert.ok(list.every((u) => u.role === 'SECTOR_ADMIN' && u.read_only === false && u.kebele_ids.length === 1 && u.kebele_ids[0] === kebHirmata.id));
    const mine = await db('users').where({ username: 'sector.con.hirmata' }).first();
    await api('patch', `/api/users/${mine.id}`, kh).send({ password: 'Reset-By-Kebele-Admin-1' }).expect(200);
    assert.equal(Boolean((await db('users').where({ id: mine.id }).first()).must_change_password), true);
    // a sector in another Kebele is not even visible
    const other = await db('users').where({ username: 'sector.con.jiren' }).first();
    await api('patch', `/api/users/${other.id}`, kh).send({ full_name: 'x' }).expect(404);
    await api('post', `/api/users/${other.id}/end-sessions`, kh).expect(404);
    // nor can it touch accounts above it
    const above = await db('users').where({ username: 'kifle.hirmata' }).first();
    await api('patch', `/api/users/${above.id}`, kh).send({ full_name: 'x' }).expect(404);
  });

  it('one Sector Administrator per sector in a Kebele, exactly one sector and one Kebele each', async () => {
    const kh = as['kebele.hirmata'];
    const sector = await db('sectors').where({ code: 'CON' }).first();
    const body = { username: 'dup.sector', full_name: 'Dup', password: 'Long-Enough-Pass-1', role: 'SECTOR_ADMIN' };
    await api('post', '/api/users', kh).send({ ...body, sector_ids: [sector.id], kebele_ids: [kebJiren.id] }).expect(403); // not its Kebele
    await api('post', '/api/users', kh).send({ ...body, sector_ids: [sector.id], kebele_ids: [kebHirmata.id, kebJiren.id] }).expect(403);
    const none = await api('post', '/api/users', kh).send({ ...body, kebele_ids: [kebHirmata.id] }).expect(400);
    assert.ok(none.body.details.sector_ids);
    const dup = await api('post', '/api/users', kh).send({ ...body, sector_ids: [sector.id], kebele_ids: [kebHirmata.id] }).expect(409);
    assert.match(dup.body.error, /already has a Sector Administrator: sector.con.hirmata/);
    // other roles are not its to create
    await api('post', '/api/users', kh).send({ ...body, role: 'KEBELE_ADMIN', kebele_ids: [kebHirmata.id] }).expect(403);
    await api('post', '/api/users', kh).send({ ...body, role: 'INSPECTOR', kebele_ids: [kebHirmata.id] }).expect(403);
    // replacing one: deactivate the old account, then create the new one with no Kifle Ketema of its own
    const old = await db('users').where({ username: 'sector.con.hirmata' }).first();
    await api('patch', `/api/users/${old.id}`, kh).send({ is_active: false }).expect(200);
    const made = await api('post', '/api/users', kh).send({ ...body, sector_ids: [sector.id], kebele_ids: [kebHirmata.id], kifle_ketema_ids: [gibe.id] }).expect(201);
    assert.deepEqual([made.body.sector_ids, made.body.kebele_ids, made.body.kifle_ketema_ids], [[sector.id], [kebHirmata.id], []]);
    const kifle = await api('post', '/api/users', as.superadmin).send({ username: 'two.kifle', full_name: 'x', password: 'Long-Enough-Pass-1', role: 'KIFLE_ADMIN', kifle_ketema_ids: [jirenKifle.id, hirmata.id] }).expect(400);
    assert.ok(kifle.body.details.kifle_ketema_ids);
  });

  it('the registration chain: the Sector Administrator registers, the Kebele Administrator verifies, the Kifle Ketema Administrator approves and activates', async () => {
    const cat = await db('asset_categories').where({ name: 'Machinery & Equipment' }).first();
    const sector = await db('sectors').where({ code: 'CON' }).first();
    const sa = as['sector.con.jiren']; const kebeleAdmin = await login('new.keb'); const kifleAdmin = as['kifle.jiren'];
    const body = { name: 'Grader', category_id: cat.id, sector_id: sector.id, kebele_id: kebJiren.id, submit: true, details: { con_kind: 'Construction machine' } };
    // nobody above or beside the Sector Administrator registers
    for (const who of [kebeleAdmin, kifleAdmin, as.superadmin]) await api('post', '/api/assets', who).send(body).expect(403);
    const made = await registerWithPhoto(sa, { ...body, owner_name: 'Someone else', responsible_officer: 'Typed name' }).expect(201);
    assert.equal(made.body.approval_state, 'SUBMITTED');
    // owner, responsible office and officer are not typed: the Kebele, the sector and the Sector Administrator
    const registrar = await db('users').where({ username: 'sector.con.jiren' }).first();
    assert.deepEqual([made.body.owner_name, made.body.responsible_office, made.body.responsible_officer], ['Jiren Kebele', sector.name, registrar.full_name]);
    const step = (who, action) => api('post', `/api/assets/${made.body.id}/workflow`, who).send({ action });
    // each step belongs to one level
    await step(sa, 'review').expect(403);
    await step(kifleAdmin, 'review').expect(403);
    await step(as.superadmin, 'review').expect(403);
    await api('post', `/api/assets/${made.body.id}/workflow`, kebeleAdmin).send({ action: 'review', evidence: await siteEvidence(made.body, kebeleAdmin) }).expect(200); // verified on site
    await step(kebeleAdmin, 'approve').expect(403);
    await step(sa, 'approve').expect(403);
    await step(kifleAdmin, 'approve').expect(200);
    await step(kifleAdmin, 'activate').expect(200);
    const row = await db('assets').where({ id: made.body.id }).first();
    assert.equal(row.approval_state, 'ACTIVE');
    assert.equal(row.status, 'ACTIVE');
  });

  it('moving a Kebele to another Kifle Ketema moves its assets with it', async () => {
    await api('patch', `/api/master/kebeles/${kebJiren.id}`, as.superadmin).send({ kifle_ketema_id: gibe.id }).expect(200);
    assert.equal((await db('assets').where({ id: asset.id }).first()).kifle_ketema_id, gibe.id);
    assert.equal((await api('get', `/api/assets/${asset.id}`, as['kifle.gibe'])).status, 200);
    assert.equal((await api('get', `/api/assets/${asset.id}`, as['kifle.jiren'])).status, 404);
    // the Kebele cannot be left without a Kifle Ketema while it holds assets
    const res = await api('patch', `/api/master/kebeles/${kebJiren.id}`, as.superadmin).send({ kifle_ketema_id: null }).expect(400);
    assert.match(JSON.stringify(res.body), /already has 2 assets/);
    // the Kebele Administrator and Sector Administrator of that Kebele do not change
    assert.equal((await api('get', `/api/assets/${asset.id}`, await login('new.keb'))).status, 200); // the replacement Kebele Administrator
    assert.equal((await api('get', `/api/assets/${asset.id}`, as['sector.con.jiren'])).status, 200);
  });

  it('the side-menu queue and the performance of each area follow each level and its own area', async () => {
    const cat = await db('asset_categories').first();
    const sector = await db('sectors').where({ code: 'CON' }).first();
    await registerWithPhoto(as['sector.con.jiren'], { name: 'Waiting grader', category_id: cat.id, sector_id: sector.id, kebele_id: kebJiren.id, submit: true, details: { con_kind: 'Construction machine' } }).expect(201);
    const kebeleAdmin = await login('new.keb');
    const mayor = await login('new.mayor');
    const waiting = async (where) => Number((await db('assets').where(where).whereNull('archived_at').whereNot('status', 'DISPOSED').count({ n: 'id' }).first()).n);
    // the queue holds only the user's own next step; the Mayor has none
    const kq = (await api('get', '/api/dashboard/queue', kebeleAdmin).expect(200)).body;
    assert.ok(kq.approvals >= 1);
    assert.equal(kq.approvals, await waiting({ kebele_id: kebJiren.id, approval_state: 'SUBMITTED' }));
    assert.deepEqual((await api('get', '/api/dashboard/queue', mayor).expect(200)).body, { approvals: 0, verification: 0, monthly: 0 });
    // the Mayor sees every Kifle Ketema with the administrator who answers for it, and no Kebele: each Kifle Ketema follows its own
    const all = (await api('get', '/api/dashboard/performance', mayor).expect(200)).body;
    assert.ok(all.kifle_ketemas.length >= 3);
    const gibeRow = all.kifle_ketemas.find((k) => k.id === gibe.id); // Jiren Kebele moved to Gibe in the test above
    assert.equal(gibeRow.admin.username, 'kifle.gibe');
    assert.equal(gibeRow.with_kebele, await waiting({ kifle_ketema_id: gibe.id, approval_state: 'SUBMITTED' }));
    assert.ok(gibeRow.oldest_wait_days >= 0);
    assert.deepEqual([all.kebele_level, all.kebeles], [false, []]);
    // each administrator sees only its own area
    const kifle = (await api('get', '/api/dashboard/performance', as['kifle.gibe']).expect(200)).body;
    assert.deepEqual(kifle.kifle_ketemas.map((k) => k.id), [gibe.id]);
    assert.ok(kifle.kebeles.length > 0 && kifle.kebeles.every((b) => b.kifle_ketema_id === gibe.id));
    assert.equal(kifle.kebeles.find((b) => b.id === kebJiren.id).admin.username, 'new.keb'); // the Kebele and who answers for it
    const kebele = (await api('get', '/api/dashboard/performance', kebeleAdmin).expect(200)).body;
    assert.deepEqual(kebele.kebeles.map((b) => b.id), [kebJiren.id]);
    // a role without analytics cannot see it
    await api('get', '/api/dashboard/performance', await makeUser('inspector_t', 'INSPECTOR')).expect(403);
  });

  it('only Inspectors record inspections, and the Kifle Ketema Administrator follows the Inspectors of its Kifle Ketema', async () => {
    const cat = await db('asset_categories').first();
    const sector = await db('sectors').where({ code: 'CON' }).first();
    const sa = as['sector.con.jiren'];
    const made = (await api('post', '/api/assets', sa).send({ name: 'Inspected roller', category_id: cat.id, sector_id: sector.id, kebele_id: kebJiren.id }).expect(201)).body;
    const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
    const visit = { inspection_date: day(-10), inspector: 'Field check', condition_found: 'POOR', result: 'FAILED', next_inspection_date: day(-2) };
    // the Sector Administrator owns the asset: it acts on what is found, it does not inspect it
    await api('post', `/api/assets/${made.id}/inspections`, sa).send(visit).expect(403);
    const inspector = await login('inspector.gibe'); // Jiren Kebele is in Gibe since the move above
    await api('post', `/api/assets/${made.id}/inspections`, inspector).send(visit).expect(201);
    await api('post', `/api/assets/${made.id}/follow-ups`, sa).send({ description: 'Repair the drum' }).expect(201);

    // the Kifle Ketema Administrator sees the Inspectors of its Kifle Ketema and their history, and does not change them
    const kg = as['kifle.gibe'];
    const listed = (await api('get', '/api/users', kg).expect(200)).body.find((u) => u.username === 'inspector.gibe');
    assert.equal(listed?.read_only, true);
    await api('patch', `/api/users/${inspector.id}`, kg).send({ full_name: 'x' }).expect(403);
    await api('get', `/api/users/${inspector.id}/history`, kg).expect(200);
    await api('get', `/api/users/${inspector.id}`, as['kifle.jiren']).expect(404); // not its Kifle Ketema

    // ... with their work, what is overdue, and the Kifle Ketemas no Inspector covers
    const board = (await api('get', '/api/dashboard/inspectors', kg).expect(200)).body;
    const row = board.inspectors.find((u) => u.username === 'inspector.gibe');
    assert.deepEqual([row.inspections_recent, row.failed_recent, row.last_inspection], [1, 1, day(-10)]);
    assert.ok(board.overdue >= 1);
    assert.deepEqual(board.uncovered, []);
    const jiren = (await api('get', '/api/dashboard/inspectors', as['kifle.jiren']).expect(200)).body;
    assert.deepEqual([jiren.inspectors, jiren.uncovered.map((k) => k.id)], [[], [jirenKifle.id]]);
    await api('get', '/api/dashboard/inspectors', sa).expect(403);
    const city = (await api('get', '/api/dashboard', as.superadmin).expect(200)).body;
    assert.equal(city.setup.kifle_ketemas_without_inspector, 2); // Jiren and Hirmata

    // an overdue inspection reaches the Inspector and the Kifle Ketema Administrator, not the asset owner or the city-wide roles
    await api('post', '/api/notifications/run', as.superadmin).expect(200);
    const titles = async (who) => (await api('get', '/api/notifications?limit=200', who).expect(200)).body.filter((n) => n.asset_id === made.id).map((n) => n.title);
    assert.ok((await titles(inspector)).some((x) => /inspection overdue since/.test(x)));
    assert.ok((await titles(kg)).some((x) => /inspection overdue since/.test(x)));
    for (const who of [sa, as['kifle.jiren'], as.superadmin]) assert.deepEqual(await titles(who), []);
  });
});
