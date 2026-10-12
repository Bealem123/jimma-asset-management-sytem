import { getLanguage, t } from './i18n.jsx';
import { ET_MONTHS, GC_MONTHS, gcDate, gcRange, toEthiopian } from './calendar.js';

// Dates for display. In English everything is Gregorian and English: a reporting month that follows the Ethiopian
// calendar is named by its Gregorian dates ("June 8 – July 7, 2026"), never by its Ethiopian name. In Amharic and
// Afaan Oromo both calendars are shown, with the month names in that language.
// The server decides the reporting periods; this file only shows them.

export { ET_MONTHS, GC_MONTHS };

const english = () => getLanguage() === 'en';

/** "Tikimt 1, 2019 E.C." (translated); in English the Gregorian date instead. */
export function ethDate(iso) {
  if (!iso) return '—';
  if (english()) return gcDate(iso);
  const e = toEthiopian(iso);
  return `${t(ET_MONTHS[e.month - 1])} ${e.day}, ${e.year} ${t('E.C.')}`;
}

/** English: "June 20, 2026". Amharic / Afaan Oromo: "2026-06-20 · Sene 13, 2018 E.C." in that language. */
export const bothDates = (iso) => {
  if (!iso) return '—';
  return english() ? gcDate(iso) : `${String(iso).slice(0, 10)} · ${ethDate(iso)}`;
};

/** The name of a reporting month. English: "June 8 – July 7, 2026" (Ethiopian month) or "June 2026". */
export const periodName = (p) => {
  if (p.calendar === 'GC') return `${t(GC_MONTHS[p.month - 1])} ${p.year}`;
  return english() ? gcRange(p.start, p.end) : `${t(ET_MONTHS[p.month - 1])} ${p.year} ${t('E.C.')}`;
};

/** The same month in the other calendar; empty in English, where the name already gives the Gregorian dates. */
export const periodSpan = (p) => {
  if (english()) return '';
  return p.calendar === 'ET' ? `${p.start} – ${p.end}` : `${ethDate(p.start)} – ${ethDate(p.end)}`;
};
