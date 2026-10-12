import './env.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db.js';
import { DEFAULT_ROLE_PERMISSIONS } from '../src/lib/constants.js';
import { setupFixture, api, assetBody, createAsset, activateAsset, addPhoto, closeDb, siteEvidence, makeUser } from './helpers.js';

/** A draft with a photo of the asset, so it can be sent for verification. */
async function photographed(fx, user, over) {
  const a = await createAsset(fx, user, over);
  await addPhoto(a, user);
  return a;
}

/** The Super Administrator gives `role` extra permissions on top of its defaults (System -> Roles and permissions). */
const allow = (fx, role, ...extra) => api('put', `/api/admin/permissions/${role}`, fx.users.super)
  .send({ permissions: [...DEFAULT_ROLE_PERMISSIONS[role], ...extra] }).expect(200);
const restore = (fx, role) => api('put', `/api/admin/permissions/${role}`, fx.users.super)
  .send({ permissions: DEFAULT_ROLE_PERMISSIONS[role] }).expect(200);

describe('asset register: creating and validating', () => {
  let fx;
  before(async () => { fx = await setupFixture(); });

  it('assigns sequential permanent asset IDs and starts in DRAFT', async () => {
    const a = await createAsset(fx);
    const b = await createAsset(fx, fx.users.officer, { name: 'Excavator 2' });
    assert.match(a.asset_code, /^AST-\d{6}$/);
    assert.equal(Number(b.asset_code.slice(4)), Number(a.asset_code.slice(4)) + 1);
    assert.equal(a.approval_state, 'DRAFT');
    assert.equal(a.status, 'REGISTERED');
    assert.equal(a.owner_name, 'Jiren Kebele A Kebele'); // a Sector Administrator registers for its Kebele, the legal owner
  });

  it('derives the Kifle Ketema from the Kebele', async () => {
    const a = await createAsset(fx, fx.users.sectorAdmin, { kebele_id: fx.k3 }); // Construction, city-wide
    assert.equal(a.kifle_ketema_id, fx.hirmata.id);
    assert.equal(a.kifle_ketema_name, 'Hirmata');
  });

  it('allows an asset located at Kifle Ketema level with no Kebele', async () => {
    const a = await createAsset(fx, fx.users.sectorAdmin, { kebele_id: null, kifle_ketema_id: fx.jiren.id });
    assert.equal(a.kebele_id, null);
    assert.equal(a.kifle_ketema_name, 'Jiren');
  });

  it('rejects a Kebele that does not belong to the chosen Kifle Ketema', async () => {
    const res = await api('post', '/api/assets', fx.users.sectorAdmin).send(assetBody(fx, { kifle_ketema_id: fx.hirmata.id, kebele_id: fx.k1 })).expect(400);
    assert.ok(res.body.details.kebele_id);
  });

  it('rejects an asset type from another category and a department from another sector', async () => {
    const r1 = await api('post', '/api/assets', fx.users.officer).send(assetBody(fx, { asset_type_id: fx.shop.id })).expect(400);
    assert.ok(r1.body.details.asset_type_id);
    const r2 = await api('post', '/api/assets', fx.users.officer).send(assetBody(fx, { sector_id: fx.business.id })).expect(400);
    assert.ok(r2.body.details.department_id);
  });

  it('requires a name, category, sector and a location', async () => {
    const res = await api('post', '/api/assets', fx.users.sectorAdmin).send({}).expect(400);
    for (const f of ['name', 'category_id', 'sector_id']) assert.ok(res.body.details[f], `missing error for ${f}`);
    const noLoc = await api('post', '/api/assets', fx.users.sectorAdmin).send(assetBody(fx, { kebele_id: null })).expect(400);
    assert.ok(noLoc.body.details.kifle_ketema_id);
  });

  it('does not require any revenue information: an asset may have no revenue', async () => {
    const a = await createAsset(fx, fx.users.officer, { name: 'Ambulance', acquisition_cost: '' });
    assert.equal(a.generates_revenue, false);
    assert.equal(a.acquisition_cost, null);
  });

  it('rejects bad values: negative cost, bad date, unknown condition, overlong name', async () => {
    const bad = await api('post', '/api/assets', fx.users.officer)
      .send(assetBody(fx, { acquisition_cost: -5, acquisition_date: '12/05/2025', condition: 'AMAZING', name: 'x'.repeat(201) })).expect(400);
    for (const f of ['acquisition_cost', 'acquisition_date', 'condition', 'name']) assert.ok(bad.body.details[f], f);
  });

  it('creates an initial valuation record when a valuation is given at registration', async () => {
    const a = await createAsset(fx, fx.users.officer, { current_valuation: 1500000, valuation_date: '2026-01-15' });
    const rows = await db('asset_valuations').where({ asset_id: a.id });
    assert.equal(rows.length, 1);
    assert.equal(a.current_valuation, 1500000);
    await api('post', '/api/assets', fx.users.officer).send(assetBody(fx, { current_valuation: 100 })).expect(400); // needs a date too
  });

  it('keeps the audit trail for creation', async () => {
    const a = await createAsset(fx);
    const log = await db('audit_logs').where({ asset_id: a.id, action: 'CREATE' }).first();
    assert.ok(log);
    assert.match(log.summary, new RegExp(a.asset_code));
  });

  it('updates only the fields that are sent and records the changes', async () => {
    const a = await createAsset(fx, fx.users.officer, { description: 'Keep me', current_holder: 'Road team' });
    const res = await api('patch', `/api/assets/${a.id}`, fx.users.officer).send({ condition: 'FAIR' }).expect(200);
    assert.equal(res.body.condition, 'FAIR');
    assert.equal(res.body.description, 'Keep me'); // not wiped by the partial update
    assert.equal(res.body.current_holder, 'Road team');
    const log = await db('audit_logs').where({ asset_id: a.id, action: 'UPDATE' }).first();
    assert.deepEqual(JSON.parse(JSON.stringify(log.changes)).condition, { from: 'GOOD', to: 'FAIR' });
  });

  it('re-derives the Kifle Ketema when the Kebele is changed', async () => {
    const a = await createAsset(fx);
    const res = await api('patch', `/api/assets/${a.id}`, fx.users.sectorAdmin).send({ kebele_id: fx.k3 }).expect(200); // Construction, city-wide
    assert.equal(res.body.kifle_ketema_id, fx.hirmata.id);
  });

  it('cannot change status or approval state through a plain edit', async () => {
    const a = await createAsset(fx);
    await api('patch', `/api/assets/${a.id}`, fx.users.officer).send({ status: 'DISPOSED', approval_state: 'ACTIVE' }).expect(200);
    const now = await db('assets').where({ id: a.id }).first();
    assert.equal(now.status, 'REGISTERED');
    assert.equal(now.approval_state, 'DRAFT');
  });
});

