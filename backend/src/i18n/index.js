import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// Translations. English is the source language: the English sentence is the key, so a missing
// translation simply shows the English text. Keys may hold {placeholders}, e.g.
//   "{code}: maintenance due {date}"  ->  "{code}: ... {date} ..."
// The same dictionaries serve the web app (via /api/i18n/:lang) and the PDF/CSV exports.

export const LANGUAGES = {
  en: { code: 'en', name: 'English', native: 'English' },
  am: { code: 'am', name: 'Amharic', native: 'አማርኛ' },
  om: { code: 'om', name: 'Afaan Oromo', native: 'Afaan Oromoo' },
};

const load = (lang) => JSON.parse(fs.readFileSync(fileURLToPath(new URL(`./${lang}.json`, import.meta.url)), 'utf8'));
const cache = {};

export function entries(lang) {
  if (lang === 'en' || !LANGUAGES[lang]) return {};
  cache[lang] ||= load(lang);
  return cache[lang];
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const patternCache = {};

function patterns(lang) {
  if (patternCache[lang]) return patternCache[lang];
  const out = [];
  for (const [key, value] of Object.entries(entries(lang))) {
    if (!/\{\w+\}/.test(key) || key.replace(/\{\w+\}/g, '').trim().length < 6) continue; // too generic to match free text
    const names = [];
    const source = key.split(/(\{\w+\})/).map((part) => {
      const m = /^\{(\w+)\}$/.exec(part);
      if (!m) return escapeRe(part);
      names.push(m[1]);
      return '(.+?)';
    }).join('');
    out.push({ re: new RegExp(`^${source}$`, 's'), names, value });
  }
  // longest (most specific) templates first
  out.sort((a, b) => b.re.source.length - a.re.source.length);
  patternCache[lang] = out;
  return out;
}

/** Translate a text (or a template with params) into `lang`; falls back to the English text. */
export function tr(lang, text, params) {
  if (text == null || text === '') return text;
  const dict = entries(lang);
  let template = dict[text];
  if (template === undefined && !params) {
    for (const p of patterns(lang)) {
      const m = p.re.exec(text);
      if (m) return p.value.replace(/\{(\w+)\}/g, (_, n) => m[p.names.indexOf(n) + 1] ?? `{${n}}`);
    }
  }
  template ??= text;
  return params ? template.replace(/\{(\w+)\}/g, (_, n) => (n in params ? params[n] : `{${n}}`)) : template;
}

export const normalizeLang = (v) => (LANGUAGES[v] ? v : 'en');
