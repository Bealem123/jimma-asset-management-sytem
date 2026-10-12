import './env.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  api, activateAsset, closeDb, createAsset, makeUser, setupFixture, assetBody,
} from './helpers.js';
import { db } from '../src/db.js';
import { DEFAULT_ROLE_PERMISSIONS } from '../src/lib/constants.js';

after(closeDb);

const FIN = { acquisition_cost: 5000000, current_valuation: 4000000, valuation_date: '2026-01-01' };

/** The Super Administrator gives `role` extra permissions on top of its defaults (System -> Roles and permissions). */
const allow = (fx, role, ...extra) => api('put', `/api/admin/permissions/${role}`, fx.users.super)
  .send({ permissions: [...DEFAULT_ROLE_PERMISSIONS[role], ...extra] }).expect(200);
const restore = (fx, role) => api('put', `/api/admin/permissions/${role}`, fx.users.super)
  .send({ permissions: DEFAULT_ROLE_PERMISSIONS[role] }).expect(200);

describe('new roles, customisable permissions and financial privacy', () => {
  let fx; let asset; let inspector; let finance;
  before(async () => {
    fx = await setupFixture();
    inspector = await makeUser('field_inspector', 'INSPECTOR', { kebeles: [fx.k1, fx.k2] });
    finance = fx.users.finance;
    asset = await createAsset(fx, fx.users.officer, FIN);
  });

  it('hides financial figures from roles without financial.view, everywhere an asset is returned', async () => {
    const list = await api('get', '/api/assets', fx.users.inspector).expect(200);
    assert.equal(list.body.rows[0].acquisition_cost, null);
    assert.equal(list.body.rows[0].current_valuation, null);
    const detail = (await api('get', `/api/assets/${asset.id}`, fx.users.inspector).expect(200)).body;
    assert.equal(detail.asset.acquisition_cost, null);
    assert.deepEqual(detail.valuations, []);
    assert.equal(detail.permissions.can_view_financial, false);
    const csv = await api('get', '/api/assets/export.csv', fx.users.inspector).expect(200);
    assert.ok(!csv.text.includes('Acquisition cost'));
    const officer = (await api('get', `/api/assets/${asset.id}`, fx.users.officer).expect(200)).body;
    assert.equal(officer.asset.acquisition_cost, 5000000);
    assert.equal(officer.valuations.length, 1);
  });

  it('keeps purchase documents, invoices and contracts from people who cannot see money', async () => {
    const up = (user, type) => api('post', `/api/assets/${asset.id}/documents`, user).field('doc_type', type).field('title', 'Doc')
      .attach('file', Buffer.from('%PDF-1.4 x'), { filename: 'a.pdf', contentType: 'application/pdf' });
    const invoice = await up(fx.users.officer, 'INVOICE').expect(201);
    await up(fx.users.officer, 'PHOTO').expect(201);
    const seen = (await api('get', `/api/assets/${asset.id}`, fx.users.inspector)).body.documents;
    assert.deepEqual(seen.map((d) => d.doc_type), ['PHOTO']);
    await api('get', `/api/assets/${asset.id}/documents/${invoice.body.id}/download`, fx.users.inspector).expect(404);
    await api('get', `/api/assets/${asset.id}/documents/${invoice.body.id}/download`, fx.users.officer).expect(200);
  });

  it('an inspector can inspect but cannot register or edit assets', async () => {
    await api('post', `/api/assets/${asset.id}/inspections`, inspector).send({
      inspection_date: '2026-06-01', inspector: 'Test inspector', condition_found: 'GOOD',
    }).expect(201);
    await api('patch', `/api/assets/${asset.id}`, inspector).send({ name: 'Hacked' }).expect(403);
    await api('post', '/api/assets', inspector).send(assetBody(fx)).expect(403);
    await api('post', `/api/assets/${asset.id}/maintenance`, inspector).send({ maintenance_date: '2026-06-01', maintenance_type: 'x' }).expect(403);
  });

  it('a financial officer records valuations and revenue, but cannot edit the asset', async () => {
    await api('post', `/api/assets/${asset.id}/valuations`, finance).send({ valuation_date: '2026-07-01', value: 4200000, method: 'Revaluation' }).expect(201);
    await api('post', `/api/assets/${asset.id}/revenues`, finance).send({ revenue_type: 'RENT', amount: 15000, received_date: '2026-07-05', payer: 'Tenant A' }).expect(201);
    await api('patch', `/api/assets/${asset.id}`, finance).send({ name: 'Nope' }).expect(403);
    await api('post', `/api/assets/${asset.id}/revenues`, fx.users.officer).send({ revenue_type: 'RENT', amount: 1, received_date: '2026-07-05' }).expect(403);
    const d = (await api('get', `/api/assets/${asset.id}`, finance)).body;
    assert.equal(d.asset.current_valuation, 4200000);
    assert.equal(d.asset.total_revenue, 15000);
  });

  it('the Mayor reads every asset but cannot change or move one', async () => {
    await api('get', `/api/assets/${asset.id}`, fx.users.mayor).expect(200);
    await api('patch', `/api/assets/${asset.id}`, fx.users.mayor).send({ name: 'Nope' }).expect(403);
    await api('post', `/api/assets/${asset.id}/transfers`, fx.users.mayor).send({}).expect(403);
  });

  it('a Super Administrator can change what a role may do, and only a Super Administrator', async () => {
    await api('patch', `/api/assets/${asset.id}`, inspector).send({ name: 'Renamed' }).expect(403);
    const grant = [...DEFAULT_ROLE_PERMISSIONS.INSPECTOR, 'asset.edit'];
    await api('put', '/api/admin/permissions/INSPECTOR', fx.users.mayor).send({ permissions: grant }).expect(403);
    await api('put', '/api/admin/permissions/INSPECTOR', fx.users.super).send({ permissions: grant }).expect(200);
    await api('patch', `/api/assets/${asset.id}`, inspector).send({ name: 'Renamed' }).expect(200);
    await api('put', '/api/admin/permissions/INSPECTOR', fx.users.super).send({ permissions: DEFAULT_ROLE_PERMISSIONS.INSPECTOR }).expect(200);
    await api('patch', `/api/assets/${asset.id}`, inspector).send({ name: 'Again' }).expect(403);
    assert.equal(await db('role_permissions').where({ role: 'INSPECTOR' }).count({ n: 'role' }).first().then((r) => Number(r.n)), 0, 'defaults are not stored as overrides');
    await api('put', '/api/admin/permissions/SUPER_ADMIN', fx.users.super).send({ permissions: [] }).expect(409);
    await api('put', '/api/admin/permissions/INSPECTOR', fx.users.super).send({ permissions: ['not.a.permission'] }).expect(400);
  });

  it('exposes the permissions of the signed-in user so the screen can follow them', async () => {
    const me = (await api('get', '/api/auth/me', inspector).expect(200)).body.user;
    assert.ok(me.permissions.includes('inspection.record'));
    assert.ok(!me.permissions.includes('asset.edit'));
  });
});