describe('asset register: who can see and change what', () => {
  let fx; let inK1; let inK2; let inK3;
  before(async () => {
    fx = await setupFixture();
    inK1 = await createAsset(fx, fx.users.officer, { name: 'In Kebele A' });
    inK2 = await createAsset(fx, fx.users.officer, { name: 'In Kebele B', kebele_id: fx.k2 });
    inK3 = await createAsset(fx, fx.users.sectorAdmin, { name: 'In Kebele C (Hirmata)', kebele_id: fx.k3 });
    const buildingBody = { category_id: fx.buildings.id, asset_type_id: fx.shop.id, sector_id: fx.business.id, department_id: null };
    const businessC = await makeUser('business_c', 'SECTOR_ADMIN', { sectors: [fx.business.id], kebeles: [fx.k3] });
    await createAsset(fx, businessC, { name: 'A shop, business sector', kebele_id: fx.k3, ...buildingBody });
  });

  const names = async (user) => (await api('get', '/api/assets', user).expect(200)).body.rows.map((r) => r.name).sort();

  it('city-wide roles see everything', async () => {
    for (const u of [fx.users.super, fx.users.mayor, fx.users.auditor]) assert.equal((await names(u)).length, 4);
  });

  it('a Kebele Administrator sees only their Kebele', async () => {
    assert.deepEqual(await names(fx.users.kebeleA), ['In Kebele A']);
  });

  it('a Sector Administrator assigned to two Kebeles sees its sectors in both', async () => {
    assert.deepEqual(await names(fx.users.officer), ['In Kebele A', 'In Kebele B']);
  });

  it('a Kifle Ketema Administrator sees their whole Kifle Ketema', async () => {
    assert.deepEqual(await names(fx.users.jirenAdmin), ['In Kebele A', 'In Kebele B']);
  });

  it('a Sector Administrator sees their sector across all locations', async () => {
    assert.deepEqual(await names(fx.users.sectorAdmin), ['In Kebele A', 'In Kebele B', 'In Kebele C (Hirmata)']);
  });

  it('a user with no assignments sees nothing', async () => {
    assert.deepEqual(await names(fx.users.nobody), []);
  });

  it('assets outside scope look like they do not exist (404, not 403)', async () => {
    await api('get', `/api/assets/${inK3.id}`, fx.users.kebeleA).expect(404);
    await api('patch', `/api/assets/${inK3.id}`, fx.users.kebeleA).send({ name: 'hack' }).expect(404);
    await api('get', `/api/assets/${inK1.id}`, fx.users.kebeleA).expect(200);
  });

  it('cannot create an asset outside one\'s own area', async () => {
    await api('post', '/api/assets', fx.users.officer).send(assetBody(fx, { kebele_id: fx.k3 })).expect(403);
    const ok = await api('post', '/api/assets', fx.users.officer).send(assetBody(fx, { kebele_id: fx.k1 })).expect(201);
    await db('assets').where({ id: ok.body.id }).delete(); // keep the fixture counts stable for the tests below
  });

  it('cannot move an asset out of one\'s own area with an edit', async () => {
    await api('patch', `/api/assets/${inK1.id}`, fx.users.kebeleA).send({ kebele_id: fx.k3 }).expect(403);
  });

  it('roles that do not keep the asset records cannot create or change them', async () => {
    for (const u of [fx.users.mayor, fx.users.auditor, fx.users.inspector, fx.users.finance]) {
      await api('post', '/api/assets', u).send(assetBody(fx)).expect(403);
      await api('patch', `/api/assets/${inK1.id}`, u).send({ name: 'x' }).expect(403);
      await api('post', `/api/assets/${inK1.id}/maintenance`, u).send({ maintenance_date: '2026-01-01', maintenance_type: 'x' }).expect(403);
    }
  });

  it('summary counts and exports respect scope', async () => {
    const dash = await api('get', '/api/dashboard', fx.users.kebeleA).expect(200);
    assert.equal(dash.body.totals.assets, 1);
    const csv = await api('get', '/api/assets/export.csv', fx.users.kebeleA).expect(200);
    assert.ok(csv.text.includes('In Kebele A'));
    assert.ok(!csv.text.includes('Hirmata'));
  });

  it('filters by sector, location, status and free text', async () => {
    const q = async (qs) => (await api('get', `/api/assets?${qs}`, fx.users.mayor).expect(200)).body;
    assert.equal((await q(`sector_id=${fx.business.id}`)).total, 1);
    assert.equal((await q(`kifle_ketema_id=${fx.jiren.id}`)).total, 2);
    assert.equal((await q('q=Hirmata')).total, 1);
    assert.equal((await q('status=DISPOSED')).total, 0);
    assert.equal((await q('page_size=2&page=2')).rows.length, 2);
  });

  it('treats search text literally (no wildcard abuse)', async () => {
    const res = await api('get', '/api/assets?q=%25', fx.users.mayor).expect(200);
    assert.equal(res.body.total, 0);
  });

  it('exports a CSV that neutralises spreadsheet formulas', async () => {
    const a = await createAsset(fx, fx.users.officer, { name: '=HYPERLINK("http://evil","x")' });
    const csv = await api('get', '/api/assets/export.csv', fx.users.officer).expect(200);
    assert.ok(csv.text.includes('\'=HYPERLINK'));
    assert.ok(a.id);
  });
});

