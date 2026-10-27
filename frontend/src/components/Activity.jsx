import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { useLookups } from '../lookups.jsx';
import { can } from '../permissions.js';
import { dateTime, label, num } from '../format.js';
import { t } from '../i18n.jsx';

// The dashboard's "What happened" card. The server sends only outcomes on the assets in the person's area (no
// file downloads, exports or sign-ins: those stay in the audit log); this card says each one in plain words.

/** The steps of the registration chain, in words, with the tone of their badge. */
const STEPS = {
  CREATE: ['Registered', 'neutral'],
  SUBMIT: ['Sent for verification', 'info'],
  REVIEW: ['Verified on site', 'good'],
  APPROVE: ['Approved', 'good'],
  ACTIVATE: ['Activated: now in operation', 'good'],
  REJECT: ['Sent back to draft', 'bad'],
  UPDATE: ['Record edited', 'neutral'],
};
const TONE = {
  REQUEST_REJECT: 'bad',
  REQUEST_APPROVE: 'good',
  STATUS_CHANGE: 'warn',
  CONDITION_CHANGE: 'warn',
  INSPECTION_ADD: 'info',
  MAINTENANCE_ADD: 'info',
};

const distance = (m) => (m >= 1000 ? `${num(Math.round(m / 1000))} km` : `${num(m)} m`);

/** What the summary says, without the asset code in front and with codes such as UNDER_MAINTENANCE in words. */
function plain(summary, codes) {
  return summary
    .replace(/^(Updated )?AST-\d+:\s*/, '')
    .replace(/\b[A-Z][A-Z_]{2,}\b/g, (w) => (codes.has(w) ? label(w) : w))
    .replace(/^./, (c) => c.toUpperCase());
}

function describe(a, codes) {
  const [text, tone] = STEPS[a.action] || [null, TONE[a.action] || 'neutral'];
  let detail = null;
  let warn = false;
  if (a.action === 'REJECT') detail = a.reason ? t('Reason: {reason}', { reason: a.reason }) : null;
  if (a.action === 'UPDATE') detail = plain(a.summary, codes);
  if (a.action === 'REVIEW' && a.site_check) {
    const c = a.site_check;
    const parts = [t('Condition found: {c}', { c: label(c.found_condition) })];
    if (c.location_saved) parts.push(t('its location was recorded'));
    else if (c.far) { parts.push(t('found {d} from the recorded location: check the GPS location', { d: distance(c.distance_m) })); warn = true; }
    detail = parts.join(' · ');
  }
  return { text: text ? t(text) : plain(a.summary, codes), step: Boolean(text), tone, detail, warn };
}

const CATEGORY_MATCHERS = {
  registration: (a) => ['CREATE', 'SUBMIT', 'REVIEW', 'APPROVE', 'ACTIVATE', 'REJECT'].includes(a.action) || /registered|draft|approv|submit/i.test(a.action || a.summary),
  verification: (a) => a.action === 'REVIEW' || a.action === 'VERIFICATION_RECORD' || a.action === 'LOCATION_CORRECTION' || Boolean(a.site_check) || /verif|site|evidence|gps/i.test(a.summary || ''),
  status: (a) => ['STATUS_CHANGE', 'CONDITION_CHANGE', 'UPDATE'].includes(a.action) || /status|condition|record edited/i.test(a.summary || ''),
  maintenance: (a) => ['INSPECTION_ADD', 'MAINTENANCE_ADD', 'MAINTENANCE_UPDATE'].includes(a.action) || /inspect|maintenance/i.test(a.action || a.summary || ''),
  request: (a) => a.action?.startsWith('REQUEST') || ['TRANSFER', 'ASSIGN', 'OWNERSHIP_CHANGE', 'DISPOSAL', 'RETIREMENT'].includes(a.action) || /transfer|assign|request|dispos|retire/i.test(a.action || a.summary || ''),
  valuation: (a) => ['VALUATION_ADD', 'REVENUE_ADD'].includes(a.action) || /valuation|revenue/i.test(a.action || a.summary || ''),
};