describe('acquisition, duplicates and registration', () => {
  let fx;
  before(async () => { fx = await setupFixture(); });

  it('records how an asset was acquired and sends it straight into the approval workflow', async () => {
    const a = await createAsset(fx, fx.users.officer, {
      name: 'Grader', submit: true,
      acquisition: {
        method: 'PURCHASE', procurement_ref: 'PROC-2026-014', supplier_name: 'Abyssinia Machinery', contract_ref: 'CT-77', invoice_ref: 'INV-9001',
        acquisition_date: '2026-03-10', cost: 9250000, approval_ref: 'Council decision 12/2026', approved_by_name: 'City Council',
      },
    });
    assert.equal(a.approval_state, 'SUBMITTED');
    assert.equal(a.acquisition_cost, 9250000);
    assert.equal(a.acquisition_date, '2026-03-10');
    const d = (await api('get', `/api/assets/${a.id}`, fx.users.officer)).body;
    assert.equal(d.acquisition.supplier_name, 'Abyssinia Machinery');
    assert.equal(d.acquisition.method, 'PURCHASE');
    assert.ok(d.history.some((h) => h.action === 'SUBMIT'));
    // the reviewers hear about it; the submitter does not
    const verifier = (await api('get', '/api/notifications', fx.users.kebeleA)).body;
    assert.ok(verifier.some((n) => n.type === 'APPROVAL_PENDING' && n.asset_id === a.id));
    const mine = (await api('get', '/api/notifications', fx.users.officer)).body;
    assert.ok(!mine.some((n) => n.asset_id === a.id));
  });

  it('validates the acquisition method', async () => {
    const res = await api('post', '/api/assets', fx.users.officer).send(assetBody(fx, { acquisition: { method: 'STOLEN' } })).expect(400);
    assert.ok(res.body.details['acquisition.method']);
  });

  it('updates the acquisition later and keeps a trail', async () => {
    const a = await createAsset(fx, fx.users.officer);
    await api('put', `/api/assets/${a.id}/acquisition`, fx.users.officer).send({ method: 'DONATION', supplier_name: 'NGO X', cost: 0 }).expect(200);
    const res = await api('put', `/api/assets/${a.id}/acquisition`, fx.users.officer).send({ method: 'DONATION', supplier_name: 'NGO Y', cost: 0 }).expect(200);
    assert.equal(res.body.supplier_name, 'NGO Y');
    const log = await db('audit_logs').where({ asset_id: a.id }).whereIn('action', ['ACQUISITION_ADD', 'ACQUISITION_UPDATE']);
    assert.equal(log.length, 2);
    await api('put', `/api/assets/${a.id}/acquisition`, fx.users.inspector).send({ method: 'DONATION' }).expect(403);
  });

  it('refuses a duplicate serial or registration number, and says which asset has it', async () => {
    const first = await createAsset(fx, fx.users.officer, { serial_number: 'SN-1001', registration_number: 'REG-1' });
    const dup = await api('post', '/api/assets', fx.users.officer).send(assetBody(fx, { serial_number: 'SN-1001' })).expect(409);
    assert.match(dup.body.details.serial_number, new RegExp(first.asset_code));
    await api('post', '/api/assets', fx.users.officer).send(assetBody(fx, { registration_number: 'REG-1' })).expect(409);
    const other = await createAsset(fx, fx.users.officer, { serial_number: 'SN-2002' });
    await api('patch', `/api/assets/${other.id}`, fx.users.officer).send({ serial_number: 'SN-1001' }).expect(409);
    await api('patch', `/api/assets/${other.id}`, fx.users.officer).send({ serial_number: 'SN-2002' }).expect(200); // its own number is fine
    const found = (await api('get', '/api/assets?serial_number=SN-100', fx.users.officer)).body;
    assert.equal(found.total, 1);
  });

  it('lists the 13 Kebeles without inventing their Kifle Ketema, and will not register an asset in an unlinked one', async () => {
    const seeded = await db('kebeles').whereNull('kifle_ketema_id');
    assert.equal(seeded.length, 13);
    assert.ok(seeded.every((k) => !k.is_validated));
    for (const n of ['Jiren', 'Ginjo', 'Ginjo Guduru', 'Mendera Kochi', 'Awetu Mendera', 'Bosa Addis Ketema', 'Bosa Kito', 'Hirmata Mentina', 'Mentina', 'Hirmata', 'Hirmata Merkato', 'Becho Bore', 'Seto Semero']) {
      assert.ok(seeded.some((k) => k.name === n), n);
    }
    const unlinked = seeded.find((k) => k.name === 'Seto Semero');
    // the Construction Sector Administrator covers every Kebele
    const res = await api('post', '/api/assets', fx.users.sectorAdmin).send(assetBody(fx, { kebele_id: unlinked.id })).expect(400);
    assert.match(res.body.details.kebele_id, /not yet linked/);
    // the Super Administrator links it, and registration then works
    await api('patch', `/api/master/kebeles/${unlinked.id}`, fx.users.super).send({ kifle_ketema_id: fx.hirmata.id }).expect(200);
    const ok = await api('post', '/api/assets', fx.users.sectorAdmin).send(assetBody(fx, { kebele_id: unlinked.id })).expect(201);
    assert.equal(ok.body.kifle_ketema_id, fx.hirmata.id);
    const lookups = (await api('get', '/api/master/lookups', fx.users.officer)).body;
    assert.equal(lookups.kebeles.length, 16);
  });
});