describe('approval workflow and status', () => {
  let fx;
  before(async () => { fx = await setupFixture(); });

  const act = (user, asset, action, comment) =>
    api('post', `/api/assets/${asset.id}/workflow`, user).send({ action, comment });

  it('walks DRAFT -> SUBMITTED -> REVIEWED -> APPROVED -> ACTIVE and sets the operational status', async () => {
    const a = await photographed(fx, fx.users.officer);
    await activateAsset(fx, a);
    const now = (await api('get', `/api/assets/${a.id}`, fx.users.jirenAdmin)).body.asset;
    assert.equal(now.approval_state, 'ACTIVE');
    assert.equal(now.status, 'ACTIVE'); // REGISTERED becomes ACTIVE on activation
    const trail = await db('audit_logs').where({ asset_id: a.id }).pluck('action');
    for (const x of ['SUBMIT', 'REVIEW', 'APPROVE', 'ACTIVATE']) assert.ok(trail.includes(x), x);
  });

  it('refuses steps out of order', async () => {
    const a = await photographed(fx, fx.users.officer);
    await act(fx.users.jirenAdmin, a, 'approve').expect(409);
    await act(fx.users.officer, a, 'submit').expect(200);
    await act(fx.users.officer, a, 'submit').expect(409);
    await act(fx.users.jirenAdmin, a, 'activate').expect(409);
  });

  it('separation of duties: the submitter cannot review or approve their own asset', async () => {
    const a = await photographed(fx, fx.users.officer);
    await act(fx.users.kebeleA, a, 'submit').expect(200); // the Kebele Administrator may edit, so it may submit
    const res = await act(fx.users.kebeleA, a, 'review').expect(409);
    assert.match(res.body.error, /Separation of duties/);
  });

  it('separation of duties: the reviewer cannot also approve', async () => {
    await allow(fx, 'KEBELE_ADMIN', 'asset.approve'); // only possible when one role may do both steps
    const a = await photographed(fx, fx.users.officer);
    await act(fx.users.officer, a, 'submit').expect(200);
    await api('post', `/api/assets/${a.id}/workflow`, fx.users.kebeleA).send({ action: 'review', evidence: await siteEvidence(a, fx.users.kebeleA) }).expect(200);
    await act(fx.users.kebeleA, a, 'approve').expect(409);
    await act(fx.users.jirenAdmin, a, 'approve').expect(200);
    await restore(fx, 'KEBELE_ADMIN');
  });

  it('verifying a registration needs evidence from the site, and the approver sees it', async () => {
    const review = (a, evidence) => api('post', `/api/assets/${a.id}/workflow`, fx.users.kebeleA).send({ action: 'review', evidence });
    // an asset with a recorded location
    const a = await photographed(fx, fx.users.officer, { latitude: 7.6731, longitude: 36.8344 });
    await act(fx.users.officer, a, 'submit').expect(200);
    const none = await review(a).expect(400);
    assert.match(JSON.stringify(none.body), /location, a photo/);
    // the photo must be one the verifier took of this asset, not the registration photo
    const theirs = await siteEvidence(a, fx.users.officer);
    const notMine = await review(a, { ...theirs }).expect(400);
    assert.ok(notMine.body.details.photo_document_id);
    await review(a, { ...(await siteEvidence(a, fx.users.kebeleA)), found_condition: 'WRONG' }).expect(400);
    // about 1.1 km away, with the asset's own QR label scanned
    const far = await siteEvidence(a, fx.users.kebeleA, { latitude: 7.6831, qr_code: `https://assets.jimma.example/scan/${a.asset_code}`, found_condition: 'FAIR', note: 'Parked at the depot' });
    await review(a, far).expect(200);
    const detail = (await api('get', `/api/assets/${a.id}`, fx.users.jirenAdmin).expect(200)).body;
    const [check] = detail.site_checks;
    assert.equal(detail.asset.approval_state, 'REVIEWED');
    assert.ok(check.distance_m > 1000 && check.distance_m < 1200, String(check.distance_m));
    assert.deepEqual([check.far, check.qr_scanned, check.found_condition, check.location_saved], [true, true, 'FAIR', false]);
    assert.equal(detail.site_check_max_distance_m, 300);
    // the approval queue shows it too
    const queue = (await api('get', '/api/assets?approval_state=REVIEWED&page_size=100', fx.users.jirenAdmin).expect(200)).body.rows;
    const row = queue.find((r) => r.id === a.id);
    assert.equal(Number(row.site_far), 1);
    assert.equal(row.site_found_condition, 'FAIR');
    // an asset without a recorded location gets the verifier's location; a scan of another label does not count
    const b = await photographed(fx, fx.users.officer);
    await act(fx.users.officer, b, 'submit').expect(200);
    await review(b, await siteEvidence(b, fx.users.kebeleA, { qr_code: a.asset_code })).expect(200);
    const after = (await api('get', `/api/assets/${b.id}`, fx.users.kebeleA).expect(200)).body;
    assert.deepEqual([after.site_checks[0].location_saved, after.site_checks[0].qr_scanned, after.site_checks[0].far], [true, false, false]);
    assert.equal(Number(after.asset.latitude), 7.6731);
  });

  it('roles outside the registration chain cannot verify', async () => {
    const a = await photographed(fx, fx.users.officer);
    await act(fx.users.officer, a, 'submit').expect(200);
    await act(fx.users.inspector, a, 'review').expect(403);
    await act(fx.users.mayor, a, 'review').expect(403);
  });

  it('a rejection needs a reason, returns the asset to DRAFT, and clears the sign-offs', async () => {
    const a = await photographed(fx, fx.users.officer);
    await act(fx.users.officer, a, 'submit').expect(200);
    await act(fx.users.kebeleA, a, 'reject').expect(400);
    await act(fx.users.kebeleA, a, 'reject', 'Missing ownership document').expect(200);
    const row = await db('assets').where({ id: a.id }).first();
    assert.equal(row.approval_state, 'DRAFT');
    assert.equal(row.submitted_by, null);
  });

  it('exposes only the steps the current user may take', async () => {
    const a = await photographed(fx, fx.users.officer);
    const asOfficer = (await api('get', `/api/assets/${a.id}`, fx.users.officer)).body.permissions;
    assert.deepEqual(asOfficer.workflow, ['submit']);
    await act(fx.users.officer, a, 'submit');
    const asVerifier = (await api('get', `/api/assets/${a.id}`, fx.users.kebeleA)).body.permissions;
    assert.deepEqual(asVerifier.workflow.sort(), ['reject', 'review']);
    const asMayor = (await api('get', `/api/assets/${a.id}`, fx.users.mayor)).body.permissions;
    assert.deepEqual(asMayor.workflow, []);
    assert.equal(asMayor.can_edit, false);
  });

  it('an asset cannot be put into operation before it is approved', async () => {
    const a = await photographed(fx, fx.users.officer);
    await api('post', `/api/assets/${a.id}/status`, fx.users.officer).send({ status: 'RENTED', reason: 'Tenant moved in' }).expect(409);
    await api('post', `/api/assets/${a.id}/status`, fx.users.officer).send({ status: 'INACTIVE', reason: 'Not yet needed' }).expect(200);
  });

  it('every status change needs a reason and is logged', async () => {
    const a = await photographed(fx, fx.users.officer);
    await api('post', `/api/assets/${a.id}/status`, fx.users.officer).send({ status: 'DAMAGED' }).expect(400);
    await api('post', `/api/assets/${a.id}/status`, fx.users.officer).send({ status: 'DAMAGED', reason: 'Flood' }).expect(200);
    const log = await db('audit_logs').where({ asset_id: a.id, action: 'STATUS_CHANGE' }).first();
    assert.match(log.summary, /DAMAGED/);
  });

  it('disposal needs a request, a review and a final approval by different people; the record then locks', async () => {
    const a = await photographed(fx, fx.users.officer);
    // two different people must decide: here the Kebele Administrator reviews and the Kifle Ketema Administrator approves
    await allow(fx, 'KEBELE_ADMIN', 'request.decide');
    // the plain status change cannot be used to dispose of an asset
    await api('post', `/api/assets/${a.id}/status`, fx.users.officer).send({ status: 'DISPOSED', reason: 'Scrapped' }).expect(400);
    const body = { kind: 'DISPOSAL', reason: 'Scrapped', method: 'SCRAP', disposal_date: '2026-07-01', disposal_value: 1200 };
    await api('post', `/api/assets/${a.id}/disposal`, fx.users.inspector).send(body).expect(403);
    await api('post', `/api/assets/${a.id}/disposal`, fx.users.officer).send({ ...body, method: '' }).expect(400); // method is required to dispose
    const requested = await api('post', `/api/assets/${a.id}/disposal`, fx.users.officer).send(body).expect(202);
    const id = requested.body.request.id;
    await api('post', `/api/assets/${a.id}/disposal`, fx.users.officer).send(body).expect(409); // already waiting
    assert.notEqual((await db('assets').where({ id: a.id }).first()).status, 'DISPOSED'); // nothing happened yet
    await api('post', `/api/requests/${id}/review`, fx.users.officer).expect(403); // cannot approve requests
    await api('post', `/api/requests/${id}/approve`, fx.users.jirenAdmin).expect(409); // must be reviewed first
    await api('post', `/api/requests/${id}/review`, fx.users.kebeleA).expect(200);
    await api('post', `/api/requests/${id}/approve`, fx.users.kebeleA).expect(409); // the reviewer cannot also approve
    await api('post', `/api/requests/${id}/approve`, fx.users.jirenAdmin).expect(200);
    await restore(fx, 'KEBELE_ADMIN');
    const disposal = await db('asset_disposals').where({ asset_id: a.id }).first();
    assert.equal(disposal.method, 'SCRAP');
    assert.equal(disposal.approved_by, fx.users.jirenAdmin.id);
    await api('patch', `/api/assets/${a.id}`, fx.users.officer).send({ name: 'Renamed' }).expect(409);
    await api('post', `/api/assets/${a.id}/maintenance`, fx.users.officer).send({ maintenance_date: '2026-01-01', maintenance_type: 'x' }).expect(409);
    await api('post', `/api/assets/${a.id}/status`, fx.users.officer).send({ status: 'ACTIVE', reason: 'Oops' }).expect(409);
    await act(fx.users.officer, a, 'submit').expect(409);
    const detail = (await api('get', `/api/assets/${a.id}`, fx.users.officer)).body;
    assert.equal(detail.permissions.locked, true);
    assert.ok(detail.asset.disposed_at);
  });
});

