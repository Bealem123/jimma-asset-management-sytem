import './env.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  addPhoto, api, closeDb, createAsset, setupFixture,
} from './helpers.js';

after(closeDb);

describe('the dashboard says what happened to the assets, not who opened which file', () => {
  let fx; let asset;
  before(async () => {
    fx = await setupFixture();
    asset = await createAsset(fx, fx.users.officer, { name: 'Road roller' });
    const photo = await addPhoto(asset, fx.users.officer);
    await api('post', `/api/assets/${asset.id}/workflow`, fx.users.officer).send({ action: 'submit' }).expect(200);
    // the Kebele Administrator opens the photo twice, then sends the asset back with a reason
    for (let i = 0; i < 2; i++) await api('get', `/api/assets/${asset.id}/documents/${photo.id}/download`, fx.users.kebeleA).expect(200);
    await api('post', `/api/assets/${asset.id}/workflow`, fx.users.kebeleA).send({ action: 'reject', comment: 'The plate number is missing' }).expect(200);
  });

  it('lists outcomes with the full name and role of who did them', async () => {
    const rows = (await api('get', '/api/dashboard', fx.users.officer).expect(200)).body.recent_activity;
    const actions = rows.map((r) => r.action);
    assert.deepEqual(actions, ['REJECT', 'SUBMIT', 'CREATE']); // newest first
    assert.ok(!actions.includes('DOCUMENT_DOWNLOAD') && !actions.includes('DOCUMENT_ADD'));
    const back = rows[0];
    assert.equal(back.reason, 'The plate number is missing');
    assert.equal(back.who, 'Test kebelea');
    assert.equal(back.who_role, 'KEBELE_ADMIN');
    assert.equal(back.asset_code, asset.asset_code);
    assert.equal(back.asset_name, 'Road roller');
  });

  it('the downloads are still in the audit log', async () => {
    const log = (await api('get', `/api/audit?asset_id=${asset.id}`, fx.users.auditor).expect(200)).body;
    const list = Array.isArray(log) ? log : log.rows || log.items || [];
    assert.equal(list.filter((r) => r.action === 'DOCUMENT_DOWNLOAD').length, 2);
  });
});
