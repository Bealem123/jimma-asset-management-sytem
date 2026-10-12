import './env.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  TINY_PNG, api, assetBody, closeDb, registerWithPhoto, setupFixture,
} from './helpers.js';
import { db } from '../src/db.js';

after(closeDb);

describe('the public card a printed QR code opens', () => {
  let fx; let asset; let token; let deed;
  before(async () => {
    fx = await setupFixture();
    const res = await registerWithPhoto(fx.users.officer, assetBody(fx, {
      name: 'Shop block B', sector_id: fx.business.id, department_id: null, serial_number: 'SN-SECRET-1', registration_number: '3-AA-12345',
      latitude: 7.6731, longitude: 36.8344, acquisition_cost: 1500000, current_holder: 'Abebe Kebede',
      details: { premises_type: 'Shop', unit_no: 'B-12', occupant: 'Abebe Trading', licence_no: 'TL-99', monthly_rent_etb: 4200 },
    })).expect(201);
    asset = res.body;
    deed = await api('post', `/api/assets/${asset.id}/documents`, fx.users.officer)
      .field('doc_type', 'OWNERSHIP').field('title', 'Title deed')
      .attach('file', Buffer.from('%PDF-1.4 deed'), { filename: 'deed.pdf', contentType: 'application/pdf' }).expect(201);
    // drawing the QR code gives the asset its public address
    const qr = await api('get', `/api/assets/${asset.id}/qr.svg`, fx.users.officer).expect(200);
    const svg = qr.text || String(qr.body);
    token = (await db('assets').where({ id: asset.id }).first()).public_token;
    assert.match(token, /^[A-Za-z0-9_-]{16}$/);
    assert.ok(svg.length > 100);
  });

  it('opens without signing in, with the photos and the public facts', async () => {
    const card = (await api('get', `/api/public/assets/${token}`).expect(200)).body;
    assert.equal(card.asset.name, 'Shop block B');
    assert.equal(card.asset.asset_code, asset.asset_code);
    assert.equal(card.asset.registration_number, '3-AA-12345');
    assert.equal(card.photos.length, 1);
    assert.deepEqual(card.sector_details.map((d) => d.label), ['Type of premises', 'Unit / stall number']);
    const img = await api('get', `/api/public/assets/${token}/photos/${card.photos[0].id}`).expect(200);
    assert.match(img.headers['content-type'], /image\/png/);
    assert.equal(img.body.length, TINY_PNG.length);
  });

  it('never shows money, people, the GPS position, identification numbers or other documents', async () => {
    const text = JSON.stringify((await api('get', `/api/public/assets/${token}`)).body);
    for (const secret of ['1500000', 'SN-SECRET-1', 'Abebe', 'TL-99', '4200', '7.6731', '36.8344', 'Test officer', 'Title deed']) {
      assert.ok(!text.includes(secret), `the card shows ${secret}`);
    }
    await api('get', `/api/public/assets/${token}/photos/${deed.body.id}`).expect(404); // the deed is not a photo
  });

  it('cannot be found by guessing: the asset code or a wrong token opens nothing', async () => {
    await api('get', `/api/public/assets/${asset.asset_code}`).expect(404);
    await api('get', '/api/public/assets/AAAAAAAAAAAAAAAA').expect(404);
  });

  it('the same QR code opens the full record in the system\'s own scanner', async () => {
    const res = await api('post', '/api/assets/scan', fx.users.kebeleA).send({ code: `https://assets.example/a/${token}` }).expect(200);
    assert.equal(res.body.id, asset.id);
    // a label printed earlier, with the plain Asset ID, still works
    await api('post', '/api/assets/scan', fx.users.kebeleA).send({ code: asset.asset_code }).expect(200);
  });
});