describe('assignment, responsibility history and ownership change', () => {
  let fx; let asset; let dep2;
  before(async () => {
    fx = await setupFixture();
    asset = await createAsset(fx, fx.users.officer);
    [dep2] = await db('departments').insert({ name: 'Roads Department', sector_id: fx.construction.id });
  });

  it('assigns an asset and keeps every earlier assignment', async () => {
    const first = await api('post', `/api/assets/${asset.id}/assignments`, fx.users.officer).send({
      department_id: dep2, holder: 'Abebe Kebede', responsible_officer: 'Eng. Tigist', office: 'Roads Office',
      assigned_date: '2026-05-01', reason: 'Road maintenance season',
    }).expect(201);
    assert.equal(first.body.current_holder, 'Abebe Kebede');
    assert.equal(first.body.department_id, dep2);
    assert.equal(first.body.responsible_office, 'Roads Office');
    await api('post', `/api/assets/${asset.id}/assignments`, fx.users.officer).send({
      holder: 'Chaltu Bekele', assigned_date: '2026-08-01', reason: 'Reassigned after the rains',
    }).expect(201);
    const d = (await api('get', `/api/assets/${asset.id}`, fx.users.officer)).body;
    assert.equal(d.assignments.length, 2);
    assert.equal(d.assignments[0].status, 'ACTIVE');
    assert.equal(d.assignments[1].status, 'ENDED');
    assert.equal(d.assignments[1].ended_date, '2026-08-01');
    assert.equal(d.assignments[0].department_id, dep2, 'responsibility not mentioned stays as it was');
    const current = (await api('get', '/api/assets/assignments/current?holder=Chaltu', fx.users.officer)).body;
    assert.equal(current.length, 1);
    assert.equal((await api('get', '/api/assets/assignments/current?holder=Abebe', fx.users.officer)).body.length, 0);
    assert.equal((await api('get', `/api/assets/assignments/current?department_id=${dep2}`, fx.users.officer)).body.length, 1);
  });

  it('needs a target and a reason, and respects sector/department consistency', async () => {
    await api('post', `/api/assets/${asset.id}/assignments`, fx.users.officer).send({ assigned_date: '2026-08-01', reason: 'x' }).expect(400);
    await api('post', `/api/assets/${asset.id}/assignments`, fx.users.officer).send({ holder: 'x', assigned_date: '2026-08-01' }).expect(400);
    const r = await api('post', `/api/assets/${asset.id}/assignments`, fx.users.officer).send({
      sector_id: fx.business.id, department_id: dep2, assigned_date: '2026-08-02', reason: 'wrong department',
    }).expect(400);
    assert.ok(r.body.details.department_id);
  });

  it('can be made to require approval, and then waits for an approver', async () => {
    await api('put', '/api/admin/workflows/ASSIGNMENT', fx.users.mayor).send({ requires_approval: true }).expect(403);
    await api('put', '/api/admin/workflows/ASSIGNMENT', fx.users.super).send({ requires_approval: true, steps: 1 }).expect(200);
    const res = await api('post', `/api/assets/${asset.id}/assignments`, fx.users.officer).send({
      holder: 'Dawit', assigned_date: '2026-09-01', reason: 'Field work',
    }).expect(202);
    assert.equal((await db('assets').where({ id: asset.id }).first()).current_holder, 'Chaltu Bekele');
    await api('post', `/api/requests/${res.body.request.id}/approve`, fx.users.jirenAdmin).expect(200);
    assert.equal((await db('assets').where({ id: asset.id }).first()).current_holder, 'Dawit');
    await api('put', '/api/admin/workflows/ASSIGNMENT', fx.users.super).send({ requires_approval: false }).expect(200);
  });

  it('records an ownership change with its basis through a two-step approval', async () => {
    const body = { new_owner: 'Oromia Regional Government', new_type: 'ADMINISTERED_ON_BEHALF', effective_date: '2026-09-15', basis: 'Regional proclamation 42/2026' };
    await api('post', `/api/assets/${asset.id}/ownership-change`, fx.users.officer).send({ ...body, basis: '' }).expect(400);
    const req = await api('post', `/api/assets/${asset.id}/ownership-change`, fx.users.officer).send(body).expect(202);
    const id = req.body.request.id;
    // two different people decide: here the Kebele Administrator reviews and the Kifle Ketema Administrator approves
    await allow(fx, 'KEBELE_ADMIN', 'request.decide');
    await api('post', `/api/requests/${id}/review`, fx.users.kebeleA).expect(200);
    await api('post', `/api/requests/${id}/approve`, fx.users.jirenAdmin).expect(200);
    await restore(fx, 'KEBELE_ADMIN');
    const d = (await api('get', `/api/assets/${asset.id}`, fx.users.officer)).body;
    assert.equal(d.asset.owner_name, 'Oromia Regional Government');
    assert.equal(d.ownership_history.length, 1);
    assert.equal(d.ownership_history[0].previous_owner, 'Jiren Kebele A Kebele');
    assert.equal(d.ownership_history[0].basis, 'Regional proclamation 42/2026');
  });

  it('keeps owner, responsible department and current holder as three separate things', async () => {
    const d = (await api('get', `/api/assets/${asset.id}`, fx.users.officer)).body.asset;
    assert.notEqual(d.owner_name, d.current_holder);
    assert.ok(d.department_id);
  });
});

