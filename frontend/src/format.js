import { t } from './i18n.jsx';

const LABELS = {
  EXECUTIVE: 'Mayor / Executive',
  GOVERNMENT_USE: 'Government use',
  PUBLIC_SERVICE: 'Public service',
  EQUIPMENT_HIRE: 'Equipment hire',
  ADMINISTERED_ON_BEHALF: 'Administered on behalf of another authority',
  UNDER_MAINTENANCE: 'Under maintenance',
  IN_PROGRESS: 'In progress',
  KIFLE_ADMIN: 'Kifle Ketema Administrator',
  SUPER_ADMIN: 'Super Administrator',
  SECTOR_ADMIN: 'Sector Administrator',
  KEBELE_ADMIN: 'Kebele Administrator',
  FINANCIAL_OFFICER: 'Financial Officer',
  AUDITOR: 'Internal Auditor',
  GOVERNMENT_ALLOCATION: 'Government allocation',
  TRANSFER_OUT: 'Transfer out',
  OWNERSHIP_CHANGE: 'Ownership change',
  WRONG_LOCATION: 'Wrong location',
  REPORTED: 'Reported done, to check',
  STRAIGHT_LINE: 'Straight line',
};

/** ENUM_VALUE -> "Enum value" */
export function label(value) {
  if (value == null || value === '') return '—';
  if (LABELS[value]) return t(LABELS[value]);
  const s = String(value).toLowerCase().replace(/_/g, ' ');
  return t(s.charAt(0).toUpperCase() + s.slice(1));
}

export const etb = (v) => (v == null ? '—' : `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(v)} ${t('ETB')}`);
export const num = (v) => new Intl.NumberFormat('en-US').format(v ?? 0);
export const compactEtb = (v) => (v == null ? '—' : `${new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(v)} ${t('ETB')}`);

// Dates are shown in the Gregorian calendar (ISO). Ethiopian-calendar display is a planned later feature.
export const date = (v) => (v ? String(v).slice(0, 10) : '—');
export const dateTime = (v) => (v ? String(v).replace('T', ' ').slice(0, 16) : '—');
export const bytes = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);
/** The local date and time for a datetime-local field, `minutes` from now (e.g. 60 for an end one hour later). */
export const nowLocal = (minutes = 0) => { const d = new Date(); d.setMinutes(d.getMinutes() + minutes - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
/** Today on this device's calendar (in Jimma the UTC date is still yesterday until 03:00). */
export const today = () => nowLocal().slice(0, 10);

/** Tone used to colour a status/condition/approval badge. */
export function tone(value) {
  if (['ACTIVE', 'EXCELLENT', 'GOOD', 'COMPLETED', 'APPROVED', 'PASSED', 'FOUND', 'DONE', 'CORRECTED', 'OK', 'SENT'].includes(value)) return 'good';
  if (['FAIR', 'PLANNED', 'REGISTERED', 'INACTIVE', 'PENDING', 'OPEN', 'DUPLICATE', 'ATTENTION', 'warn'].includes(value)) return 'warn';
  if (['SUBMITTED', 'REVIEWED', 'IN_PROGRESS', 'UNDER_MAINTENANCE', 'INVESTIGATING', 'REPORTED'].includes(value)) return 'info';
  if (['POOR', 'CRITICAL', 'DAMAGED', 'LOST', 'CANCELLED', 'REJECTED', 'FAILED', 'MISSING', 'WRONG_LOCATION', 'bad'].includes(value)) return 'bad';
  if (value === 'good') return 'good';
  return 'neutral'; // DRAFT, DISPOSED, RETIRED, TRANSFERRED, LEASED, RENTED, DISMISSED ...
}
