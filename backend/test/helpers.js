import './env.js';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { db } from '../src/db.js';
import { createApp } from '../src/app.js';
import { signToken } from '../src/middleware/auth.js';
import { seedMaster } from '../src/scripts/masterData.js';
import { invalidatePermissionCache } from '../src/lib/permissions.js';

export const app = createApp();
export const PASSWORD = 'Correct-Horse-9';

/** Empty the test database, re-create the schema and load the starting master data. */
export async function resetDb() {
  if (db.client.config.connection.database !== process.env.DB_NAME_TEST) {
    throw new Error('Refusing to reset a database that is not the test database.');
  }
  await db.raw('SET FOREIGN_KEY_CHECKS = 0');
  const [tables] = await db.raw('SHOW TABLES');
  for (const row of tables) await db.raw(`DROP TABLE IF EXISTS \`${Object.values(row)[0]}\``);
  await db.raw('SET FOREIGN_KEY_CHECKS = 1');
  await db.migrate.latest();
  await seedMaster();
  invalidatePermissionCache();
}

export const byName = (table, name) => db(table).where({ name }).first();

/** Create a user (role + assigned areas) and return ids and ready-to-use auth headers. */
export async function makeUser(username, role, scope = {}) {
  const hash = await bcrypt.hash(PASSWORD, 4);
  const [id] = await db('users').insert({ username, full_name: `Test ${username}`, role, password_hash: hash });
  for (const x of scope.kifle || []) await db('user_kifle_ketemas').insert({ user_id: id, kifle_ketema_id: x });
  for (const x of scope.kebeles || []) await db('user_kebeles').insert({ user_id: id, kebele_id: x });
  for (const x of scope.sectors || []) await db('user_sectors').insert({ user_id: id, sector_id: x });
  return { id, username, headers: { Authorization: `Bearer ${signToken({ id })}` } };
}

/**
 * Standard fixture: Jiren (2 kebeles) and Hirmata (1 kebele), plus users of the eight roles playing the
 * registration chain: a Sector Administrator registers, the Kebele Administrator of the asset's Kebele verifies
 * it on site, the Kifle Ketema Administrator of its area approves and activates it.
 * Returns ids and ready-to-use auth headers.
 */
export async function setupFixture() {
  await resetDb();
  const jiren = await byName('kifle_ketemas', 'Jiren');
  const hirmata = await byName('kifle_ketemas', 'Hirmata');
  const [k1] = await db('kebeles').insert({ name: 'Jiren Kebele A', kifle_ketema_id: jiren.id });
  const [k2] = await db('kebeles').insert({ name: 'Jiren Kebele B', kifle_ketema_id: jiren.id });
  const [k3] = await db('kebeles').insert({ name: 'Hirmata Kebele C', kifle_ketema_id: hirmata.id });
  const construction = await db('sectors').where({ code: 'CON' }).first();
  const business = await db('sectors').where({ code: 'BUS' }).first();
  const [dep] = await db('departments').insert({ name: 'Construction Department', sector_id: construction.id });
  const machinery = await byName('asset_categories', 'Machinery & Equipment');
  const buildings = await byName('asset_categories', 'Buildings');
  const excavator = await db('asset_types').where({ category_id: machinery.id, name: 'Excavator' }).first();
  const shop = await db('asset_types').where({ category_id: buildings.id, name: 'Shop' }).first();

  const make = makeUser;

  const users = {
    super: await make('super', 'SUPER_ADMIN'),
    mayor: await make('mayor', 'EXECUTIVE'),
    auditor: await make('auditor', 'AUDITOR'),
    sectorAdmin: await make('sectoradmin', 'SECTOR_ADMIN', { sectors: [construction.id] }), // Construction, city-wide
    // registers and keeps the records of Construction and Business assets in Kebeles A and B
    officer: await make('officer', 'SECTOR_ADMIN', { sectors: [construction.id, business.id], kebeles: [k1, k2] }),
    jirenAdmin: await make('jirenadmin', 'KIFLE_ADMIN', { kifle: [jiren.id] }),
    hirmataAdmin: await make('hirmataadmin', 'KIFLE_ADMIN', { kifle: [hirmata.id] }),
    kebeleA: await make('kebelea', 'KEBELE_ADMIN', { kebeles: [k1] }),
    kebeleB: await make('kebeleb', 'KEBELE_ADMIN', { kebeles: [k2] }),
    kebeleC: await make('kebelec', 'KEBELE_ADMIN', { kebeles: [k3] }),
    inspector: await make('inspector', 'INSPECTOR', { kebeles: [k1] }),
    finance: await make('finance', 'FINANCIAL_OFFICER', { kifle: [jiren.id, hirmata.id] }),
    nobody: await make('nobody', 'KEBELE_ADMIN'), // no assignments: sees nothing
  };

  return { users, jiren, hirmata, k1, k2, k3, construction, business, dep, machinery, buildings, excavator, shop };
}