describe('approval requests: workflow rules and rejection', () => {
  let fx; let asset;
  before(async () => {
    fx = await setupFixture();
    asset = await createAsset(fx, fx.users.officer);
  });
  const transfer = (user, extra = {}) => api('post', `/api/assets/${asset.id}/transfers`, user)
    .send({ to_kebele_id: fx.k2, transfer_date: '2026-06-01', reason: 'Need elsewhere', authorized_by: 'Head', ...extra });

  it('lets the requester withdraw, and notifies them when a request is rejected with a reason', async () => {
    const first = await transfer(fx.users.officer).expect(202);
    await api('post', `/api/requests/${first.body.request.id}/cancel`, fx.users.mayor).expect(403);
    await api('post', `/api/requests/${first.body.request.id}/cancel`, fx.users.officer).expect(200);
    const second = await transfer(fx.users.officer).expect(202);
    await transfer(fx.users.officer).expect(409); // one waiting request per kind
    await api('post', `/api/requests/${second.body.request.id}/reject`, fx.users.jirenAdmin).send({}).expect(400);
    const rej = await api('post', `/api/requests/${second.body.request.id}/reject`, fx.users.jirenAdmin).send({ comment: 'Not justified' }).expect(200);
    assert.equal(rej.body.status, 'REJECTED');
    assert.equal(rej.body.decision_note, 'Not justified');
    const note = (await api('get', '/api/notifications', fx.users.officer)).body.find((n) => n.type === 'REQUEST_REJECTED');
    assert.match(note.body, /Not justified/);
    assert.equal((await db('assets').where({ id: asset.id }).first()).kebele_id, fx.k1, 'nothing moved');
    await api('post', `/api/requests/${second.body.request.id}/approve`, fx.users.jirenAdmin).expect(409); // already decided
  });

  it('an approver outside the asset area cannot see or decide the request', async () => {
    const far = await createAsset(fx, fx.users.sectorAdmin, { kebele_id: fx.k3 }); // in Hirmata
    const req = await api('post', `/api/assets/${far.id}/transfers`, fx.users.sectorAdmin).send({ to_kebele_id: fx.k1, transfer_date: '2026-06-01', reason: 'x', authorized_by: 'y' }).expect(202);
    await api('post', `/api/requests/${req.body.request.id}/approve`, fx.users.jirenAdmin).expect(404);
    const list = (await api('get', '/api/requests?open=1', fx.users.jirenAdmin)).body;
    assert.ok(!list.some((r) => r.id === req.body.request.id));
    const mine = (await api('get', '/api/requests?open=1', fx.users.hirmataAdmin)).body.find((r) => r.id === req.body.request.id);
    assert.equal(mine.can_approve, true);
    assert.equal((await api('get', '/api/requests?open=1', fx.users.sectorAdmin)).body.find((r) => r.id === req.body.request.id).can_approve, false, 'the requester does not decide');
  });

  it('can be switched off per kind of request, and then runs immediately', async () => {
    await api('put', '/api/admin/workflows/TRANSFER', fx.users.super).send({ requires_approval: false }).expect(200);
    await transfer(fx.users.officer).expect(201);
    assert.equal((await db('assets').where({ id: asset.id }).first()).kebele_id, fx.k2);
    await api('put', '/api/admin/workflows/TRANSFER', fx.users.super).send({ requires_approval: true, steps: 2 }).expect(200);
    const back = await api('post', `/api/assets/${asset.id}/transfers`, fx.users.officer).send({ to_kebele_id: fx.k1, transfer_date: '2026-06-05', reason: 'Back', authorized_by: 'Head' }).expect(202);
    assert.equal(back.body.request.status, 'PENDING');
    await api('post', `/api/requests/${back.body.request.id}/approve`, fx.users.jirenAdmin).expect(409); // two steps: review first
    await api('put', '/api/admin/workflows/TRANSFER', fx.users.super).send({ requires_approval: true, steps: 1 }).expect(200);
  });
});

