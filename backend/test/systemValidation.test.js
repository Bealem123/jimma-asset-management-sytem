import './env.js';
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { db } from '../src/db.js';
import { app, setupFixture, api, makeUser, createAsset, assetBody } from './helpers.js';

describe('System-Wide Input Validation, Data Integrity & Scope Enforcement', () => {
  // The Financial Officers created here are inactive: these tests check the fields, and each Kifle Ketema has one active officer.
  let fx;
  let testAsset;

  before(async () => {
    fx = await setupFixture();
    testAsset = await createAsset(fx);
  });

  // 1. Name containing numbers or unsupported symbols
  it('1. Rejects person names containing numbers or unsupported symbols', async () => {
    const invalidNames = ['Abebe123', 'John99Doe', 'Alemayehu#1', 'Kebede$$', '12345'];
    for (const name of invalidNames) {
      const res = await api('post', '/api/users', fx.users.super).send({
        username: `testuser.${Date.now().toString(36)}`,
        full_name: name,
        password: 'Valid-Password-10!',
        role: 'KIFLE_ADMIN',
        kifle_ketema_ids: [fx.hirmata.id],
      });
      assert.equal(res.status, 400, `Expected 400 for name "${name}"`);
      assert.ok(res.body.details?.full_name, `Expected error on full_name for "${name}"`);
    }
  });

  // 2. Valid Amharic and Afaan Oromo names
  it('2. Accepts valid Ethiopian names in Amharic (Ethiopic) and Afaan Oromo (Latin with apostrophes/hudhaa)', async () => {
    const validNames = [
      { name: 'ታደለ ከበደ', user: 'tadele.kebede' },
      { name: "Chaltuu Caalaa O'Connor", user: 'chaltu.caalaa' },
      { name: 'Tsegaye Gebre-Medhin', user: 'tsegaye.gm' },
      { name: 'Dr. Almaz Bekele', user: 'almaz.bekele' },
    ];

    for (const [idx, item] of validNames.entries()) {
      const uname = `eth.${item.user}.${idx}`;
      await db('users').where({ username: uname }).del();
      const res = await api('post', '/api/users', fx.users.super).send({
        username: uname,
        full_name: item.name,
        password: 'Valid-Password-10!',
        role: 'FINANCIAL_OFFICER', is_active: false,
        kifle_ketema_ids: [fx.jiren.id],
      });
      assert.equal(res.status, 201, `Failed to create user with name "${item.name}": ${JSON.stringify(res.body)}`);
      assert.equal(res.body.full_name, item.name);
    }
  });

  // 3. Phone number containing alphabetic characters vs valid Ethiopian formats
  it('3. Rejects phone numbers with alphabetic characters and accepts valid Ethiopian/international formats', async () => {
    const badRes = await api('post', '/api/users', fx.users.super).send({
      username: 'badphone.user',
      full_name: 'Test Phone',
      password: 'Valid-Password-10!',
      role: 'FINANCIAL_OFFICER', is_active: false,
      kifle_ketema_ids: [fx.jiren.id],
      phone: '09112233abc',
    });
    assert.equal(badRes.status, 400);
    assert.ok(badRes.body.details?.phone);

    const validPhones = [
      { raw: '0911223344', expected: '+251911223344' },
      { raw: '+251 91 122 3345', expected: '+251911223345' },
      { raw: '0711223346', expected: '+251711223346' },
    ];

    for (const [i, p] of validPhones.entries()) {
      const uname = `phoneuser.${i}`;
      await db('users').where({ username: uname }).del();
      const res = await api('post', '/api/users', fx.users.super).send({
        username: uname,
        full_name: 'Phone Tester',
        password: 'Valid-Password-10!',
        role: 'FINANCIAL_OFFICER', is_active: false,
        kifle_ketema_ids: [fx.jiren.id],
        phone: p.raw,
      });
      assert.equal(res.status, 201, `Expected 201 for phone ${p.raw}`);
      assert.equal(res.body.phone, p.expected);
    }
  });

  // 4. Invalid email addresses
  it('4. Rejects malformed email addresses and normalizes valid ones', async () => {
    const invalidEmails = ['not-an-email', 'missingatsign.com', 'user@', '@domain.com', 'user@domain..com'];
    for (const email of invalidEmails) {
      const res = await api('post', '/api/users', fx.users.super).send({
        username: `emailtest.${Date.now().toString(36)}`,
        full_name: 'Email Tester',
        password: 'Valid-Password-10!',
        role: 'FINANCIAL_OFFICER', is_active: false,
        kifle_ketema_ids: [fx.jiren.id],
        email,
      });
      assert.equal(res.status, 400, `Expected 400 for invalid email "${email}"`);
      assert.ok(res.body.details?.email);
    }

    const validUname = 'norm.email.user';
    await db('users').where({ username: validUname }).del();
    const good = await api('post', '/api/users', fx.users.super).send({
      username: validUname,
      full_name: 'Email Tester Good',
      password: 'Valid-Password-10!',
      role: 'FINANCIAL_OFFICER', is_active: false,
      kifle_ketema_ids: [fx.jiren.id],
      email: '  TEST.User@Jimma.GOV.et  ',
    }).expect(201);
    assert.equal(good.body.email, 'test.user@jimma.gov.et');
  });

  // 5. Empty required fields
  it('5. Rejects requests with empty or missing required fields', async () => {
    const res = await api('post', '/api/assets', fx.users.officer).send({});
    assert.equal(res.status, 400);
    assert.ok(res.body.details?.name, 'Name is required');
    assert.ok(res.body.details?.category_id, 'Category is required');
    assert.ok(res.body.details?.sector_id, 'Sector is required');
  });

  // 6. Negative values in financial fields
  it('6. Rejects negative monetary amounts and quantities', async () => {
    // Negative valuation
    const negVal = await api('post', `/api/assets/${testAsset.id}/valuations`, fx.users.finance).send({
      valuation_date: '2026-05-01',
      value: -5000,
      method: 'Market comparison',
    });
    assert.equal(negVal.status, 400);
    assert.ok(negVal.body.details?.value);

    // Negative revenue
    const negRev = await api('post', `/api/assets/${testAsset.id}/revenues`, fx.users.finance).send({
      revenue_type: 'RENT',
      amount: -100,
      received_date: '2026-05-01',
    });
    assert.equal(negRev.status, 400);
    assert.ok(negRev.body.details?.amount);

    // Negative maintenance cost
    const negMaint = await api('post', `/api/assets/${testAsset.id}/maintenance`, fx.users.officer).send({
      maintenance_date: '2026-05-01',
      maintenance_type: 'Oil Change',
      cost: -250,
    });
    assert.equal(negMaint.status, 400);
    assert.ok(negMaint.body.details?.cost);
  });

  // 7. Invalid dates and out-of-order date ranges
  it('7. Rejects impossible calendar dates (e.g. Feb 30/31) and inverted date ranges', async () => {
    // Impossible calendar date: Feb 30
    const feb30 = await api('post', `/api/assets/${testAsset.id}/valuations`, fx.users.finance).send({
      valuation_date: '2026-02-30',
      value: 10000,
    });
    assert.equal(feb30.status, 400);
    assert.ok(feb30.body.details?.valuation_date);

    // Impossible calendar date: April 31
    const apr31 = await api('post', `/api/assets/${testAsset.id}/valuations`, fx.users.finance).send({
      valuation_date: '2026-04-31',
      value: 10000,
    });
    assert.equal(apr31.status, 400);
    assert.ok(apr31.body.details?.valuation_date);

    // Utilization with end date before start date
    const badRange = await api('post', `/api/assets/${testAsset.id}/utilizations`, fx.users.officer).send({
      use_type: 'GOVERNMENT_USE',
      start_date: '2026-06-15',
      end_date: '2026-06-10',
    });
    assert.equal(badRange.status, 400);
    assert.ok(badRange.body.details?.end_date);
  });

  // 8. Unauthorized dropdown values
  it('8. Rejects unauthorized dropdown and enum values submitted through manipulated requests', async () => {
    // Invalid asset condition
    const badCond = await api('post', `/api/assets/${testAsset.id}/inspections`, fx.users.inspector).send({
      inspection_date: '2026-06-01',
      inspector: 'Ato Inspector',
      condition_found: 'MAGICALLY_RESTORED',
    });
    assert.equal(badCond.status, 400);
    assert.ok(badCond.body.details?.condition_found);

    // Invalid role
    const badRole = await api('post', '/api/users', fx.users.super).send({
      username: 'badrole.user',
      full_name: 'Bad Role',
      password: 'Valid-Password-10!',
      role: 'EMPEROR',
    });
    assert.equal(badRole.status, 400);
    assert.ok(badRole.body.details?.role);
  });

  // 9. Duplicate account identifiers
  it('9. Enforces uniqueness on usernames, email addresses, and phone numbers', async () => {
    const u1 = 'unique.tester.1';
    const email = 'unique.shared@jimma.gov.et';
    const phone = '+251911999888';

    await db('users').where({ username: u1 }).del();
    await db('users').where({ email }).del();
    await db('users').where({ phone }).del();

    await api('post', '/api/users', fx.users.super).send({
      username: u1,
      full_name: 'First User',
      password: 'Valid-Password-10!',
      role: 'FINANCIAL_OFFICER', is_active: false,
      kifle_ketema_ids: [fx.jiren.id],
      email,
      phone,
    }).expect(201);

    const dupUser = await api('post', '/api/users', fx.users.super).send({
      username: u1,
      full_name: 'Duplicate Username User',
      password: 'Valid-Password-10!',
      role: 'FINANCIAL_OFFICER', is_active: false,
      kifle_ketema_ids: [fx.jiren.id],
    });
    assert.equal(dupUser.status, 409);

    const dupEmail = await api('post', '/api/users', fx.users.super).send({
      username: 'unique.tester.2',
      full_name: 'Duplicate Email User',
      password: 'Valid-Password-10!',
      role: 'FINANCIAL_OFFICER', is_active: false,
      kifle_ketema_ids: [fx.jiren.id],
      email: email.toUpperCase(),
    });
    assert.equal(dupEmail.status, 409);

    const dupPhone = await api('post', '/api/users', fx.users.super).send({
      username: 'unique.tester.3',
      full_name: 'Duplicate Phone User',
      password: 'Valid-Password-10!',
      role: 'FINANCIAL_OFFICER', is_active: false,
      kifle_ketema_ids: [fx.jiren.id],
      phone: '0911999888',
    });
    assert.equal(dupPhone.status, 409);
  });

  // 10. Invalid or unauthorized role assignments
  it('10. Prevents privilege escalation and unauthorized role delegations', async () => {
    await api('post', '/api/users', fx.users.sectorAdmin).send({
      username: 'hacker.admin',
      full_name: 'Hacker',
      password: 'Valid-Password-10!',
      role: 'SUPER_ADMIN',
    }).expect(403);

    await api('post', '/api/users', fx.users.kebeleA).send({
      username: 'escalate.kifle',
      full_name: 'Escalate Kifle',
      password: 'Valid-Password-10!',
      role: 'KIFLE_ADMIN',
      kifle_ketema_ids: [fx.jiren.id],
    }).expect(403);

    await api('post', '/api/users', fx.users.super).send({
      username: 'super.makes.kebele',
      full_name: 'Direct Kebele',
      password: 'Valid-Password-10!',
      role: 'KEBELE_ADMIN',
      kebele_ids: [fx.k1],
    }).expect(403);
  });

  // 11. Attempts to access another administrative unit's data (cross-scope)
  it("11. Rejects cross-scope access: users cannot view or manipulate other administrative units' records", async () => {
    // testAsset is in Jiren Kifle Ketema; Hirmata Admin cannot see or edit it
    const res = await api('get', `/api/assets/${testAsset.id}`, fx.users.hirmataAdmin);
    assert.equal(res.status, 404, 'Cross-scope asset must return 404');

    const editRes = await api('patch', `/api/assets/${testAsset.id}`, fx.users.hirmataAdmin).send({
      name: 'Tampered Name',
    });
    assert.equal(editRes.status, 404, 'Cross-scope edit must return 404');
  });

  // 12. Attempts to bypass frontend validation by calling the API directly
  it('12. Rejects raw API calls bypassing frontend constraints', async () => {
    const directPayload = {
      username: 'bypass.<script>alert(1)</script>',
      full_name: '12345 Numeric Only',
      password: 'short',
      role: 'KIFLE_ADMIN',
      kifle_ketema_ids: [fx.hirmata.id],
      email: 'invalid_email',
      phone: 'letters_only',
    };

    const res = await api('post', '/api/users', fx.users.super).send(directPayload);
    assert.equal(res.status, 400);
    assert.ok(res.body.details);
    assert.ok(res.body.details.username || res.body.details.full_name || res.body.details.password);
  });

  // 13. Missing, null, malformed, and unexpected request properties
  it('13. Safely handles missing, null, malformed, and unexpected request properties without crashing', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{ "username": "admin", invalid json }');
    assert.equal(res.status, 400);

    const patchRes = await api('patch', `/api/assets/${testAsset.id}`, fx.users.officer).send({
      name: 'Valid Name Update',
      id: 999999,
      created_at: '1970-01-01',
      non_existent_column: 'arbitrary payload',
    });
    assert.equal(patchRes.status, 200);
    assert.equal(patchRes.body.name, 'Valid Name Update');
    assert.equal(patchRes.body.id, testAsset.id, 'Asset ID must not be overwritten');
  });

  // 14. Valid data that must continue to work
  it('14. Allows valid data and preserves operational workflows', async () => {
    const insp = await api('post', `/api/assets/${testAsset.id}/inspections`, fx.users.inspector).send({
      inspection_date: '2026-06-01',
      inspector: 'Ato Bekele Tadesse',
      condition_found: 'GOOD',
      result: 'PASSED',
      latitude: 7.6753,
      longitude: 36.8344,
      notes: 'Routine scheduled inspection passed.',
    });
    assert.equal(insp.status, 201);
    assert.equal(insp.body.inspector, 'Ato Bekele Tadesse');
    assert.equal(insp.body.condition_found, 'GOOD');
  });

  // 15. Database level constraints
  it('15. Enforces database-level CHECK constraints against corrupted direct inserts', async () => {
    await assert.rejects(
      async () => {
        await db('assets').insert({
          asset_code: 'AST-999999',
          name: 'Corrupt Asset',
          category_id: fx.machinery.id,
          sector_id: fx.construction.id,
          kifle_ketema_id: fx.jiren.id,
          acquisition_cost: -500,
          created_by: fx.users.super.id,
        });
      },
      /check constraint|CHECK constraint/i,
      'Database must enforce CHECK constraint on negative acquisition cost'
    );
  });

  // 16. Names of people or offices, dates of things already done, codes and ledger filters
  it('16. Rejects names without letters, past events dated in the future, malformed codes and ledger filters', async () => {
    const later = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
    const officer = fx.users.officer;
    // a person or office must be named with letters, not digits or symbols alone
    for (const authorized_by of ['12345', '@@@', '<script>']) {
      const res = await api('post', `/api/assets/${testAsset.id}/transfers`, officer)
        .send({ to_kebele_id: fx.k1, transfer_date: '2026-06-01', reason: 'Moved', authorized_by });
      assert.equal(res.status, 400, `authorized_by "${authorized_by}"`);
      assert.ok(res.body.details?.authorized_by);
    }
    // bought, valued or inspected in the future: impossible
    const bought = await api('post', '/api/assets', officer).send(assetBody(fx, { acquisition_date: later }));
    assert.equal(bought.status, 400);
    assert.ok(bought.body.details?.acquisition_date);
    const inspector = await makeUser('future_inspector', 'INSPECTOR', { kebeles: [fx.k1] });
    const inspected = await api('post', `/api/assets/${testAsset.id}/inspections`, inspector)
      .send({ inspection_date: later, inspector: 'Abebe Kebede', condition_found: 'GOOD' });
    assert.equal(inspected.status, 400);
    assert.ok(inspected.body.details?.inspection_date);
    // completed maintenance happened already; planned maintenance may lie ahead
    await api('post', `/api/assets/${testAsset.id}/maintenance`, officer).send({ maintenance_date: later, maintenance_type: 'Service', status: 'COMPLETED' }).expect(400);
    await api('post', `/api/assets/${testAsset.id}/maintenance`, officer).send({ maintenance_date: later, maintenance_type: 'Service', status: 'PLANNED' }).expect(201);
    // a sector code is short letters and digits
    const code = await api('post', '/api/master/sectors', fx.users.super).send({ code: 'bad code!', name: 'Test sector' });
    assert.equal(code.status, 400);
    assert.ok(code.body.details?.code);
    // the finance ledgers refuse impossible filter dates and unknown income types instead of ignoring them
    await api('get', '/api/finance/valuations?from=2026-13-45', fx.users.finance).expect(400);
    await api('get', '/api/finance/revenues?revenue_type=BRIBE', fx.users.finance).expect(400);
    await api('get', '/api/finance/revenues?revenue_type=RENT&from=2026-01-01', fx.users.finance).expect(200);
  });

  // 17. A person is registered by name and father's name; the username is made from the first name
  it("17. Registers people by name and father's name, and makes the username from the first name", async () => {
    const create = (names) => api('post', '/api/users', fx.users.super)
      .send({ ...names, password: 'Valid-Password-10!', role: 'FINANCIAL_OFFICER', is_active: false, kifle_ketema_ids: [fx.jiren.id] });
    // the father's name is required, with or without a username, and as a single full name too
    const noFather = await create({ first_name: 'Abebe' });
    assert.equal(noFather.status, 400);
    assert.ok(noFather.body.details?.father_name);
    assert.ok((await create({ full_name: 'Abebe', username: 'abebe.only' })).body.details?.father_name);
    assert.ok((await create({ first_name: 'Abebe2', father_name: 'Kebede' })).body.details?.first_name, 'a name has no digits');
    // the first name is the username; the next Abebe gets the father's name too, then a number
    const first = await create({ first_name: 'Abebe', father_name: 'Kebede', grandfather_name: 'Tola' });
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.equal(first.body.username, 'abebe');
    assert.equal(first.body.full_name, 'Abebe Kebede Tola');
    assert.deepEqual([first.body.first_name, first.body.father_name, first.body.grandfather_name], ['Abebe', 'Kebede', 'Tola']);
    assert.equal((await create({ first_name: 'Abebe', father_name: 'Kebede' })).body.username, 'abebe.kebede');
    assert.equal((await create({ first_name: 'ABEBE', father_name: 'Kebede' })).body.username, 'abebe.kebede2');
    // a name in Amharic makes an Amharic username
    assert.equal((await create({ first_name: 'ታደለ', father_name: 'ከበደ' })).body.username, 'ታደለ');
    // they sign in with that username
    await db('users').where({ username: 'abebe' }).update({ is_active: true });
    await request(app).post('/api/auth/login').send({ username: 'Abebe', password: 'Valid-Password-10!' }).expect(200);
    await db('users').where({ username: 'abebe' }).update({ is_active: false });
    // changing the father's name changes the full name; it cannot be removed
    const edited = await api('patch', `/api/users/${first.body.id}`, fx.users.super).send({ father_name: 'Bekele' }).expect(200);
    assert.equal(edited.body.full_name, 'Abebe Bekele Tola');
    await api('patch', `/api/users/${first.body.id}`, fx.users.super).send({ father_name: '' }).expect(400);
  });
});