describe('asset history: utilization, maintenance, inspection, transfer, valuation', () => {
  let fx; let asset;
  before(async () => {
    fx = await setupFixture();
    asset = await createAsset(fx, fx.users.officer);
  });

  const post = (path, body, user = fx.users.officer) => api('post', `/api/assets/${asset.id}/${path}`, user).send(body);

  it('records a use that does not generate revenue', async () => {
    await post('utilizations', { use_type: 'PUBLIC_SERVICE', user_party: 'Health Office', start_date: '2026-01-01' }).expect(201);
    const d = (await api('get', `/api/assets/${asset.id}`, fx.users.officer)).body;
    assert.equal(d.asset.generates_revenue, false);
  });

  it('a revenue-generating current use flips the flag; ending it flips it back', async () => {
    const u = (await post('utilizations', {
      use_type: 'EQUIPMENT_HIRE', user_party: 'Contractor X', start_date: '2026-01-01', generates_revenue: true,
      revenue_sector_id: fx.construction.id, authorization_basis: 'Council decision 12/2026',
    }).expect(201)).body;
    assert.equal((await api('get', `/api/assets/${asset.id}`, fx.users.officer)).body.asset.generates_revenue, true);
    await post(`utilizations/${u.id}/end`, { end_date: '2026-02-01' }).expect(200);
    assert.equal((await api('get', `/api/assets/${asset.id}`, fx.users.officer)).body.asset.generates_revenue, false);
    await post(`utilizations/${u.id}/end`, { end_date: '2026-03-01' }).expect(409); // already ended
  });

  it('a revenue classification is only allowed when the use generates revenue; dates must be in order', async () => {
    const r = await post('utilizations', { use_type: 'GOVERNMENT_USE', start_date: '2026-01-01', revenue_sector_id: fx.construction.id }).expect(400);
    assert.ok(r.body.details.revenue_sector_id);
    const d = await post('utilizations', { use_type: 'IDLE', start_date: '2026-05-01', end_date: '2026-04-01' }).expect(400);
    assert.ok(d.body.details.end_date);
  });

  it('records maintenance, totals its cost, and ignores cancelled work', async () => {
    await post('maintenance', { maintenance_date: '2026-03-01', maintenance_type: 'Engine service', cost: 45000, provider: 'XYZ Workshop' }).expect(201);
    await post('maintenance', { maintenance_date: '2026-04-01', maintenance_type: 'Hydraulics', cost: 5000, status: 'CANCELLED' }).expect(201);
    const d = (await api('get', `/api/assets/${asset.id}`, fx.users.officer)).body;
    assert.equal(d.asset.total_maintenance_cost, 45000);
    assert.equal(d.maintenance.length, 2);
    await post('maintenance', { maintenance_date: '2026-03-01', maintenance_type: 'x', next_maintenance_date: '2026-02-01' }).expect(400);
    await post('maintenance', { maintenance_date: '2026-03-01', maintenance_type: 'x', cost: -1 }).expect(400);
  });

  it('an inspection updates the asset condition and keeps the previous one in the history', async () => {
    await post('inspections', { inspection_date: '2026-05-01', inspector: 'Ato Kebede', condition_found: 'POOR', notes: 'Worn tracks' }, fx.users.inspector).expect(201);
    const d = (await api('get', `/api/assets/${asset.id}`, fx.users.officer)).body;
    assert.equal(d.asset.condition, 'POOR');
    assert.ok(d.history.some((h) => h.action === 'CONDITION_CHANGE' && /GOOD → POOR/.test(h.summary)));
  });

  it('a transfer moves the asset but keeps both ends in the history', async () => {
    const requested = await post('transfers', {
      to_kebele_id: fx.k2, to_location_detail: 'Road project depot', transfer_date: '2026-06-01',
      reason: 'Road construction project', authorized_by: 'Construction Department Head', new_holder: 'Road team',
    }).expect(202);
    const rid = requested.body.request.id;
    assert.equal((await api('get', `/api/assets/${asset.id}`, fx.users.officer)).body.asset.kebele_id, fx.k1); // not moved until approved
    await api('post', `/api/requests/${rid}/approve`, fx.users.officer).expect(403);
    await api('post', `/api/requests/${rid}/approve`, fx.users.jirenAdmin).expect(200);
    const d = (await api('get', `/api/assets/${asset.id}`, fx.users.officer)).body;
    assert.equal(d.asset.kebele_id, fx.k2);
    assert.equal(d.asset.current_holder, 'Road team');
    assert.equal(d.transfers.length, 1);
    assert.equal(d.transfers[0].from_kebele_name, 'Jiren Kebele A');
    assert.equal(d.transfers[0].to_kebele_name, 'Jiren Kebele B');
    assert.equal(d.transfers[0].from_location_detail, 'Municipal Construction Office');
  });

  it('refuses a transfer to the same place, and one that leaves your own area', async () => {
    await post('transfers', { to_kebele_id: fx.k2, to_location_detail: 'Road project depot', transfer_date: '2026-06-02', reason: 'x', authorized_by: 'y' }).expect(400);
    const r = await post('transfers', { to_kebele_id: fx.k3, transfer_date: '2026-06-02', reason: 'x', authorized_by: 'y' }).expect(403);
    assert.ok(r.body.error);
    // the Construction Sector Administrator covers every Kebele, so it can ask for the move; the Kifle Ketema Administrator of the asset decides
    const cross = await post('transfers', { to_kebele_id: fx.k3, transfer_date: '2026-06-02', reason: 'Cross-Kifle move', authorized_by: 'Mayor' }, fx.users.sectorAdmin).expect(202);
    await api('post', `/api/requests/${cross.body.request.id}/approve`, fx.users.sectorAdmin).expect(403); // it requests, it does not decide
    await api('post', `/api/requests/${cross.body.request.id}/approve`, fx.users.jirenAdmin).expect(200);
    assert.equal((await db('assets').where({ id: asset.id }).first()).kebele_id, fx.k3);
  });

  it('requires a reason and an authoriser for a transfer', async () => {
    const r = await post('transfers', { to_kebele_id: fx.k1, transfer_date: '2026-06-03' }, fx.users.sectorAdmin).expect(400);
    assert.ok(r.body.details.reason && r.body.details.authorized_by);
  });

  it('the latest valuation becomes the current one, without losing older ones', async () => {
    const finance = fx.users.finance; // the Financial Officer records valuations (the asset is now in Hirmata)
    await post('valuations', { valuation_date: '2026-01-01', value: 8500000, method: 'Purchase price' }, finance).expect(201);
    await post('valuations', { valuation_date: '2026-09-01', value: 7800000, method: 'Annual revaluation' }, finance).expect(201);
    await post('valuations', { valuation_date: '2026-03-01', value: 8000000 }, finance).expect(201); // back-dated: must not override the latest
    const d = (await api('get', `/api/assets/${asset.id}`, finance)).body;
    assert.equal(d.asset.current_valuation, 7800000);
    assert.equal(d.valuations.length, 3);
  });

  it('the history timeline lists everything that happened, newest first', async () => {
    const d = (await api('get', `/api/assets/${asset.id}`, fx.users.mayor)).body;
    const actions = d.history.map((h) => h.action);
    for (const a of ['CREATE', 'UTILIZATION_ADD', 'MAINTENANCE_ADD', 'INSPECTION_ADD', 'TRANSFER', 'VALUATION_ADD']) assert.ok(actions.includes(a), a);
    for (let i = 1; i < d.history.length; i += 1) assert.ok(d.history[i - 1].id > d.history[i].id);
  });
});