/** The Kebele Administrator who verifies, and the Kifle Ketema Administrator who approves, assets in `kebeleId`. */
export function chainFor(fx, kebeleId) {
  const { users } = fx;
  if (kebeleId === fx.k1) return { reviewer: users.kebeleA, approver: users.jirenAdmin };
  if (kebeleId === fx.k2) return { reviewer: users.kebeleB, approver: users.jirenAdmin };
  if (kebeleId === fx.k3) return { reviewer: users.kebeleC, approver: users.hirmataAdmin };
  throw new Error(`No registration chain in the fixture for Kebele ${kebeleId}`);
}

/** A valid asset payload; override any field. */
export const assetBody = (fx, over = {}) => ({
  name: 'Excavator CAT 320',
  category_id: fx.machinery.id,
  asset_type_id: fx.excavator.id,
  sector_id: fx.construction.id,
  department_id: fx.dep,
  kebele_id: fx.k1,
  location_detail: 'Municipal Construction Office',
  condition: 'GOOD',
  // the sector's own required fields (lib/sectorFields.js), so the asset can be sent for verification
  details: sectorDetails(fx, over.sector_id ?? fx.construction.id),
  ...over,
});

/** Required sector details for the fixture's two sectors (Construction and Business & Trade). */
export const sectorDetails = (fx, sectorId) => (sectorId === fx.business.id ? { premises_type: 'Shop' } : { con_kind: 'Construction machine' });

export const api = (method, url, user) => {
  const r = request(app)[method](url);
  return user ? r.set(user.headers) : r;
};

/** Create an asset as `user` (by default the Sector Administrator of Kebeles A and B) and return the response body. */
// a 1x1 PNG: stands in for a photo of the asset (at registration, or taken on site by the Kebele Administrator)
export const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

/** Register an asset the way the form does: the fields as JSON plus a photo of the asset. */
export const registerWithPhoto = (user, body) => api('post', '/api/assets', user)
  .field('data', JSON.stringify(body)).attach('photo', TINY_PNG, { filename: 'asset.png', contentType: 'image/png' });

/** Add a photo of the asset as `user` (an asset is not sent for verification without one). */
export async function addPhoto(asset, user) {
  const up = await api('post', `/api/assets/${asset.id}/documents`, user)
    .field('doc_type', 'PHOTO').field('title', 'Photo of the asset')
    .attach('file', TINY_PNG, { filename: 'asset.png', contentType: 'image/png' });
  if (up.status !== 201) throw new Error(`photo upload failed: ${up.status} ${JSON.stringify(up.body)}`);
  return up.body;
}

/** Create an asset; one sent straight for verification (`submit: true`) carries a photo, as it must. */
export async function createAsset(fx, user = fx.users.officer, over = {}) {
  const body = assetBody(fx, over);
  const res = body.submit ? await registerWithPhoto(user, body) : await api('post', '/api/assets', user).send(body);
  if (res.status !== 201) throw new Error(`createAsset failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

/** Upload a photo as `user` and return on-site evidence for verifying `asset` (location in Jimma, condition GOOD). */
export async function siteEvidence(asset, user, over = {}) {
  const up = await api('post', `/api/assets/${asset.id}/documents`, user)
    .field('doc_type', 'PHOTO').field('title', 'Site verification photo')
    .attach('file', TINY_PNG, { filename: 'site.png', contentType: 'image/png' });
  if (up.status !== 201) throw new Error(`photo upload failed: ${up.status} ${JSON.stringify(up.body)}`);
  return { latitude: 7.6731, longitude: 36.8344, accuracy_m: 12, found_condition: 'GOOD', photo_document_id: up.body.id, ...over };
}

/**
 * Drive an asset through the whole registration chain: the submitter (its Sector Administrator) submits, the
 * Kebele Administrator of its Kebele verifies it on site, the Kifle Ketema Administrator approves and activates it.
 */
export async function activateAsset(fx, asset, submitter = fx.users.officer, chain = chainFor(fx, asset.kebele_id)) {
  const { reviewer, approver } = chain;
  await addPhoto(asset, submitter);
  await api('post', `/api/assets/${asset.id}/workflow`, submitter).send({ action: 'submit' }).expect(200);
  await api('post', `/api/assets/${asset.id}/workflow`, reviewer).send({ action: 'review', evidence: await siteEvidence(asset, reviewer) }).expect(200);
  await api('post', `/api/assets/${asset.id}/workflow`, approver).send({ action: 'approve' }).expect(200);
  await api('post', `/api/assets/${asset.id}/workflow`, approver).send({ action: 'activate' }).expect(200);
}

export async function closeDb() {
  await db.destroy();
}
