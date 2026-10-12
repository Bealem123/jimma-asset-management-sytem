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
const TONE = { REQUEST_REJECT: 'bad', REQUEST_APPROVE: 'good', STATUS_CHANGE: 'warn', CONDITION_CHANGE: 'warn', INSPECTION_ADD: 'info', MAINTENANCE_ADD: 'info' };

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

export default function ActivityCard({ items, title }) {
  const { user } = useAuth();
  const lk = useLookups();
  const codes = new Set([
    ...(lk.enums.statuses || []), ...(lk.enums.conditions || []), ...(lk.enums.approval_states || []),
    ...(lk.enums.request_types || []), ...(lk.enums.request_statuses || []), ...(lk.enums.maintenance_statuses || []),
  ]);
  return (
    <section className="card" style={{ marginTop: 16 }}>
      <h2>{t(title)}</h2>
      {items.length === 0 ? <p className="muted">{t('Nothing has happened to these assets yet.')}</p> : (
        <div className="table-wrap">
          <table className="activity">
            <thead><tr><th>{t('When')}</th><th>{t('Asset')}</th><th>{t('What happened')}</th><th>{t('By')}</th></tr></thead>
            <tbody>
              {items.map((a) => {
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
      {can.viewAudit(user) && <p className="muted small" style={{ marginTop: 10 }}>{t('Every action, including who opened which file, is in the')}{' '}<Link to="/audit">{t('audit log')}</Link>.</p>}
    </section>
  );
}
