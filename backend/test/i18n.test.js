import './env.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { api, closeDb, setupFixture } from './helpers.js';
import { db } from '../src/db.js';
import { entries, tr, LANGUAGES } from '../src/i18n/index.js';

after(closeDb);

const ETHIOPIC = /[ሀ-፿]/;

describe('translations: dictionaries', () => {
  for (const lang of ['am', 'om']) {
    it(`${lang}: has a large, complete dictionary with the same placeholders as the English text`, () => {
      const dict = entries(lang);
      const keys = Object.keys(dict);
      assert.ok(keys.length > 1200, `only ${keys.length} entries`);
      const ph = (s) => (s.match(/\{\w+\}/g) || []).sort().join(',');
      for (const k of keys) {
        assert.ok(typeof dict[k] === 'string' && dict[k].trim().length > 0, `empty translation for "${k}"`);
        assert.equal(ph(dict[k]), ph(k), `placeholders differ for "${k}"`);
      }
    });
  }

  it('Amharic text is really in Ethiopic script, Afaan Oromo in Latin script', () => {
    assert.match(entries('am')['Dashboard'], ETHIOPIC);
    assert.match(entries('am')['Sign in'], ETHIOPIC);
    assert.doesNotMatch(entries('om')['Sign in'], ETHIOPIC);
    assert.ok(entries('om')['Sign in'].length > 0);
  });

  it('the two languages have the same coverage (Afaan Oromo may keep a Latin-script name unchanged)', () => {
    const am = Object.keys(entries('am'));
    const om = new Set(Object.keys(entries('om')));
    const missingInOm = am.filter((k) => !om.has(k));
    // what is missing in Afaan Oromo is a proper name or code that is spelled the same in English
    assert.ok(missingInOm.length < 60, `${missingInOm.length} Amharic entries have no Afaan Oromo counterpart`);
    for (const k of missingInOm) assert.equal(tr('om', k), k);
    assert.ok(Object.keys(entries('om')).length > 1300);
  });

  it('covers the Kifle Ketemas, sectors, roles and conditions in both languages', () => {
    for (const k of ['Super Administrator', 'Inspector', 'Vehicles', 'Excellent', 'Critical', 'Construction', 'Wrong location']) {
      assert.ok(entries('am')[k], `am: ${k}`);
      assert.ok(entries('om')[k], `om: ${k}`);
    }
    // the 13 Kebele names and 3 Kifle Ketemas are translated into Ethiopic script for Amharic
    for (const k of ['Jiren', 'Ginjo', 'Ginjo Guduru', 'Mendera Kochi', 'Awetu Mendera', 'Bosa Addis Ketema', 'Bosa Kito', 'Hirmata Mentina', 'Mentina', 'Hirmata', 'Hirmata Merkato', 'Becho Bore', 'Seto Semero', 'Gibe']) {
      assert.match(entries('am')[k], ETHIOPIC, k);
      assert.ok(tr('om', k).length > 0);
    }
  });

  it('English is the source: it falls back to the text, and unknown languages behave like English', () => {
    assert.equal(tr('en', 'Dashboard'), 'Dashboard');
    assert.equal(tr('xx', 'Dashboard'), 'Dashboard');
    assert.equal(tr('am', 'A sentence nobody translated yet.'), 'A sentence nobody translated yet.');
    assert.equal(tr('am', null), null);
    assert.deepEqual(entries('en'), {});
  });

  it('fills placeholders, and matches server messages that carry data', () => {
    assert.equal(tr('am', '{n} selected', { n: 3 }), entries('am')['{n} selected'].replace('{n}', '3'));
    assert.equal(tr('en', '{n} selected', { n: 3 }), '3 selected');
    const translated = tr('om', 'AST-000123: archived');
    assert.notEqual(translated, 'AST-000123: archived');
    assert.ok(translated.includes('AST-000123'));
  });

  it('a generic template never swallows an ordinary sentence', () => {
    const s = 'This sentence has the word of in it but is not in the dictionary';
    assert.equal(tr('am', s), s);
    assert.equal(tr('om', 'Notes: with something'), 'Notes: with something');
  });
});

describe('translations: API and per-user language', () => {
  let fx;
  before(async () => { fx = await setupFixture(); });

  it('serves the dictionaries to anyone, even before sign-in', async () => {
    const list = (await api('get', '/api/i18n').expect(200)).body;
    assert.deepEqual(list.map((l) => l.code), Object.keys(LANGUAGES));
    assert.equal(list.find((l) => l.code === 'am').native, 'አማርኛ');
    const am = (await api('get', '/api/i18n/am').expect(200)).body;
    assert.equal(am.lang, 'am');
    assert.match(am.entries['Dashboard'], ETHIOPIC);
    const en = (await api('get', '/api/i18n/en').expect(200)).body;
    assert.deepEqual(en.entries, {});
    assert.equal((await api('get', '/api/i18n/zz').expect(200)).body.lang, 'en');
  });

  it('remembers each user\'s language and returns it at sign-in', async () => {
    await api('post', '/api/auth/language', fx.users.officer).send({ language: 'xx' }).expect(400);
    await api('post', '/api/auth/language').send({ language: 'am' }).expect(401);
    await api('post', '/api/auth/language', fx.users.officer).send({ language: 'am' }).expect(200);
    assert.equal((await db('users').where({ id: fx.users.officer.id }).first()).language, 'am');
    assert.equal((await api('get', '/api/auth/me', fx.users.officer)).body.user.language, 'am');
    assert.equal((await api('get', '/api/auth/me', fx.users.mayor)).body.user.language, 'en', 'other users are unaffected');
    const login = await api('post', '/api/auth/login').send({ username: 'officer', password: 'Correct-Horse-9' }).expect(200);
    assert.equal(login.body.user.language, 'am');
  });
});