describe('reservations', () => {
  let fx; let van; let requester; let fixed;
  before(async () => {
    fx = await setupFixture();
    van = await createAsset(fx, fx.users.officer, { name: 'Meeting hall', is_reservable: true });
    await activateAsset(fx, van);
    fixed = await createAsset(fx, fx.users.officer, { name: 'Not for hire' });
    requester = fx.users.inspector; // may ask for a reservation, may not decide one
  });
  const book = (user, start, end, asset = van) => api('post', '/api/reservations', user).send({ asset_id: asset.id, start_at: start, end_at: end, purpose: 'Staff meeting' });

  it('prevents two people from holding the same asset at the same time', async () => {
    const mine = await book(requester, '2030-03-01 09:00', '2030-03-01 12:00').expect(201);
    assert.equal(mine.body.status, 'PENDING');
    const clash = await book(fx.users.officer, '2030-03-01 11:00', '2030-03-01 13:00').expect(409);
    assert.match(clash.body.error, /already/);
    await book(fx.users.officer, '2030-03-01 12:00', '2030-03-01 14:00').expect(201); // back to back is fine
    await book(fx.users.officer, '2030-03-01 10:00', '2030-03-01 09:00').expect(400); // ends before it starts
  });

  it('only reservable, usable assets can be reserved', async () => {
    await book(requester, '2030-04-01 09:00', '2030-04-01 10:00', fixed).expect(400);
    await api('patch', `/api/assets/${fixed.id}`, fx.users.officer).send({ is_reservable: true }).expect(200);
    await book(requester, '2030-04-01 09:00', '2030-04-01 10:00', fixed).expect(201);
    await api('post', `/api/assets/${fixed.id}/status`, fx.users.officer).send({ status: 'DAMAGED', reason: 'Broken' }).expect(200);
    await book(requester, '2030-04-02 09:00', '2030-04-02 10:00', fixed).expect(409);
    await book(fx.users.mayor, '2030-04-02 09:00', '2030-04-02 10:00').expect(403);
  });

  it('needs an approver who is not the requester, then shows the asset as reserved', async () => {
    const list = (await api('get', '/api/reservations?status=PENDING', fx.users.kebeleA)).body;
    const target = list.find((r) => r.start_at.startsWith('2030-03-01 09:00'));
    assert.equal(target.can_decide, true);
    await api('post', `/api/reservations/${target.id}/approve`, requester).expect(403);
    const own = await book(fx.users.kebeleA, '2030-05-01 09:00', '2030-05-01 10:00').expect(201);
    await api('post', `/api/reservations/${own.body.id}/approve`, fx.users.kebeleA).expect(409); // own request
    await api('post', `/api/reservations/${target.id}/reject`, fx.users.kebeleA).send({}).expect(400);
    await api('post', `/api/reservations/${target.id}/approve`, fx.users.kebeleA).expect(200);
    const avail = (await api('get', '/api/reservations/availability?start_at=2030-03-01T10:00&end_at=2030-03-01T11:00', fx.users.officer)).body;
    const row = avail.find((a) => a.id === van.id);
    assert.equal(row.available, false);
    assert.equal(row.reserved.length, 1);
    const free = (await api('get', '/api/reservations/availability?start_at=2030-03-02T10:00&end_at=2030-03-02T11:00', fx.users.officer)).body;
    assert.equal(free.find((a) => a.id === van.id).available, true);
    assert.ok(!free.some((a) => a.id === fixed.id), 'damaged assets are not offered');
  });

  it('frees the slot when a reservation is cancelled, and keeps the history', async () => {
    const r = await book(requester, '2030-06-01 09:00', '2030-06-01 10:00').expect(201);
    await book(fx.users.officer, '2030-06-01 09:30', '2030-06-01 10:30').expect(409);
    await api('post', `/api/reservations/${r.body.id}/cancel`, fx.users.mayor).expect(403); // neither the requester nor an approver
    await api('post', `/api/reservations/${r.body.id}/cancel`, requester).expect(200);
    await book(fx.users.officer, '2030-06-01 09:30', '2030-06-01 10:30').expect(201);
    const history = (await api('get', `/api/reservations?asset_id=${van.id}`, fx.users.kebeleA)).body;
    assert.ok(history.some((h) => h.status === 'CANCELLED'));
    assert.ok(await db('audit_logs').where({ action: 'RESERVATION_CANCEL' }).first());
  });
});

