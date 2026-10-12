import './env.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { db } from '../src/db.js';
import { app, setupFixture, api, closeDb, PASSWORD } from './helpers.js';

describe('authentication', () => {
  let fx;
  before(async () => { fx = await setupFixture(); });

  it('signs in with the right password and returns the user with role scope', async () => {
    const res = await request(app).post('/api/auth/login').send({ username: 'kebelea', password: PASSWORD }).expect(200);
    assert.ok(res.body.token);
    assert.equal(res.body.user.role, 'KEBELE_ADMIN');
    assert.deepEqual(res.body.user.scope.kebeles, [fx.k1]);
    assert.equal(res.body.user.password_hash, undefined);
  });

  it('is not case sensitive for the username', async () => {
    await request(app).post('/api/auth/login').send({ username: 'KebeleA', password: PASSWORD }).expect(200);
  });

  it('rejects a wrong password and an unknown user with the same message', async () => {
    const a = await request(app).post('/api/auth/login').send({ username: 'kebelea', password: 'nope' }).expect(401);
    const b = await request(app).post('/api/auth/login').send({ username: 'ghost', password: 'nope' }).expect(401);
    assert.equal(a.body.error, b.body.error);
  });

  it('rejects requests without a token or with a bad token', async () => {
    await request(app).get('/api/assets').expect(401);
    await request(app).get('/api/assets').set('Authorization', 'Bearer not.a.token').expect(401);
  });

  it('blocks a deactivated user even with a previously valid token', async () => {
    await db('users').where({ id: fx.users.inspector.id }).update({ is_active: false });
    await api('get', '/api/assets', fx.users.inspector).expect(401);
    const refused = await request(app).post('/api/auth/login').send({ username: 'inspector', password: PASSWORD }).expect(403);
    assert.match(refused.body.error, /deactivated/);
    // a wrong password still gets the general answer, so nothing is revealed to someone guessing
    await request(app).post('/api/auth/login').send({ username: 'inspector', password: 'wrong-password' }).expect(401);
    await db('users').where({ id: fx.users.inspector.id }).update({ is_active: true });
  });

  it('locks out repeated failures for the same username', async () => {
    for (let i = 0; i < 8; i += 1) {
      await request(app).post('/api/auth/login').send({ username: 'mayor', password: 'wrong' }).expect(401);
    }
    await request(app).post('/api/auth/login').send({ username: 'mayor', password: PASSWORD }).expect(429);
  });

  it('changes a password only when the current one is right, and enforces length', async () => {
    const u = fx.users.officer;
    await api('post', '/api/auth/change-password', u).send({ current_password: 'wrong', new_password: 'A-long-new-password' }).expect(400);
    await api('post', '/api/auth/change-password', u).send({ current_password: PASSWORD, new_password: 'short' }).expect(400);
    await api('post', '/api/auth/change-password', u).send({ current_password: PASSWORD, new_password: 'A-long-new-password' }).expect(200);
    await request(app).post('/api/auth/login').send({ username: 'officer', password: 'A-long-new-password' }).expect(200);
  });

  it('records sign-ins and failures in the audit log', async () => {
    const logs = await db('audit_logs').whereIn('action', ['LOGIN', 'LOGIN_FAILED']);
    assert.ok(logs.some((l) => l.action === 'LOGIN'));
    assert.ok(logs.some((l) => l.action === 'LOGIN_FAILED'));
  });
});

after(closeDb); // one pool for the whole file
