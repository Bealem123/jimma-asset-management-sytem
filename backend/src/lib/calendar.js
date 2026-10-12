// Ethiopian and Gregorian calendars, and the monthly reporting periods built on them.
//
// The Ethiopian year has 12 months of 30 days and Pagume, a 13th month of 5 days (6 in a leap year, the year before
// a year divisible by 4). It starts on Meskerem 1, which is 11 September (12 September before a Gregorian leap year).
// Dates are converted through the Julian Day Number. Pagume is too short to report on by itself, so the reporting
// period of Nehase runs to the end of Pagume.
// Every date in and out is an ISO string, YYYY-MM-DD, read as a calendar day (no time zone).

export const CALENDARS = ['ET', 'GC'];
export const ET_MONTHS = ['Meskerem', 'Tikimt', 'Hidar', 'Tahsas', 'Tir', 'Yekatit', 'Megabit', 'Miyazya', 'Ginbot', 'Sene', 'Hamle', 'Nehase', 'Pagume'];
export const GC_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const ET_EPOCH = 1724221; // Julian Day Number of Meskerem 1, year 1 (Amete Mihret)
const UNIX_EPOCH_JDN = 2440588; // 1970-01-01
const DAY = 86400000;

const pad = (n, w = 2) => String(n).padStart(w, '0');

export function isoToJdn(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY) + UNIX_EPOCH_JDN;
}

export const jdnToIso = (jdn) => new Date((jdn - UNIX_EPOCH_JDN) * DAY).toISOString().slice(0, 10);

/** Ethiopian year, month (1-13) and day -> Julian Day Number. */
export const ethiopianToJdn = (year, month, day) => ET_EPOCH - 1 + 365 * (year - 1) + Math.floor(year / 4) + 30 * (month - 1) + day;

/** Julian Day Number -> { year, month (1-13), day } in the Ethiopian calendar. */
export function jdnToEthiopian(jdn) {
  const days = jdn - ET_EPOCH;
  const cycle = Math.floor(days / 1461); // four years: 365, 365, 366, 365 days
  const r = days - cycle * 1461;
  const starts = [0, 365, 730, 1096];
  const i = r >= 1096 ? 3 : r >= 730 ? 2 : r >= 365 ? 1 : 0;
  const dayOfYear = r - starts[i];
  return { year: cycle * 4 + i + 1, month: Math.floor(dayOfYear / 30) + 1, day: (dayOfYear % 30) + 1 };
}

export const toEthiopian = (iso) => jdnToEthiopian(isoToJdn(iso));
export const fromEthiopian = (year, month, day) => jdnToIso(ethiopianToJdn(year, month, day));

export const addDays = (iso, n) => jdnToIso(isoToJdn(iso) + n);
export const todayIso = (now = new Date()) => now.toISOString().slice(0, 10);

// ---------------------------------------------------------------------------------------------- reporting periods

/** A month of the chosen calendar: { key, calendar, year, month, start, end } (start and end are Gregorian ISO dates). */
function makePeriod(calendar, year, month) {
  if (calendar === 'ET') {
    const start = fromEthiopian(year, month, 1);
    // Nehase also covers Pagume: the period ends the day before the next Meskerem 1
    const end = month === 12 ? addDays(fromEthiopian(year + 1, 1, 1), -1) : addDays(fromEthiopian(year, month + 1, 1), -1);
    return { key: `ET-${year}-${pad(month)}`, calendar, year, month, start, end };
  }
  const start = `${year}-${pad(month)}-01`;
  const end = addDays(month === 12 ? `${year + 1}-01-01` : `${year}-${pad(month + 1)}-01`, -1);
  return { key: `GC-${year}-${pad(month)}`, calendar, year, month, start, end };
}

/** The reporting period that contains a day. */
export function periodOf(iso, calendar = 'ET') {
  if (calendar === 'ET') {
    const e = toEthiopian(iso);
    return makePeriod('ET', e.year, Math.min(e.month, 12)); // a day in Pagume belongs to Nehase
  }
  const [y, m] = String(iso).slice(0, 10).split('-').map(Number);
  return makePeriod('GC', y, m);
}

/** A period from its key (ET-2019-02, GC-2026-10), or null if the key is not a valid period. */
export function periodByKey(key) {
  const m = /^(ET|GC)-(\d{4})-(\d{2})$/.exec(String(key || ''));
  if (!m) return null;
  const [, calendar, year, month] = m;
  if (Number(month) < 1 || Number(month) > 12) return null;
  return makePeriod(calendar, Number(year), Number(month));
}

export const previousPeriod = (p) => periodOf(addDays(p.start, -1), p.calendar);

/** The last `count` periods that have ended by `today`, most recent first. */
export function endedPeriods(today, calendar, count = 6) {
  const out = [];
  let p = previousPeriod(periodOf(today, calendar));
  while (out.length < count) { out.push(p); p = previousPeriod(p); }
  return out;
}

/** "Tikimt 2019 E.C." or "October 2026": used in notifications, which are written in English and translated on display. */
export const periodName = (p) => (p.calendar === 'ET' ? `${ET_MONTHS[p.month - 1]} ${p.year} E.C.` : `${GC_MONTHS[p.month - 1]} ${p.year}`);

/** "2026-11-14 (Hidar 5, 2019 E.C.)": a day in both calendars. */
export function bothCalendars(iso) {
  const e = toEthiopian(iso);
  return `${String(iso).slice(0, 10)} (${ET_MONTHS[e.month - 1]} ${e.day}, ${e.year} E.C.)`;
}
