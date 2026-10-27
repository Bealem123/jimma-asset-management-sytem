import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useLookups } from '../lookups.jsx';
import { date, dateTime, label } from '../format.js';
import { Alert, Badge, Loading, PageHeader, Tabs } from '../components/ui.jsx';
import { t } from '../i18n.jsx';
import NavIcon from '../components/NavIcon.jsx';

// The full history of one user account: sign-ins (and failed ones), password changes, and every change an
// administrator made to it. The server only returns accounts this user may see.

const PAGE = 50; // matches the server's page size

// how each kind of entry is shown: its group (for the filter), a tone and a short label
const KINDS = {
  LOGIN: { group: 'signin', tone: 'good', text: 'Signed in' },
  LOGIN_FAILED: { group: 'signin', tone: 'bad', text: 'Failed sign-in' },
  SESSIONS_ENDED: { group: 'signin', tone: 'warn', text: 'Signed out everywhere' },
  PASSWORD_CHANGE: { group: 'change', tone: 'info', text: 'Password changed' },
  PHOTO_CHANGE: { group: 'change', tone: 'neutral', text: 'Profile picture changed' },
  PHOTO_REMOVE: { group: 'change', tone: 'neutral', text: 'Profile picture removed' },
  USER_CREATE: { group: 'change', tone: 'neutral', text: 'Account created' },
  USER_UPDATE: { group: 'change', tone: 'neutral', text: 'Account changed' },
  USER_DEACTIVATE: { group: 'change', tone: 'bad', text: 'Deactivated' },
  USER_REACTIVATE: { group: 'change', tone: 'good', text: 'Reactivated' },
};
const kindOf = (action) => KINDS[action] || { group: 'change', tone: 'neutral', text: label(action) };

const FIELDS = {
  username: 'Username', full_name: 'Full name', role: 'Role', is_active: 'Active', email: 'E-mail', phone: 'Phone',
  department_id: 'Department', kifle_ketema_ids: 'Kifle Ketema', kebele_ids: 'Kebele', sector_ids: 'Sector',
};

/** Older records logged switching an account off or on as a plain change of Active: show them as what they were. */
const actionOf = (h) => {
  if (h.action !== 'USER_UPDATE') return h.action;
  const c = parse(h.changes);
  const keys = c && typeof c === 'object' ? Object.keys(c) : [];
  if (keys.length === 1 && keys[0] === 'is_active') return c.is_active ? 'USER_REACTIVATE' : 'USER_DEACTIVATE';
  return h.action;
};

const parse = (v) => { if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch { return null; } };

/** What an administrator changed, field by field, with names instead of ids; the skip list leaves fields out. */
function Changes({ changes, lk, skip = [] }) {
  const c = parse(changes);
  if (!c || typeof c !== 'object') return null;
  const names = (ids, list) => (ids || []).map((id) => t(list.find((x) => x.id === Number(id))?.name || `#${id}`)).join(', ') || '—';
  const show = (k, v) => {
    if (k === 'role') return label(v);
    if (k === 'is_active') return v ? t('Yes') : t('No');
    if (k === 'kifle_ketema_ids') return names(v, lk.kifle);
    if (k === 'kebele_ids') return names(v, lk.kebeles);
    if (k === 'sector_ids') return names(v, lk.sectors);
    return v == null || v === '' ? '—' : String(v);
  };
  const rows = Object.entries(c).filter(([k, v]) => FIELDS[k] && v !== undefined && !skip.includes(k));
  if (!rows.length) return null;
  return (
    <dl className="history-changes">
      {rows.map(([k, v]) => <div key={k}><dt>{t(FIELDS[k])}</dt><dd>{show(k, v)}</dd></div>)}
    </dl>
  );
}

/** The details cell: for changes, what changed (and why, when an account is switched off or on); otherwise the summary. */
function Details({ h, lk }) {
  const action = actionOf(h);
  if (action === 'USER_DEACTIVATE' || action === 'USER_REACTIVATE') {
    const reason = parse(h.changes)?.reason;
    return (
      <>
        <div>{reason ? <><span className="muted">{t('Reason')}:</span> {reason}</> : <span className="muted">{t('No reason given')}</span>}</div>
        <Changes changes={h.changes} lk={lk} skip={['is_active']} />
      </>
    );
  }
  if (action === 'USER_UPDATE') {
    const reset = /password reset/.test(h.summary);
    const hasFields = Object.keys(parse(h.changes) || {}).some((key) => FIELDS[key]);
    return (
      <>
        <Changes changes={h.changes} lk={lk} />
        {reset && <div className="muted small">{t('Password reset by the administrator')}</div>}
        {!hasFields && !reset && <div>{h.summary}</div>}
      </>
    );
  }
  return h.summary;
}

