// The separate copy of the system for the INSA security assessment: its own database (jimma_ams_insa), its own upload
// folder and its own port, with fictitious assets and one test account per role, so the real accounts and data are
// never touched by the testers.
//
//   npm run insa:setup    empties jimma_ams_insa, builds the schema, fills it with fictitious data, creates the test
//                         accounts with temporary passwords and writes them to credentials/insa-test-accounts.json
//   npm run insa:start    runs the copy (port INSA_PORT, default 4100)
//
// The database must exist and the application user must have rights on it (see docs/INSA_Submission).
const INSA_DB = 'jimma_ams_insa';
const port = process.env.INSA_PORT || '4100';
process.env.DB_NAME = INSA_DB;
process.env.PORT = port;
process.env.UPLOAD_DIR = 'uploads-insa';
process.env.AUTO_BACKUP = 'false';
// printed QR codes of the copy open the copy, not the real system
if (process.env.INSA_PUBLIC_URL) process.env.PUBLIC_URL = process.env.INSA_PUBLIC_URL;

const command = process.argv[2];
if (command === 'start') {
  await import('dotenv/config');
  if (!process.env.INSA_PUBLIC_URL && process.env.PUBLIC_URL) process.env.PUBLIC_URL = process.env.PUBLIC_URL.replace(/:\d+(\/?)$/, `:${port}$1`);
  await import('../server.js');
} else if (command === 'setup') {
  await setup();
} else {
  console.log('Usage: node src/scripts/insaTestCopy.js setup | start');
  process.exitCode = 1;
}

