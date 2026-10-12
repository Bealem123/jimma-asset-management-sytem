// Calendar arithmetic only (no text, no translation): the Ethiopian and Gregorian calendars through the Julian Day
// Number, mirroring backend/src/lib/calendar.js. ethiopian.js and i18n.jsx build what is shown on top of it.

export const ET_MONTHS = ['Meskerem', 'Tikimt', 'Hidar', 'Tahsas', 'Tir', 'Yekatit', 'Megabit', 'Miyazya', 'Ginbot', 'Sene', 'Hamle', 'Nehase', 'Pagume'];
export const GC_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const ET_EPOCH = 1724221; // Julian Day Number of Meskerem 1, year 1
const UNIX_EPOCH_JDN = 2440588; // 1970-01-01
const DAY = 86400000;

const isoToJdn = (iso) => {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY) + UNIX_EPOCH_JDN;
};
const jdnToIso = (jdn) => new Date((jdn - UNIX_EPOCH_JDN) * DAY).toISOString().slice(0, 10);
const ethiopianToJdn = (year, month, day) => ET_EPOCH - 1 + 365 * (year - 1) + Math.floor(year / 4) + 30 * (month - 1) + day;

/** ISO date -> { year, month (1-13), day } in the Ethiopian calendar. */
export function toEthiopian(iso) {
  const days = isoToJdn(iso) - ET_EPOCH;
  const cycle = Math.floor(days / 1461);
  const r = days - cycle * 1461;
  const starts = [0, 365, 730, 1096];
  const i = r >= 1096 ? 3 : r >= 730 ? 2 : r >= 365 ? 1 : 0;
  const dayOfYear = r - starts[i];
  return { year: cycle * 4 + i + 1, month: Math.floor(dayOfYear / 30) + 1, day: (dayOfYear % 30) + 1 };
}

/** Ethiopian year, month (1-13), day -> ISO date. */
export const fromEthiopian = (year, month, day) => jdnToIso(ethiopianToJdn(year, month, day));

/** The Gregorian first and last day of an Ethiopian reporting month (Nehase runs to the end of Pagume, as on the server). */
export function etReportingMonth(year, month) {
  const next = month >= 12 ? ethiopianToJdn(year + 1, 1, 1) : ethiopianToJdn(year, month + 1, 1);
  return { start: fromEthiopian(year, month, 1), end: jdnToIso(next - 1) };
}

const parts = (iso) => String(iso).slice(0, 10).split('-').map(Number);

/** "June 20, 2026". `monthName` turns 'June' into the displayed name. */
export function gcDate(iso, monthName = (m) => m) {
  const [y, m, d] = parts(iso);
  return `${monthName(GC_MONTHS[m - 1])} ${d}, ${y}`;
}

/** "June 8 – July 7, 2026", or "December 10, 2025 – January 8, 2026" across a new year. */
export function gcRange(start, end, monthName = (m) => m) {
  const [y1, m1, d1] = parts(start);
  const [y2] = parts(end);
  const from = y1 === y2 ? `${monthName(GC_MONTHS[m1 - 1])} ${d1}` : gcDate(start, monthName);
  return `${from} – ${gcDate(end, monthName)}`;
}