export default function ActivityCard({ items = [], title }) {
  const { user } = useAuth();
  const lk = useLookups();
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');

  const codes = new Set([
    ...(lk.enums.statuses || []), ...(lk.enums.conditions || []), ...(lk.enums.approval_states || []),
    ...(lk.enums.request_types || []), ...(lk.enums.request_statuses || []), ...(lk.enums.maintenance_statuses || []),
  ]);

  const needle = search.trim().toLowerCase();
  const shown = items.filter((a) => {
    if (category !== 'all') {
      const matchFn = CATEGORY_MATCHERS[category];
      if (matchFn && !matchFn(a)) return false;
    }
    if (!needle) return true;
    const d = describe(a, codes);
    return (
      a.asset_code?.toLowerCase().includes(needle) ||
      a.asset_name?.toLowerCase().includes(needle) ||
      a.who?.toLowerCase().includes(needle) ||
      a.summary?.toLowerCase().includes(needle) ||
      d.text?.toLowerCase().includes(needle) ||
      (d.detail && d.detail.toLowerCase().includes(needle))
    );
  });

  return (
    <section className="card" style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>{t(title)}</h2>
        <div className="filters" style={{ margin: 0, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="field" style={{ margin: 0 }}>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              aria-label={t('Filter activity by event type')}
              style={{ minWidth: 200 }}
            >
              <option value="all">{t('All events')}</option>
              <option value="registration">{t('Registrations & approvals')}</option>
              <option value="verification">{t('Verifications & site checks')}</option>
              <option value="status">{t('Status & condition changes')}</option>
              <option value="maintenance">{t('Inspections & maintenance')}</option>
              <option value="request">{t('Requests & transfers')}</option>
              <option value="valuation">{t('Valuations & financial')}</option>
            </select>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('Search asset or person')}
              aria-label={t('Search asset or person')}
              style={{ width: 190 }}
            />
          </div>
          {(category !== 'all' || search) && (
            <button
              type="button"
              className="btn btn-small btn-cancel"
              onClick={() => { setCategory('all'); setSearch(''); }}
              title={t('Clear filters')}
            >
              {t('Clear')}
            </button>
          )}
        </div>
      </div>

      {(category !== 'all' || search) && (
        <div className="muted small" style={{ marginBottom: 10 }}>
          {t('{n} of {total} events', { n: shown.length, total: items.length })}
        </div>
      )}

      {shown.length === 0 ? (
        <p className="muted" style={{ padding: '16px 0' }}>
          {items.length === 0 ? t('Nothing has happened to these assets yet.') : t('No events match the selected filter.')}
        </p>
      ) : (
        <div className="table-wrap">
          <table className="activity">
            <thead>
              <tr>
                <th>{t('When')}</th>
                <th>{t('Asset')}</th>
                <th>{t('What happened')}</th>
                <th>{t('By')}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((a) => {
                const d = describe(a, codes);
                return (
                  <tr key={a.id}>
                    <td className="nowrap">{dateTime(a.created_at)}</td>
                    <td>
                      {a.asset_id ? <Link to={`/assets/${a.asset_id}`}>{a.asset_code}</Link> : '—'}
                      {a.asset_name && <div className="muted small">{a.asset_name}</div>}
                    </td>
                    <td>
                      {d.step ? <span className={`badge badge-${d.tone}`}>{d.text}</span> : d.text}
                      {d.detail && <div className={`small ${d.warn ? 'text-warn' : 'muted'}`} style={{ marginTop: 4 }}>{d.detail}</div>}
                    </td>
                    <td>
                      {a.who ?? '—'}
                      {a.who_role && <div className="muted small">{label(a.who_role)}</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {can.viewAudit(user) && (
        <p className="muted small" style={{ marginTop: 10 }}>
          {t('Every action, including who opened which file, is in the')}{' '}
          <Link to="/audit">{t('audit log')}</Link>.
        </p>
      )}
    </section>
  );
}
