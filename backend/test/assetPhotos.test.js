import './env.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  addPhoto, api, assetBody, closeDb, createAsset, registerWithPhoto, setupFixture,
} from './helpers.js';
import { db } from '../src/db.js';
import { config } from '../src/config.js';

after(closeDb);

const filesIn = () => new Set(fs.readdirSync(config.uploadDir));

describe('a photo of the asset at registration', () => {
  let fx;
  before(async () => { fx = await setupFixture(); });

  it('the registration form sends the photo with the asset: it is kept as the registration photo', async () => {
    const res = await registerWithPhoto(fx.users.officer, assetBody(fx, { name: 'Water tanker' })).expect(201);
    const docs = await db('asset_documents').where({ asset_id: res.body.id });
    assert.equal(docs.length, 1);
    assert.equal(docs[0].doc_type, 'PHOTO');
    assert.equal(docs[0].title, 'Registration photo');
    assert.equal(docs[0].uploaded_by, fx.users.officer.id);
    // shown on the asset page to everyone who can see the asset
    const img = await api('get', `/api/assets/${res.body.id}/photo`, fx.users.kebeleA).expect(200);
    assert.match(img.headers['content-type'], /image\/png/);
  });

  it('an asset cannot be sent for verification without a photo', async () => {
    // straight from the form, without a photo: nothing is registered
    const before = Number((await db('assets').count({ n: 'id' }).first()).n);
    const res = await api('post', '/api/assets', fx.users.officer).send(assetBody(fx, { name: 'No photo', submit: true })).expect(400);
    assert.ok(res.body.details.photo);
    assert.equal(Number((await db('assets').count({ n: 'id' }).first()).n), before);

    // a draft without a photo (e.g. from a bulk import) waits until one is added
    const draft = await createAsset(fx, fx.users.officer, { name: 'Draft without photo' });
    const refused = await api('post', `/api/assets/${draft.id}/workflow`, fx.users.officer).send({ action: 'submit' }).expect(400);
    assert.ok(refused.body.details.photo);
    await api('get', `/api/assets/${draft.id}/photo`, fx.users.officer).expect(404);
    await addPhoto(draft, fx.users.officer);
    await api('post', `/api/assets/${draft.id}/workflow`, fx.users.officer).send({ action: 'submit' }).expect(200);
  });

  it('refuses a file that is not a picture, and leaves no file behind when a registration fails', async () => {
    const files = filesIn();
    const notPicture = await api('post', '/api/assets', fx.users.officer)
      .field('data', JSON.stringify(assetBody(fx, { name: 'With a PDF', submit: true })))
      .attach('photo', Buffer.from('%PDF-1.4'), { filename: 'deed.pdf', contentType: 'application/pdf' }).expect(400);
    assert.ok(notPicture.body.details.photo);
    // a valid photo but an invalid asset (no name): refused, and the uploaded photo is removed again
    await registerWithPhoto(fx.users.officer, assetBody(fx, { name: '' })).expect(400);
    assert.deepEqual([...filesIn()].filter((f) => !files.has(f)), []);
    // a read-only role cannot register, with or without a photo
    await registerWithPhoto(fx.users.mayor, assetBody(fx)).expect(403);
    assert.deepEqual([...filesIn()].filter((f) => !files.has(f)).map((f) => path.basename(f)), []);
  });
});