describe('documents and photos', () => {
  let fx; let asset; let other;
  before(async () => {
    fx = await setupFixture();
    asset = await createAsset(fx, fx.users.officer);
    other = await createAsset(fx, fx.users.sectorAdmin, { kebele_id: fx.k3 });
  });

  const upload = (a, user, buffer, filename, type, extra = {}) =>
    api('post', `/api/assets/${a.id}/documents`, user)
      .field('doc_type', extra.doc_type ?? 'OWNERSHIP').field('title', extra.title ?? 'Title deed')
      .attach('file', buffer, { filename, contentType: type });

  it('uploads and downloads a document through an authenticated, scope-checked route', async () => {
    const res = await upload(asset, fx.users.officer, Buffer.from('%PDF-1.4 test'), 'deed.pdf', 'application/pdf').expect(201);
    const dl = await api('get', `/api/assets/${asset.id}/documents/${res.body.id}/download`, fx.users.officer).expect(200);
    assert.equal(dl.headers['content-type'].split(';')[0], 'application/pdf');
    assert.match(dl.headers['content-disposition'], /attachment/);
    await api('get', `/api/assets/${asset.id}/documents/${res.body.id}/download`, fx.users.kebeleA).expect(200); // same Kebele
    await api('get', `/api/assets/${asset.id}/documents/${res.body.id}/download`, fx.users.nobody).expect(404);
    await api('get', `/api/assets/${asset.id}/documents/${res.body.id}/download`).expect(401);
  });

  it('stores files under random names, never the uploaded name', async () => {
    const row = await db('asset_documents').where({ asset_id: asset.id }).first();
    assert.notEqual(row.stored_name, 'deed.pdf');
    assert.match(row.stored_name, /^[0-9a-f-]{36}\.pdf$/);
  });

  it('rejects file types that are not allowed (scripts, HTML, SVG) and mismatched types', async () => {
    await upload(asset, fx.users.officer, Buffer.from('<script>alert(1)</script>'), 'x.html', 'text/html').expect(400);
    await upload(asset, fx.users.officer, Buffer.from('<svg onload=alert(1)>'), 'x.svg', 'image/svg+xml').expect(400);
    await upload(asset, fx.users.officer, Buffer.from('MZ'), 'x.pdf', 'application/x-msdownload').expect(400);
  });

  it('requires a title and a valid document type, and leaves no orphan file behind', async () => {
    const files = async () => (await import('node:fs')).readdirSync((await import('../src/config.js')).config.uploadDir).length;
    const before = await files();
    await upload(asset, fx.users.officer, Buffer.from('%PDF'), 'a.pdf', 'application/pdf', { title: '' }).expect(400);
    await upload(asset, fx.users.officer, Buffer.from('%PDF'), 'a.pdf', 'application/pdf', { doc_type: 'NOPE' }).expect(400);
    assert.equal(await files(), before);
  });

  it('cannot upload to an asset outside your area, or as a read-only user', async () => {
    await upload(other, fx.users.kebeleA, Buffer.from('%PDF'), 'a.pdf', 'application/pdf').expect(404);
    await upload(asset, fx.users.mayor, Buffer.from('%PDF'), 'a.pdf', 'application/pdf').expect(403);
  });

  it('removes a document and its file, and logs it', async () => {
    const res = await upload(asset, fx.users.officer, Buffer.from('%PDF-x'), 'tmp.pdf', 'application/pdf', { title: 'Temp' }).expect(201);
    const row = await db('asset_documents').where({ id: res.body.id }).first();
    await api('delete', `/api/assets/${asset.id}/documents/${res.body.id}`, fx.users.officer).expect(200);
    const { config } = await import('../src/config.js');
    const fs = await import('node:fs');
    assert.equal(fs.existsSync(`${config.uploadDir}/${row.stored_name}`), false);
    assert.ok(await db('audit_logs').where({ action: 'DOCUMENT_REMOVE', asset_id: asset.id }).first());
  });
});

after(closeDb); // one pool for the whole file
