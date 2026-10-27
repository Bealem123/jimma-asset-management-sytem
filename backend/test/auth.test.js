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

  it('a temporary password stops working when it is not replaced in time', async () => {
    const id = fx.users.inspector.id;
    await db('users').where({ id }).update({ must_change_password: true, temp_password_expires_at: new Date(Date.now() - 60000) });
    const expired = await request(app).post('/api/auth/login').send({ username: 'inspector', password: PASSWORD }).expect(403);
    assert.match(expired.body.error, /temporary password has expired/);
    await db('users').where({ id }).update({ temp_password_expires_at: new Date(Date.now() + 86400000) }); // still in time: it works
    await request(app).post('/api/auth/login').send({ username: 'inspector', password: PASSWORD }).expect(200);
    await db('users').where({ id }).update({ must_change_password: false, temp_password_expires_at: null });
  });

  it('locks the account after 5 wrong passwords in a row, even for the right password, and records it', async () => {
    for (let i = 0; i < 4; i += 1) {
      await request(app).post('/api/auth/login').send({ username: 'mayor', password: 'wrong' }).expect(401);
    }
    const locked = await request(app).post('/api/auth/login').send({ username: 'mayor', password: 'wrong' }).expect(429);
    assert.match(locked.body.error, /Try again in 15 minutes/);
    await request(app).post('/api/auth/login').send({ username: 'mayor', password: PASSWORD }).expect(429);
    const row = await db('users').where({ username: 'mayor' }).first();
    assert.ok(new Date(row.locked_until) > new Date());
    assert.ok(await db('audit_logs').where({ action: 'ACCOUNT_LOCKED', entity_id: row.id }).first());
    // the lock is kept with the account, so another address does not help
    await request(app).post('/api/auth/login').set('X-Forwarded-For', '10.9.8.7').send({ username: 'mayor', password: PASSWORD }).expect(429);
    // a name that does not exist gets the same answer after the same number of tries: nothing tells them apart
    for (let i = 0; i < 5; i += 1) await request(app).post('/api/auth/login').send({ username: 'nobody-here', password: 'wrong' });
    const ghost = await request(app).post('/api/auth/login').send({ username: 'nobody-here', password: 'wrong' }).expect(429);
    assert.equal(ghost.body.error, locked.body.error);
    // when the account's lock is over, signing in works again (here from another address: this one also waits its 15 minutes)
    await db('users').where({ id: row.id }).update({ locked_until: null });
    await request(app).post('/api/auth/login').set('X-Forwarded-For', '10.1.2.3').send({ username: 'mayor', password: PASSWORD }).expect(200);
  });

  it('changes a password only when the current one is right, and enforces length and complexity', async () => {
    const u = fx.users.officer;
    await api('post', '/api/auth/change-password', u).send({ current_password: 'wrong', new_password: 'A-long-new-password-1' }).expect(400);
    for (const weak of ['short', 'alllowercase1!', 'ALLUPPERCASE1!', 'No-Digits-Here', 'NoSymbols123']) {
      await api('post', '/api/auth/change-password', u).send({ current_password: PASSWORD, new_password: weak }).expect(400);
    }
    await api('post', '/api/auth/change-password', u).send({ current_password: PASSWORD, new_password: 'Good-Pass1' }).expect(200);
    await request(app).post('/api/auth/login').send({ username: 'officer', password: 'Good-Pass1' }).expect(200);
  });

  it('signing out ends the session on the server: the token no longer works', async () => {
    const signed = await request(app).post('/api/auth/login').send({ username: 'kebelea', password: PASSWORD }).expect(200);
    const auth = { Authorization: `Bearer ${signed.body.token}` };
    await request(app).get('/api/auth/me').set(auth).expect(200);
    await request(app).post('/api/auth/logout').set(auth).expect(200);
    await request(app).get('/api/auth/me').set(auth).expect(401);
    assert.ok(await db('audit_logs').where({ action: 'LOGOUT' }).first());
  });

  it('a session left without activity for 30 minutes ends', async () => {
    const signed = await request(app).post('/api/auth/login').send({ username: 'kebelea', password: PASSWORD }).expect(200);
    const auth = { Authorization: `Bearer ${signed.body.token}` };
    await db('users').where({ username: 'kebelea' }).update({ last_seen_at: new Date(Date.now() - 31 * 60000) });
    const ended = await request(app).get('/api/auth/me').set(auth).expect(401);
    assert.match(ended.body.error, /without activity/);
  });

  it('answers with security headers, and never lets data be cached', async () => {
    const res = await api('get', '/api/assets', fx.users.jirenAdmin).expect(200); // kebelea signed out above
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.match(res.headers['permissions-policy'], /camera=\(self\)/);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.match(res.headers['content-security-policy'], /frame-ancestors 'self'/);
    assert.equal(res.headers['x-powered-by'], undefined);
  });

  it('records sign-ins and failures in the audit log', async () => {
    const logs = await db('audit_logs').whereIn('action', ['LOGIN', 'LOGIN_FAILED']);
    assert.ok(logs.some((l) => l.action === 'LOGIN'));
    assert.ok(logs.some((l) => l.action === 'LOGIN_FAILED'));
  });
});

after(closeDb); // one pool for the whole file
