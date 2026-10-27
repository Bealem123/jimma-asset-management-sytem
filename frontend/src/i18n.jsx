import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ET_MONTHS, GC_MONTHS, etReportingMonth, fromEthiopian, gcDate, gcRange } from './calendar.js';

// Interface languages: English (source), Amharic, Afaan Oromo.
// English text is the translation key. A missing translation shows the English text, so a
// half-translated screen is still usable. Keys may hold {placeholders}.

export const LANGUAGES = [
  { code: 'en', native: 'English' },
  { code: 'am', native: 'አማርኛ' },
  { code: 'om', native: 'Afaan Oromoo' },
];
const CODES = LANGUAGES.map((l) => l.code);
const STORE = 'jimma_ams_lang';
const dictKey = (l) => `jimma_ams_i18n_${l}`;

let current = 'en';
let dict = {};
let patterns = [];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function compile(entries) {
  const out = [];
  for (const [key, value] of Object.entries(entries)) {
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
  return out.sort((a, b) => b.re.source.length - a.re.source.length);
}

const storage = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } },
};

export const getLanguage = () => current;

// Whether the person picked a language on this device (as opposed to getting the browser's default).
// An explicit choice wins over the language saved on the account; otherwise the account's language is used.
export const markChosen = () => storage.set('jimma_ams_lang_chosen', '1');
export const hasChosen = () => storage.get('jimma_ams_lang_chosen') === '1';

// Developer aid: with localStorage 'jimma_i18n_debug' = '1', every translated string is prefixed with an
// invisible marker and recorded in window.__i18nKeys, so untranslated text can be found by script.
const MARK = '⁣'; // translated
const MARK_MISSING = '⁤'; // no translation in this language: shows English
const debugOn = () => storage.get('jimma_i18n_debug') === '1';

export function t(text, params) {
  const out = translate(text, params);
  if (typeof out === 'string' && out && debugOn()) {
    (window.__i18nKeys ||= new Set()).add(text);
    return (current !== 'en' && out === text && /[A-Za-z]{3,}/.test(text) ? MARK_MISSING : MARK) + out;
  }
  return out;
}

// Server messages name Ethiopian months the same way in every language ("Sene 2018 E.C.", "Sene 13, 2018 E.C.").
// Shown in English they become Gregorian dates; in Amharic and Afaan Oromo the month takes that language's name.
const ET_DATE = new RegExp(`\\b(${ET_MONTHS.join('|')})(?: (\\d{1,2}),)? (\\d{4}) E\\.C\\.`, 'g');
const GC_MONTH_YEAR = new RegExp(`\\b(${GC_MONTHS.join('|')}) (\\d{4})\\b`, 'g');
const word = (w) => dict[w] ?? w;

function localizeDates(text) {
  if (typeof text !== 'string') return text;
  let out = text;
  if (out.includes('E.C.')) {
    out = out.replace(ET_DATE, (all, month, day, year) => {
      const m = ET_MONTHS.indexOf(month) + 1;
      if (current === 'en') {
        if (day) return gcDate(fromEthiopian(Number(year), m, Number(day)));
        const { start, end } = etReportingMonth(Number(year), m);
        return gcRange(start, end);
      }
      return day ? `${word(month)} ${day}, ${year} ${word('E.C.')}` : `${word(month)} ${year} ${word('E.C.')}`;
    });
  }
  // a Gregorian month in a server message ("June 2026") takes the month name of the language
  if (current !== 'en') out = out.replace(GC_MONTH_YEAR, (all, month, year) => `${word(month)} ${year}`);
  return out;
}

/** Translate English text, or a template with {params}. Server messages without params are matched against the templates too. */
function translate(rawText, params) {
  const text = params ? rawText : localizeDates(rawText);
  if (text == null || text === '' || current === 'en') {
    return params && text ? String(text).replace(/\{(\w+)\}/g, (_, n) => (n in params ? params[n] : `{${n}}`)) : text;
  }
  let template = dict[text];
  if (template === undefined && !params) {
    for (const p of patterns) {
      const m = p.re.exec(text);
      // a captured part that is itself translated (a field, a role, a sector...) is shown in the language too
      if (m) return p.value.replace(/\{(\w+)\}/g, (_, n) => { const v = m[p.names.indexOf(n) + 1]; return v == null ? `{${n}}` : dict[v] ?? v; });
    }
  }
  template ??= text;
  return params ? template.replace(/\{(\w+)\}/g, (_, n) => (n in params ? params[n] : `{${n}}`)) : template;
}

/** Switch the active dictionary (downloads it, falls back to the copy kept on this device when offline). */
export async function loadLanguage(lang) {
  const code = CODES.includes(lang) ? lang : 'en';
  let entries = {};
  if (code !== 'en') {
    try {
      const res = await fetch(`/api/i18n/${code}`);
      if (!res.ok) throw new Error('bad response');
      entries = (await res.json()).entries || {};
      storage.set(dictKey(code), JSON.stringify(entries));
    } catch {
      try { entries = JSON.parse(storage.get(dictKey(code))) || {}; } catch { entries = {}; }
    }
  }
  current = code;
  dict = entries;
  patterns = compile(entries);
  storage.set(STORE, code);
  if (typeof document !== 'undefined') document.documentElement.lang = code;
  return code;
}

export function preferredLanguage() {
  const saved = storage.get(STORE);
  if (CODES.includes(saved)) return saved;
  const nav = (typeof navigator !== 'undefined' && navigator.language ? navigator.language : 'en').slice(0, 2).toLowerCase();
  return nav === 'am' ? 'am' : nav === 'om' ? 'om' : 'en';
}

const Ctx = createContext({ lang: 'en', setLang: async () => {} });
export const useLanguage = () => useContext(Ctx);

/** Loads the language before anything is drawn. */
export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(null);
  useEffect(() => { loadLanguage(preferredLanguage()).then(setLangState); }, []);
  const setLang = useCallback(async (code) => { setLangState(await loadLanguage(code)); }, []);
  const value = useMemo(() => ({ lang, setLang }), [lang, setLang]);
  if (!lang) return null;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Everything inside is redrawn when the language changes (state inside is reset). */
export function LanguageBoundary({ children }) {
  const { lang } = useLanguage();
  return <div key={lang} style={{ display: 'contents' }}>{children}</div>;
}