async function setup() {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const bcrypt = (await import('bcryptjs')).default;
  const request = (await import('supertest')).default;
  const { db } = await import('../db.js');
  const { createApp } = await import('../app.js');
  const { signToken } = await import('../middleware/auth.js');
  const { seedMaster } = await import('./masterData.js');
  const { BCRYPT_ROUNDS, strongTemporaryPassword } = await import('../lib/security.js');
  const { invalidatePermissionCache } = await import('../lib/permissions.js');
  const { ROLE_LABELS } = await import('../lib/constants.js');

  if (db.client.config.connection.database !== INSA_DB) throw new Error(`Refusing to set up a database other than ${INSA_DB}.`);
  try {
    // ---------------------------------------------------------------- a clean schema and the master data
    await db.raw('SET FOREIGN_KEY_CHECKS = 0');
    const [tables] = await db.raw('SHOW TABLES');
    for (const row of tables) await db.raw(`DROP TABLE IF EXISTS \`${Object.values(row)[0]}\``);
    await db.raw('SET FOREIGN_KEY_CHECKS = 1');
    await db.migrate.latest();
    await seedMaster();
    invalidatePermissionCache();

    // The City has not yet confirmed which Kebele belongs to which Kifle Ketema. The copy needs a mapping to work, so it
    // uses this one; it is test data only and says nothing about the official structure.
    const MAPPING = {
      Jiren: ['Jiren', 'Ginjo', 'Ginjo Guduru', 'Mendera Kochi', 'Awetu Mendera'],
      Hirmata: ['Hirmata', 'Hirmata Mentina', 'Hirmata Merkato', 'Mentina'],
      Gibe: ['Bosa Addis Ketema', 'Bosa Kito', 'Becho Bore', 'Seto Semero'],
    };
    const kifle = {};
    for (const [k, kebeles] of Object.entries(MAPPING)) {
      kifle[k] = (await db('kifle_ketemas').where({ name: k }).first()).id;
      await db('kebeles').whereIn('name', kebeles).update({ kifle_ketema_id: kifle[k] });
    }
    const kebele = async (name) => (await db('kebeles').where({ name }).first()).id;
    const sector = async (code) => (await db('sectors').where({ code }).first()).id;
    const ginjo = await kebele('Ginjo');
    const hirmata = await kebele('Hirmata');
    const CON = await sector('CON');
    const BUS = await sector('BUS');

    // ---------------------------------------------------------------- the test accounts
    const ACCOUNTS = [
      ['insa.superadmin', 'SUPER_ADMIN', 'Superadmin', {}, 'Whole City'],
      ['insa.mayor', 'EXECUTIVE', 'Mayor', {}, 'Whole City'],
      ['insa.auditor', 'AUDITOR', 'Auditor', {}, 'Whole City'],
      ['insa.kifle.jiren', 'KIFLE_ADMIN', 'Jiren Administrator', { kifle: [kifle.Jiren] }, 'Kifle Ketema Jiren'],
      ['insa.kebele.ginjo', 'KEBELE_ADMIN', 'Ginjo Administrator', { kebeles: [ginjo] }, 'Kebele Ginjo (Jiren)'],
      ['insa.sector.ginjo', 'SECTOR_ADMIN', 'Construction Ginjo', { kebeles: [ginjo], sectors: [CON] }, 'Construction sector, Kebele Ginjo (Jiren)'],
      ['insa.kifle.hirmata', 'KIFLE_ADMIN', 'Hirmata Administrator', { kifle: [kifle.Hirmata] }, 'Kifle Ketema Hirmata'],
      ['insa.kebele.hirmata', 'KEBELE_ADMIN', 'Hirmata Kebele Administrator', { kebeles: [hirmata] }, 'Kebele Hirmata (Hirmata)'],
      ['insa.sector.hirmata', 'SECTOR_ADMIN', 'Business Hirmata', { kebeles: [hirmata], sectors: [BUS] }, 'Business & Trade sector, Kebele Hirmata (Hirmata)'],
      ['insa.finance.jiren', 'FINANCIAL_OFFICER', 'Finance Jiren', { kifle: [kifle.Jiren] }, 'Kifle Ketema Jiren'],
      ['insa.inspector.jiren', 'INSPECTOR', 'Inspector Jiren', { kifle: [kifle.Jiren] }, 'Kifle Ketema Jiren'],
    ];
    const users = {};
    for (const [username, role, father, scope, area] of ACCOUNTS) {
      const [id] = await db('users').insert({
        username, role, first_name: 'Test', father_name: father, full_name: `Test ${father}`,
        password_hash: await bcrypt.hash(strongTemporaryPassword(), 4), // replaced below
        phone: null, email: null,
      });
      for (const x of scope.kifle || []) await db('user_kifle_ketemas').insert({ user_id: id, kifle_ketema_id: x });
      for (const x of scope.kebeles || []) await db('user_kebeles').insert({ user_id: id, kebele_id: x });
      for (const x of scope.sectors || []) await db('user_sectors').insert({ user_id: id, sector_id: x });
      users[username] = { id, username, role, area, headers: { Authorization: `Bearer ${signToken({ id })}` } };
    }

    // ---------------------------------------------------------------- fictitious assets, through the real API
    const app = createApp();
    const call = (method, url, u) => request(app)[method](url).set(u.headers);
    const ok = async (req, label) => {
      const res = await req;
      if (res.status >= 300) throw new Error(`${label}: ${res.status} ${JSON.stringify(res.body)}`);
      return res.body;
    };
    const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
    const photo = (asset, u) => ok(call('post', `/api/assets/${asset.id}/documents`, u)
      .field('doc_type', 'PHOTO').field('title', 'Photo of the asset').attach('file', PNG, { filename: 'asset.png', contentType: 'image/png' }), 'photo');
    const cat = async (name, type) => {
      const c = await db('asset_categories').where({ name }).first();
      return { category_id: c.id, asset_type_id: (await db('asset_types').where({ category_id: c.id, name: type }).first()).id };
    };
    const machine = async (type) => ({ ...(await cat('Machinery & Equipment', type)), sector_id: CON, kebele_id: ginjo, details: { con_kind: 'Construction machine' } });
    const shop = async () => ({ ...(await cat('Buildings', 'Shop')), sector_id: BUS, kebele_id: hirmata, details: { premises_type: 'Shop' } });

    const chains = {
      [ginjo]: [users['insa.sector.ginjo'], users['insa.kebele.ginjo'], users['insa.kifle.jiren']],
      [hirmata]: [users['insa.sector.hirmata'], users['insa.kebele.hirmata'], users['insa.kifle.hirmata']],
    };
    async function register(body, stage) {
      const [registrar, reviewer, approver] = chains[body.kebele_id];
      const asset = await ok(call('post', '/api/assets', registrar).send({ condition: 'GOOD', ...body }), `register ${body.name}`);
      if (stage === 'draft') return asset;
      await photo(asset, registrar);
      await ok(call('post', `/api/assets/${asset.id}/workflow`, registrar).send({ action: 'submit' }), 'submit');
      if (stage === 'submitted') return asset;
      const site = await photo(asset, reviewer);
      const evidence = { latitude: 7.6731, longitude: 36.8344, accuracy_m: 12, found_condition: body.condition || 'GOOD', photo_document_id: site.id };
      await ok(call('post', `/api/assets/${asset.id}/workflow`, reviewer).send({ action: 'review', evidence }), 'review');
      await ok(call('post', `/api/assets/${asset.id}/workflow`, approver).send({ action: 'approve' }), 'approve');
      await ok(call('post', `/api/assets/${asset.id}/workflow`, approver).send({ action: 'activate' }), 'activate');
      return asset;
    }
    const made = [];
    made.push(await register({ name: 'Test excavator CAT 320', ...(await machine('Excavator')), location_detail: 'Municipal construction yard', serial_number: 'TEST-EXC-001', acquisition_cost: 4500000 }, 'active'));
    made.push(await register({ name: 'Test wheel loader', ...(await machine('Loader')), location_detail: 'Municipal construction yard', condition: 'FAIR', acquisition_cost: 3200000 }, 'active'));
    made.push(await register({ name: 'Test diesel generator 60 kVA', ...(await machine('Generator')), location_detail: 'Kebele office compound', condition: 'POOR', acquisition_cost: 850000 }, 'active'));
    made.push(await register({ name: 'Test tractor', ...(await machine('Tractor')), location_detail: 'Ginjo road depot', acquisition_cost: 1900000 }, 'submitted'));
    made.push(await register({ name: 'Test workshop compressor', ...(await machine('Workshop equipment')), location_detail: 'Workshop B' }, 'draft'));
    made.push(await register({ name: 'Test market shop H-01', ...(await shop()), location_detail: 'Hirmata market, row H', acquisition_cost: 600000 }, 'active'));
    made.push(await register({ name: 'Test market shop H-02', ...(await shop()), location_detail: 'Hirmata market, row H', condition: 'FAIR', acquisition_cost: 600000 }, 'active'));
    made.push(await register({ name: 'Test market shop H-03', ...(await shop()), location_detail: 'Hirmata market, row H' }, 'submitted'));

    // a valuation, an income record, an inspection and planned maintenance, so every role has something to see
    const today = new Date().toISOString().slice(0, 10);
    const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
    await ok(call('post', '/api/finance/valuations', users['insa.finance.jiren']).send({ asset_id: made[0].id, valuation_date: today, value: 4100000, method: 'Market appraisal' }), 'valuation');
    await ok(call('post', `/api/assets/${made[2].id}/inspections`, users['insa.inspector.jiren']).send({ inspection_date: today, inspector: 'Test Inspector', condition_found: 'POOR', result: 'FAILED', notes: 'Fictitious test inspection: fuel leak.', next_inspection_date: inDays(30) }), 'inspection');
    await ok(call('post', `/api/assets/${made[1].id}/maintenance`, users['insa.sector.ginjo']).send({ maintenance_date: today, maintenance_type: 'PREVENTIVE', description: 'Fictitious test service', status: 'PLANNED', next_maintenance_date: inDays(10) }), 'maintenance');

    // ---------------------------------------------------------------- hand-over: temporary passwords
    const days = Number(process.env.INSA_PASSWORD_DAYS || 30); // long enough for the assessment window
    const handover = [];
    for (const [username, role, , , area] of ACCOUNTS) {
      const password = strongTemporaryPassword();
      await db('users').where({ id: users[username].id }).update({
        password_hash: await bcrypt.hash(password, BCRYPT_ROUNDS), must_change_password: true,
        temp_password_expires_at: new Date(Date.now() + days * 86400000), token_version: db.raw('token_version + 1'), failed_logins: 0, locked_until: null,
      });
      handover.push({ username, password, role, role_label: ROLE_LABELS[role], area });
    }
    const dir = path.resolve('credentials');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'insa-test-accounts.json');
    fs.writeFileSync(file, JSON.stringify({ created_at: new Date().toISOString(), valid_days: days, port, accounts: handover }, null, 2), { mode: 0o600 });
    console.log(`Test copy ready in ${INSA_DB}: ${made.length} fictitious assets, ${handover.length} test accounts.`);
    console.log(`Temporary passwords written to ${file} (git-ignored). Make the hand-over PDFs, then delete this file.`);
    console.log(`Start the copy with: npm run insa:start   (port ${port})`);
  } finally {
    await db.destroy();
  }
}
