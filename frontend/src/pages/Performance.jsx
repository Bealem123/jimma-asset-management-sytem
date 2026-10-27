import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { compactEtb, date, num } from '../format.js';
import {
  Alert, FilterBar, FilterSearch, FilterSelect, Loading, PageHeader, useAsync, useFilters,
} from '../components/ui.jsx';
import { t } from '../i18n.jsx';

// How each Kifle Ketema and Kebele is doing: what is registered and active, what waits at which level and for how
// long, and what is at risk, with the administrator who answers for it. The server limits the rows to the user's area.

export const WAIT_WARN = 7;
export const WAIT_BAD = 14;

const Count = ({ n, tone }) => (n > 0 && tone ? <span className={`badge badge-${tone}`}>{num(n)}</span> : num(n));

function Admin({ admins }) {
  if (!admins.length) return <span className="badge badge-bad">{t('No administrator')}</span>;
  return (
    <>
      {/* one administrator per area: a second active account is a mistake to correct on the Users page */}
      {admins.length > 1 && <span className="badge badge-warn">{t('{n} administrators: only one allowed', { n: num(admins.length) })}</span>}
      {admins.map((a) => (
        <div key={a.username}>
          {a.full_name} {admins.length > 1 && <span className="muted small">({a.username})</span>}
          <div className="muted small">{a.last_login_at ? t('Last sign-in {d}', { d: date(a.last_login_at) }) : t('Never signed in')}</div>
        </div>
      ))}
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
                <td><Admin admins={r.admins || (r.admin ? [r.admin] : [])} /></td>
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

// "Show" filter: the areas that need someone's attention, and why
const ATTENTION = {
  waiting: (r) => r.oldest_wait_days != null && r.oldest_wait_days >= WAIT_WARN,
  pending: (r) => r.with_kebele + r.with_kifle + r.pending_requests > 0,
  poor: (r) => r.poor > 0,
  lost: (r) => r.lost > 0,
  idle: (r) => r.idle > 0,
  discrepancies: (r) => r.open_discrepancies > 0,
  admin: (r) => (r.admins || (r.admin ? [r.admin] : [])).length !== 1,
  empty: (r) => r.assets === 0,
};
const showOptions = () => [ // built at render, so the labels follow the chosen language
  { value: '', label: 'All areas' },
  { value: 'waiting', label: t('Waiting over {n} days', { n: WAIT_WARN }) },
  { value: 'pending', label: 'Something waiting for a decision' },
  { value: 'poor', label: 'Assets in poor or critical condition' },
  { value: 'lost', label: 'Assets missing' },
  { value: 'idle', label: 'Idle assets' },
  { value: 'discrepancies', label: 'Open discrepancies' },
  { value: 'admin', label: 'No administrator, or more than one' },
  { value: 'empty', label: 'Nothing registered yet' },
];

function areaFilter(f) {
  const needle = f.q.trim().toLowerCase();
  return (r) => (!f.show || ATTENTION[f.show](r))
    && (!needle || [r.name, t(r.name), r.kifle_ketema_name, ...(r.admins || []).map((a) => a.full_name)]
      .some((s) => s && String(s).toLowerCase().includes(needle)));
}

export const WaitNote = () => (
  <p className="muted small">
    {t('Waiting times count from the day a registration reached its current step, or from the day a request was made. Over {a} days is marked amber, over {b} days red.', { a: WAIT_WARN, b: WAIT_BAD })}
  </p>
);

export default function Performance() {
  const { data, error, loading } = useAsync(() => api.get('/dashboard/performance'), []);
  const [f, setF, clear, any] = useFilters(['q', 'kifle', 'show']);
  if (loading) return <Loading />;
  if (error) return <Alert>{error}</Alert>;
  const keep = areaFilter(f);
  const kifles = data.kifle_ketemas.filter((k) => (!f.kifle || String(k.id) === f.kifle) && keep(k));
  const kebeles = data.kebeles.filter((b) => (!f.kifle || String(b.kifle_ketema_id) === f.kifle) && keep(b));
  const filters = (
    <FilterBar any={any} onClear={clear}>
      <FilterSearch id="pf-q" value={f.q} onChange={(v) => setF('q', v)} placeholder="Area or administrator" />
      {data.kifle_ketemas.length > 1 && (
        <FilterSelect id="pf-kif" text="Kifle Ketema" value={f.kifle} onChange={(v) => setF('kifle', v)}
          options={[{ value: '', label: 'All Kifle Ketemas' }, ...data.kifle_ketemas.map((k) => ({ value: String(k.id), label: k.name }))]} />
      )}
      <FilterSelect id="pf-show" text="Show" value={f.show} onChange={(v) => setF('show', v)} options={showOptions()} />
    </FilterBar>
  );
  const none = <p className="muted">{t('Nothing matches these filters.')}</p>;
  // the Mayor holds the Kifle Ketema Administrators to account: the figures stop at Kifle Ketema level
  if (!data.kebele_level) {
    return (
      <>
        <PageHeader title="Performance by area" subtitle="Each Kifle Ketema: what is registered, what is waiting and for how long, and what is at risk. The Kifle Ketema Administrator who answers for it is named; each one follows its own Kebeles." />
        {filters}
        <section className="card">
          <h2>{t('Kifle Ketemas')}</h2>
          {any && !kifles.length ? none : <AreaTable rows={kifles} kind="kifle" money={data.can_see_money} />}
        </section>
        <WaitNote />
      </>
    );
  }
  return (
    <>
      <PageHeader title="Performance by area" subtitle="Each Kifle Ketema and Kebele: what is registered, what is waiting and for how long, and what is at risk. The administrator who answers for each area is named." />
      {filters}
      {data.kifle_ketemas.length > 1 && (
        <section className="card">
          <h2>{t('Kifle Ketemas')}</h2>
          {any && !kifles.length ? none : <AreaTable rows={kifles} kind="kifle" money={data.can_see_money} />}
        </section>
      )}
      <section className="card" style={{ marginTop: 16 }}>
        <h2>{t('Kebeles')}</h2>
        {any && !kebeles.length ? none : <AreaTable rows={kebeles} kind="kebele" money={data.can_see_money} />}
      </section>
      <WaitNote />
    </>
  );
}