export default function UserHistory() {
  const { id } = useParams();
  const { user: me } = useAuth();
  const lk = useLookups();
  const [user, setUser] = useState(null);
  const [rows, setRows] = useState([]);
  const [more, setMore] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    let live = true;
    setUser(null); setRows([]); setError('');
    Promise.all([api.get(`/users/${id}`), api.get(`/users/${id}/history`)])
      .then(([u, h]) => { if (live) { setUser(u); setRows(h); setMore(h.length === PAGE); } })
      .catch((e) => live && setError(e.message));
    return () => { live = false; };
  }, [id]);

  async function older() {
    setBusy(true);
    try {
      const h = await api.get(`/users/${id}/history?before=${rows[rows.length - 1].id}`);
      setRows((r) => [...r, ...h]);
      setMore(h.length === PAGE);
    } catch (e) { setError(e.message); }
    setBusy(false);
  }

  if (error) return <><BackLink me={me} /><Alert>{error}</Alert></>;
  if (!user) return <Loading />;

  const shown = rows.filter((r) => filter === 'all' || kindOf(actionOf(r)).group === filter);
  const area = [
    ...user.kifle_ketema_ids.map((x) => lk.kifle.find((k) => k.id === x)?.name),
    ...user.kebele_ids.map((x) => lk.kebeles.find((k) => k.id === x)?.name),
    ...user.sector_ids.map((x) => lk.sectors.find((k) => k.id === x)?.name),
  ].filter(Boolean).map((n) => t(n)).join(' · ');

  return (
    <>
      <BackLink me={me} />
      <PageHeader title={user.full_name} subtitle={`${user.username} · ${label(user.role)}`}>
        {!user.read_only && (
          <div className="actions">
            <Link to={`/users/${user.id}/edit`} className="btn btn-small">
              <span className="btn-icon-nav"><NavIcon name="edit" /> {t('Edit user')}</span>
            </Link>
            <Link to="/users" className="btn btn-small">
              {t(me?.role === 'KEBELE_ADMIN' ? 'Back to Sector Administrators' : 'Back to users')}
            </Link>
          </div>
        )}
      </PageHeader>

      <section className="card">
        <h2>{t('Account')}</h2>
        <dl className="facts">
          <div><dt>{t('Status')}</dt><dd>{user.is_active ? <Badge value="ACTIVE" text="Active" /> : <Badge value="DRAFT" text="Inactive" />}</dd></div>
          <div><dt>{t('Assigned area')}</dt><dd>{area || (['SUPER_ADMIN', 'EXECUTIVE', 'AUDITOR'].includes(user.role) ? t('Whole city') : '—')}</dd></div>
          <div><dt>{t('E-mail')}</dt><dd>{user.email || '—'}</dd></div>
          <div><dt>{t('Phone')}</dt><dd>{user.phone || '—'}</dd></div>
          <div><dt>{t('Last sign-in')}</dt><dd>{dateTime(user.last_login_at)}</dd></div>
          <div><dt>{t('Created')}</dt><dd>{dateTime(user.created_at)}</dd></div>
          <div><dt>{t('Password')}</dt><dd>{user.must_change_password ? <span className="badge badge-warn">{t('Has not chosen a password yet')}</span> : t('Chosen by the user')}</dd></div>
        </dl>
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <div className="actions" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>{t('History')}</h2>
          <Tabs tabs={[['all', 'All'], ['signin', 'Sign-ins'], ['change', 'Account changes']]} value={filter} onChange={setFilter} label="Filter the history" />
        </div>
        {shown.length === 0 ? <p className="muted">{t('Nothing recorded.')}</p> : (
          <div className="table-wrap">
            <table className="history-table">
              <thead><tr><th>{t('When')}</th><th>{t('Event')}</th><th>{t('Details')}</th><th>{t('By')}</th></tr></thead>
              <tbody>
                {shown.map((h) => {
                  const k = kindOf(actionOf(h));
                  return (
                    <tr key={h.id}>
                      <td className="history-when">{date(h.created_at)}<div className="muted small">{dateTime(h.created_at).slice(11)}</div></td>
                      <td><span className={`badge badge-${k.tone}`}>{t(k.text)}</span></td>
                      <td><Details h={h} lk={lk} /></td>
                      <td>{h.username || t('system')}{h.username && h.username === user.username && <div className="muted small">{t('the user')}</div>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {more && <button type="button" className="btn" disabled={busy} onClick={older}>{busy ? t('Loading…') : t('Show older entries')}</button>}
      </section>
    </>
  );
}

function BackLink({ me }) {
  return (
    <p style={{ margin: '0 0 12px' }}>
      <Link to="/users" className="btn-icon-nav">
        <NavIcon name="chevronLeft" /> {t(me?.role === 'KEBELE_ADMIN' ? 'Back to Sector Administrators' : 'Back to users')}
      </Link>
    </p>
  );
}
