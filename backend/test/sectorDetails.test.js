import './env.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  addPhoto, api, assetBody, closeDb, createAsset, registerWithPhoto, setupFixture,
} from './helpers.js';
import { SECTOR_FIELDS } from '../src/lib/sectorFields.js';
import { SECTORS } from '../src/scripts/masterData.js';

after(closeDb);

describe('what each sector records about its own assets', () => {
  let fx;
  before(async () => { fx = await setupFixture(); });

  it('every one of the 13 sectors has its own fields, at least one of them required, and the form can read them', async () => {
    assert.deepEqual(Object.keys(SECTOR_FIELDS).sort(), SECTORS.map(([code]) => code).sort());
    for (const [code, fields] of Object.entries(SECTOR_FIELDS)) {
      assert.ok(fields.some((f) => f.required), `${code} has no required field`);
      assert.equal(new Set(fields.map((f) => f.key)).size, fields.length, `${code} repeats a field`);
    }
    const enums = (await api('get', '/api/enums').expect(200)).body;
    assert.equal(enums.sector_fields.RNT[0].key, 'rental_type');
  });

  it('keeps only the fields of the asset\'s sector that apply, with numbers as numbers', async () => {
    const a = await createAsset(fx, fx.users.officer, {
      details: { con_kind: 'Construction machine', make_model: ' CAT 320 ', engine_hours: '1250', project_name: 'Not asked for a machine', plot_number: 'Not this sector' },
    });
    const saved = (await api('get', `/api/assets/${a.id}`, fx.users.officer)).body.asset.details;
    assert.deepEqual(saved, { con_kind: 'Construction machine', make_model: 'CAT 320', engine_hours: 1250 });
    // a value that is not one of the options, or not a number, is refused
    const wrong = await api('post', '/api/assets', fx.users.officer).send(assetBody(fx, { details: { con_kind: 'Spaceship' } })).expect(400);
    assert.ok(wrong.body.details['details.con_kind']);
    await api('post', '/api/assets', fx.users.officer).send(assetBody(fx, { details: { con_kind: 'Construction machine', engine_hours: 'many' } })).expect(400);
  });

  it('the required ones are needed to send it for verification, not to keep a draft', async () => {
    const draft = await createAsset(fx, fx.users.officer, { details: {} });
    await addPhoto(draft, fx.users.officer);
    const refused = await api('post', `/api/assets/${draft.id}/workflow`, fx.users.officer).send({ action: 'submit' }).expect(400);
    assert.ok(refused.body.details['details.con_kind']);
    const straight = await registerWithPhoto(fx.users.officer, assetBody(fx, { details: {}, submit: true })).expect(400);
    assert.ok(straight.body.details['details.con_kind']);
    await api('patch', `/api/assets/${draft.id}`, fx.users.officer).send({ details: { con_kind: 'Material yard' } }).expect(200);
    await api('post', `/api/assets/${draft.id}/workflow`, fx.users.officer).send({ action: 'submit' }).expect(200);
  });

  it('changing the sector keeps only what applies to the new one, and the change is in the history', async () => {
    const a = await createAsset(fx, fx.users.officer, { details: { con_kind: 'Construction machine', make_model: 'Volvo' } });
    const res = await api('patch', `/api/assets/${a.id}`, fx.users.officer)
      .send({ sector_id: fx.business.id, department_id: null, details: { premises_type: 'Kiosk', monthly_rent_etb: 3500 } }).expect(200);
    assert.deepEqual(res.body.details, { premises_type: 'Kiosk', monthly_rent_etb: 3500 });
    const { history } = (await api('get', `/api/assets/${a.id}`, fx.users.officer)).body;
    assert.ok(history.some((h) => h.action === 'UPDATE' && JSON.stringify(h).includes('details')));
  });

  it('a type that is not in the list can be typed in, and choosing a listed type replaces it', async () => {
    const a = await createAsset(fx, fx.users.officer, { asset_type_id: null, asset_type_other: 'Concrete mixer' });
    const shown = (await api('get', `/api/assets/${a.id}`, fx.users.officer)).body.asset;
    assert.equal(shown.asset_type_other, 'Concrete mixer');
    assert.equal(shown.asset_type_name, 'Concrete mixer'); // lists, the asset page and exports show it as its type
    const res = await api('patch', `/api/assets/${a.id}`, fx.users.officer).send({ asset_type_id: fx.excavator.id }).expect(200);
    assert.equal(res.body.asset_type_other, null);
    assert.equal(res.body.asset_type_name, 'Excavator');
  });

  it('a money field (such as the rent) is hidden from roles that may not see money', async () => {
    const a = await createAsset(fx, fx.users.officer, { sector_id: fx.business.id, department_id: null, details: { premises_type: 'Shop', monthly_rent_etb: 4200, unit_no: 'B-12' } });
    // the Inspector checks condition, not money
    const asInspector = (await api('get', `/api/assets/${a.id}`, fx.users.inspector)).body.asset.details;
    assert.deepEqual(asInspector, { premises_type: 'Shop', unit_no: 'B-12' });
    const asFinance = (await api('get', `/api/assets/${a.id}`, fx.users.finance)).body.asset.details;
    assert.equal(asFinance.monthly_rent_etb, 4200);
  });
});