describe('retirement, disposal and archive', () => {
  let fx;
  before(async () => { fx = await setupFixture(); });

  it('retires an asset with one approval, and a retired asset can then only be disposed of', async () => {
    const a = await createAsset(fx, fx.users.officer);
    const req = await api('post', `/api/assets/${a.id}/disposal`, fx.users.officer).send({ kind: 'RETIREMENT', reason: 'Worn out', disposal_date: '2026-07-01' }).expect(202);
    await api('post', `/api/requests/${req.body.request.id}/approve`, fx.users.jirenAdmin).expect(200);
    assert.equal((await db('assets').where({ id: a.id }).first()).status, 'RETIRED');
    await api('post', `/api/assets/${a.id}/status`, fx.users.officer).send({ status: 'ACTIVE', reason: 'back' }).expect(409);
    await api('post', `/api/assets/${a.id}/disposal`, fx.users.officer).send({ kind: 'RETIREMENT', reason: 'again', disposal_date: '2026-07-02' }).expect(409);
    const disp = await api('post', `/api/assets/${a.id}/disposal`, fx.users.officer).send({
      kind: 'DISPOSAL', reason: 'Sold at auction', method: 'SALE', disposal_date: '2026-08-01', disposal_value: 45000, recipient: 'Mr. Buyer',
    }).expect(202);
    await allow(fx, 'KEBELE_ADMIN', 'request.decide'); // a disposal needs two different people to decide
    await api('post', `/api/requests/${disp.body.request.id}/review`, fx.users.kebeleA).expect(200);
    await api('post', `/api/requests/${disp.body.request.id}/approve`, fx.users.jirenAdmin).expect(200);
    await restore(fx, 'KEBELE_ADMIN');
    const d = (await api('get', `/api/assets/${a.id}`, fx.users.officer)).body;
    assert.equal(d.asset.status, 'DISPOSED');
    assert.equal(d.disposals.length, 2);
    assert.equal(d.disposals[0].recipient, 'Mr. Buyer');
    assert.equal(d.disposals[0].disposal_value, 45000);
    assert.equal(d.permissions.locked, true);
  });

  it('cancels requests and reservations that were waiting on an asset that is now disposed of', async () => {
    const a = await createAsset(fx, fx.users.officer, { is_reservable: true });
    const t = await api('post', `/api/assets/${a.id}/transfers`, fx.users.officer).send({ to_kebele_id: fx.k2, transfer_date: '2026-06-01', reason: 'x', authorized_by: 'y' }).expect(202);
    await api('put', '/api/admin/workflows/DISPOSAL', fx.users.super).send({ requires_approval: false }).expect(200);
    await api('post', `/api/assets/${a.id}/disposal`, fx.users.officer).send({ kind: 'DISPOSAL', reason: 'Scrap', method: 'SCRAP', disposal_date: '2026-07-01' }).expect(201);
    await api('put', '/api/admin/workflows/DISPOSAL', fx.users.super).send({ requires_approval: true, steps: 2 }).expect(200);
    assert.equal((await db('approval_requests').where({ id: t.body.request.id }).first()).status, 'CANCELLED');
    await api('post', `/api/requests/${t.body.request.id}/approve`, fx.users.jirenAdmin).expect(409);
  });

  it('moves disposed assets out of the working lists when archived, without deleting them', async () => {
    const a = await createAsset(fx, fx.users.officer, { name: 'Old compressor' });
    await api('put', '/api/admin/workflows/DISPOSAL', fx.users.super).send({ requires_approval: false }).expect(200);
    await api('post', `/api/assets/${a.id}/disposal`, fx.users.officer).send({ kind: 'DISPOSAL', reason: 'Scrap', method: 'SCRAP', disposal_date: '2026-07-01' }).expect(201);
    await api('put', '/api/admin/workflows/DISPOSAL', fx.users.super).send({ requires_approval: true, steps: 2 }).expect(200);
    await api('post', `/api/assets/${a.id}/archive`, fx.users.officer).expect(403);
    await api('post', `/api/assets/${a.id}/archive`, fx.users.jirenAdmin).expect(200);
    await api('post', `/api/assets/${a.id}/archive`, fx.users.jirenAdmin).expect(409);
    const hidden = (await api('get', '/api/assets?q=Old%20compressor', fx.users.jirenAdmin)).body;
    assert.equal(hidden.total, 0);
    const shown = (await api('get', '/api/assets?q=Old%20compressor&include_archived=true', fx.users.jirenAdmin)).body;
    assert.equal(shown.total, 1);
    await api('get', `/api/assets/${a.id}`, fx.users.jirenAdmin).expect(200); // still readable
    const live = await createAsset(fx, fx.users.officer);
    await api('post', `/api/assets/${live.id}/archive`, fx.users.jirenAdmin).expect(409); // only disposed assets
    await api('post', `/api/assets/${a.id}/unarchive`, fx.users.jirenAdmin).expect(200);
  });
});
