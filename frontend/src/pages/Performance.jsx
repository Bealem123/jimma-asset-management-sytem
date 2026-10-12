import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { compactEtb, date, num } from '../format.js';
import { Alert, Loading, PageHeader, useAsync } from '../components/ui.jsx';
import { t } from '../i18n.jsx';

// How each Kifle Ketema and Kebele is doing: what is registered and active, what waits at which level and for how
// long, and what is at risk, with the administrator who answers for it. The server limits the rows to the user's area.

const WAIT_WARN = 7;
const WAIT_BAD = 14;

const Count = ({ n, tone }) => (n > 0 && tone ? <span className={`badge badge-${tone}`}>{num(n)}</span> : num(n));

function Admin({ admin }) {
  if (!admin) return <span className="badge badge-bad">{t('No administrator')}</span>;
  return (
    <>
      {admin.full_name}
      <div className="muted small">{admin.last_login_at ? t('Last sign-in {d}', { d: date(admin.last_login_at) }) : t('Never signed in')}</div>
    </>
  );
}

/** One row per area. `kind` is 'kifle' (Kifle Ketemas) or 'kebele' (Kebeles). */
export function AreaTable({ rows, kind, money }) {
  if (!rows.length) return <p className="muted">{t(kind === 'kifle' ? 'No Kifle Ketema in your area.' : 'No Kebele is linked to a Kifle Ketema yet.')}</p>;
  const filter = kind === 'kifle' ? 'kifle_ketema_id' : 'kebele_id';
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>{t(kind === 'kifle' ? 'Kifle Ketema' : 'Kebele')}</th>
            <th>{t('Administrator')}</th>
            <th className="num">{t('Assets')}</th>
            <th className="num">{t('Active')}</th>
            <th className="num" title={t('Registered, waiting for the Kebele Administrator to verify')}>{t('With Kebele')}</th>
            <th className="num" title={t('Verified, waiting for the Kifle Ketema Administrator to approve')}>{t('With Kifle Ketema')}</th>
            <th className="num" title={t('Transfer, disposal and other requests waiting for a decision')}>{t('Requests')}</th>
            <th className="num" title={t('How long the oldest waiting item has waited')}>{t('Oldest wait')}</th>
            <th className="num">{t('Poor or critical')}</th>
            <th className="num">{t('Missing')}</th>
            <th className="num" title={t('Active but not in use')}>{t('Idle')}</th>
            <th className="num">{t('Discrepancies')}</th>
            {money && <th className="num">{t('Value')}</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const wait = r.oldest_wait_days;
            return (
              <tr key={r.id}>
                <td>
                  <Link to={`/assets?${filter}=${r.id}`}><strong>{t(r.name)}</strong></Link>
                  {kind === 'kifle' && (
                    <div className="muted small">
                      {t('{n} Kebeles', { n: num(r.kebeles) })}
                      {r.kebeles_without_admin > 0 && <> · <span className="badge badge-warn">{t('{n} without administrator', { n: num(r.kebeles_without_admin) })}</span></>}
                    </div>
                  )}
                  {kind === 'kebele' && <div className="muted small">{t(r.kifle_ketema_name)}</div>}
                </td>
                <td><Admin admin={r.admin} /></td>
                <td className="num">{num(r.assets)}</td>
                <td className="num">{num(r.active)}{r.assets > 0 && <div className="muted small">{Math.round((r.active / r.assets) * 100)}%</div>}</td>
                <td className="num"><Count n={r.with_kebele} tone="neutral" /></td>
                <td className="num"><Count n={r.with_kifle} tone="neutral" /></td>
                <td className="num"><Count n={r.pending_requests} tone="neutral" /></td>
                <td className="num">
                  {wait == null ? '—' : <span className={`badge badge-${wait >= WAIT_BAD ? 'bad' : wait >= WAIT_WARN ? 'warn' : 'good'}`}>{t('{n} days', { n: num(wait) })}</span>}
                </td>
                <td className="num"><Count n={r.poor} tone="warn" /></td>
                <td className="num"><Count n={r.lost} tone="bad" /></td>
                <td className="num"><Count n={r.idle} tone="warn" /></td>
                <td className="num"><Count n={r.open_discrepancies} tone="bad" /></td>
                {money && <td className="num">{compactEtb(r.value)}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export const WaitNote = () => (
  <p className="muted small">
    {t('Waiting times count from the last change to a registration, or from the day a request was made. Over {a} days is marked amber, over {b} days red.', { a: WAIT_WARN, b: WAIT_BAD })}
  </p>
);

export default function Performance() {
  const { data, error, loading } = useAsync(() => api.get('/dashboard/performance'), []);
  const [kifle, setKifle] = useState('');
  if (loading) return <Loading />;
  if (error) return <Alert>{error}</Alert>;
  const kebeles = kifle ? data.kebeles.filter((b) => String(b.kifle_ketema_id) === kifle) : data.kebeles;
  // the Mayor holds the Kifle Ketema Administrators to account: the figures stop at Kifle Ketema level
  if (!data.kebele_level) {
    return (
      <>
        <PageHeader title="Performance by area" subtitle="Each Kifle Ketema: what is registered, what is waiting and for how long, and what is at risk. The Kifle Ketema Administrator who answers for it is named; each one follows its own Kebeles." />
        <section className="card">
          <h2>{t('Kifle Ketemas')}</h2>
          <AreaTable rows={data.kifle_ketemas} kind="kifle" money={data.can_see_money} />
        </section>
        <WaitNote />
      </>
    );
  }
  return (
    <>
      <PageHeader title="Performance by area" subtitle="Each Kifle Ketema and Kebele: what is registered, what is waiting and for how long, and what is at risk. The administrator who answers for each area is named." />
      {data.kifle_ketemas.length > 1 && (
        <section className="card">
          <h2>{t('Kifle Ketemas')}</h2>
          <AreaTable rows={data.kifle_ketemas} kind="kifle" money={data.can_see_money} />
        </section>
      )}
      <section className="card" style={{ marginTop: 16 }}>
        <div className="actions" style={{ justifyContent: 'space-between' }}>
          <h2>{t('Kebeles')}</h2>
          {data.kifle_ketemas.length > 1 && (
            <select value={kifle} onChange={(e) => setKifle(e.target.value)} aria-label={t('Kifle Ketema')}>
              <option value="">{t('All Kifle Ketemas')}</option>
              {data.kifle_ketemas.map((k) => <option key={k.id} value={String(k.id)}>{t(k.name)}</option>)}
            </select>
          )}
        </div>
        <AreaTable rows={kebeles} kind="kebele" money={data.can_see_money} />
      </section>
      <WaitNote />
    </>
  );
}
