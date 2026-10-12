import './env.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { api, closeDb, setupFixture } from './helpers.js';
import { db } from '../src/db.js';
import { config } from '../src/config.js';

after(closeDb);

// the smallest real JPEG header is enough: the server checks the type and the first bytes, the browser does the rest
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 2)]);

const put = (url, user, buffer, filename = 'photo.jpg', type = 'image/jpeg') =>
  api('put', url, user).attach('photo', buffer, { filename, contentType: type });
const stored = async (id) => (await db('users').where({ id }).first('photo_name')).photo_name;

describe('profile pictures', () => {
  let fx;
  before(async () => { fx = await setupFixture(); });

  it('every account starts without a picture', async () => {
    const me = (await api('get', '/api/auth/me', fx.users.inspector).expect(200)).body.user;
    assert.equal(me.photo, null);
  });

  it('anyone can add, see, replace and remove their own picture', async () => {
    const first = (await put('/api/auth/photo', fx.users.mayor, JPEG).expect(200)).body.photo;
    assert.ok(first);
    assert.equal((await api('get', '/api/auth/me', fx.users.mayor)).body.user.photo, first);
    const oldFile = path.join(config.uploadDir, await stored(fx.users.mayor.id));
    assert.ok(fs.existsSync(oldFile));

    // any signed-in colleague can see it
    const img = await api('get', `/api/auth/photo/${fx.users.mayor.id}`, fx.users.kebeleA).expect(200);
    assert.match(img.headers['content-type'], /image\/jpeg/);

    // a new picture gets a new version and the old file is deleted
    const second = (await put('/api/auth/photo', fx.users.mayor, PNG, 'me.png', 'image/png').expect(200)).body.photo;
    assert.notEqual(second, first);
    assert.ok(!fs.existsSync(oldFile));

    await api('delete', '/api/auth/photo', fx.users.mayor).expect(200);
    assert.equal(await stored(fx.users.mayor.id), null);
    await api('get', `/api/auth/photo/${fx.users.mayor.id}`, fx.users.kebeleA).expect(404);

    const history = await db('audit_logs').where({ entity: 'user', entity_id: fx.users.mayor.id }).whereIn('action', ['PHOTO_CHANGE', 'PHOTO_REMOVE']);
    assert.equal(history.length, 3);
  });

  it('refuses files that are not pictures, and anyone not signed in', async () => {
    await put('/api/auth/photo', fx.users.auditor, Buffer.from('%PDF-1.4 not a picture'), 'cv.pdf', 'application/pdf').expect(400);
    // a renamed file: declared as a JPEG, but it is not one
    await put('/api/auth/photo', fx.users.auditor, Buffer.from('hello world, I am text'), 'fake.jpg', 'image/jpeg').expect(400);
    await api('put', '/api/auth/photo', fx.users.auditor).expect(400);
    assert.equal(await stored(fx.users.auditor.id), null);
    await api('get', `/api/auth/photo/${fx.users.auditor.id}`).expect(401);
  });

  it('an administrator can set the picture of an account they manage, and only those', async () => {
    const res = await put(`/api/users/${fx.users.jirenAdmin.id}/photo`, fx.users.super, JPEG).expect(200);
    const listed = (await api('get', '/api/users', fx.users.super)).body.find((u) => u.id === fx.users.jirenAdmin.id);
    assert.equal(listed.photo, res.body.photo);
    assert.equal(listed.photo_name, undefined); // the stored file name is never sent

    // the Kifle Ketema Administrator manages Kebele Administrators, not the Mayor
    const refused = await put(`/api/users/${fx.users.mayor.id}/photo`, fx.users.jirenAdmin, JPEG);
    assert.ok([403, 404].includes(refused.status), `got ${refused.status}`);
    await put(`/api/users/${fx.users.kebeleA.id}/photo`, fx.users.jirenAdmin, JPEG).expect(200);
    await api('delete', `/api/users/${fx.users.kebeleA.id}/photo`, fx.users.jirenAdmin).expect(200);
    assert.equal(await stored(fx.users.kebeleA.id), null);
  });
});
