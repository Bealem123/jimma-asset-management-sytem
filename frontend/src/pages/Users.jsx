import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useLookups } from '../lookups.jsx';
import { can } from '../permissions.js';
import { dateTime, label } from '../format.js';
import {
  Alert, Badge, ConfirmDialog, Loading, PageHeader, Table, useAsync,
} from '../components/ui.jsx';
import { t } from '../i18n.jsx';
import { Avatar } from '../components/Avatar.jsx';
import NavIcon from '../components/NavIcon.jsx';

const CITYWIDE = ['SUPER_ADMIN', 'EXECUTIVE', 'AUDITOR'];

/**
 * A person is registered by their own name and their father's name, and if wanted their grandfather's (as the
 * server requires). Their first name becomes their username; the server adds the father's name when it is taken.
 */
export const nameFields = (page) => [
  { page, name: 'first_name', label: 'Name', required: true, kind: 'person', maxLength: 80, help: 'The person’s own name, as on their ID card. It is also what they type to sign in.' },
  { page, name: 'father_name', label: 'Father’s name', required: true, kind: 'person', maxLength: 80 },
  { page, name: 'grandfather_name', label: 'Grandfather’s name (optional)', kind: 'person', maxLength: 80 },
];
/** The username the server will try first for this name (as lib: lowercase, apostrophes dropped, other marks as dashes). */
export const usernameFor = (first) => String(first || '').trim().toLowerCase().replace(/['’`]/g, '').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');

// The roles the City uses, and what each one does: the hierarchy top to bottom, then the specialist roles beside it.
export const ROLE_HELP = [
  ['SUPER_ADMIN', 'Runs the system: the Kifle Ketema Administrator, Mayor and specialist accounts, master data, permissions and settings. Changes no assets.'],
  ['EXECUTIVE', 'The Mayor and executives: see the whole city, its reports and the performance of each area. Change nothing.'],
  ['KIFLE_ADMIN', 'Approves registrations, transfers and disposals in one Kifle Ketema, and creates its Kebele Administrators.'],
  ['KEBELE_ADMIN', 'Verifies newly registered assets in one Kebele and runs physical verification; creates its Sector Administrators.'],
  ['SECTOR_ADMIN', 'Registers the assets of one sector inside one Kebele and keeps their records up to date.'],
  ['AUDITOR', 'Checks the records independently: sees the whole city, its financial figures and the audit log. Changes nothing.'],
  ['FINANCIAL_OFFICER', 'Records valuations and income for one Kifle Ketema. Each Kifle Ketema has one.'],
  ['INSPECTOR', 'Inspects the technical condition of assets and records verification results in one Kifle Ketema. Each Kifle Ketema has one.'],
];
// The specialist roles: created by the Super Administrator beside the hierarchy (one Financial Officer and one Inspector per Kifle Ketema).
const SPECIALISTS = ['AUDITOR', 'FINANCIAL_OFFICER', 'INSPECTOR'];
const BY_KIFLE_KETEMA = ['FINANCIAL_OFFICER', 'INSPECTOR'];
const ADD_SPECIALIST = { AUDITOR: 'Add Internal Auditor', FINANCIAL_OFFICER: 'Add Financial Officer', INSPECTOR: 'Add Inspector' };
const ONE_FOR_THE_CITY = ['AUDITOR']; // like the Mayor: one active account (the server refuses a second)
const ONE_PER_KIFLE_KETEMA = ['FINANCIAL_OFFICER', 'INSPECTOR']; // one active account in each Kifle Ketema (the server refuses a second)

// Reasons offered when an account is switched off (the person can also type their own).
const DEACTIVATE_REASONS = ['On leave', 'Transferred to another office', 'Left the office', 'Password may be known to others', 'Replaced by a new administrator'];

const SUBTITLE = {
  KIFLE_ADMIN: 'You create and manage the three Kifle Ketema Administrators, the Mayor / Executive, the Internal Auditor, the Financial Officers and the Inspectors. Each of them manages the accounts of the level beneath it.',
  KEBELE_ADMIN: 'You create and manage the Kebele Administrators of your Kifle Ketema. Each of them manages the Sector Administrators of its Kebele.',
  SECTOR_ADMIN: 'You can create and manage the Sector Administrators of your Kebele, one for each sector.',
};

/** An "add a person" button: a person with a plus. What it adds is its tooltip and its name for screen readers; `withText` also shows it. */
const AddUserButton = ({ text, onClick, withText }) => (
  <button type="button" className={`btn btn-primary ${withText ? 'btn-small btn-icon-nav btn-add' : 'btn-icon-only btn-add-user'}`} title={t(text)} aria-label={t(text)} onClick={onClick}>
    <NavIcon name="userPlus" />{withText && <span>{t(withText)}</span>}
  </button>
);

export default function Users() {
  const lk = useLookups();
  const { user: me } = useAuth();
  const target = can.managedAccountRole(me); // each level manages only the level below it
  // the roles this person sees: those it creates (the Internal Auditor, who checks every account, sees them all)
  const myRoles = me.role === 'AUDITOR' ? ROLE_HELP.map(([r]) => r) : can.managedAccountRoles(me);
  const { data, error, loading, reload } = useAsync(() => api.get('/users'), []);
  const navigate = useNavigate();
  const location = useLocation();
  const [ask, setAsk] = useState(null); // { kind: 'deactivate' | 'activate' | 'signout', user }
  const [flash, setFlash] = useState(() => location.state?.flash || '');
  // the message from the page that created an account is shown once, not again after a reload
  useEffect(() => { if (location.state?.flash) navigate(location.pathname, { replace: true, state: null }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // a new account: the role and, for a Kifle Ketema Administrator, its Kifle Ketema can already be chosen
  const addUser = (preset = {}) => navigate(`/users/new?${new URLSearchParams(preset)}`);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');

  if (loading && !data) return <Loading />;
  if (error) return <Alert>{error}</Alert>;

  const needle = search.trim().toLowerCase();
  const shown = data.filter((u) => (!roleFilter || u.role === roleFilter)
    && (!needle || u.username.toLowerCase().includes(needle) || u.full_name.toLowerCase().includes(needle)));

  async function endSessions(u) {
    await api.post(`/users/${u.id}/end-sessions`);
    setAsk(null);
    setFlash(`${u.username} has been signed out everywhere.`);
  }
  async function setActive(u, active, reason) {
    await api.patch(`/users/${u.id}`, { is_active: active, reason });
    setAsk(null);
    setFlash(active ? `${u.username} is active again.` : `${u.username} is deactivated and signed out.`);
    reload();
  }

  // an add button only while there is room: the City's one Internal Auditor, or a Kifle Ketema still without its officer
  const activeIn = (role) => data.filter((u) => u.role === role && u.is_active);
  const canStillAdd = (role) => (ONE_FOR_THE_CITY.includes(role) ? !activeIn(role).length
    : ONE_PER_KIFLE_KETEMA.includes(role) ? lk.kifle.some((k) => !activeIn(role).some((u) => u.kifle_ketema_ids.includes(k.id)))
      : true);

  const scopeSummary = (u) => {
    if (CITYWIDE.includes(u.role)) return t('Whole city');
    // Names when there are only a few (the usual case: one sector in one Kebele), counts otherwise.
    const named = (ids, list, one) => {
      if (!ids.length) return null;
      if (ids.length > 2) return `${ids.length} ${t(one)}`;
      return ids.map((id) => t(list.find((x) => x.id === id)?.name || '?')).join(', ');
    };
    const parts = [named(u.sector_ids, lk.sectors, 'sector'), named(u.kebele_ids, lk.kebeles, 'Kebele'), named(u.kifle_ketema_ids, lk.kifle, 'Kifle Ketema')].filter(Boolean);
    return parts.join(' · ') || <span className="badge badge-warn">{t('None assigned: sees nothing')}</span>;
  };

  /** The Super Administrator's own accounts outside the hierarchy: the Mayor / Executive and the specialists. */
  const outsideAccounts = (list, withRole) => (
    <Table head={withRole ? ['Name', 'Role', 'Assigned area', 'Contact', 'Last sign-in', 'Status', ''] : ['Name', 'Contact', 'Last sign-in', 'Status', '']}>
      {list.map((u) => (
        <tr key={u.id}>
          <td><span className="user-cell"><Avatar user={u} size={34} /><span>{u.full_name}<div className="muted small">{u.username}</div></span></span></td>
          {withRole && <><td>{label(u.role)}</td><td>{scopeSummary(u)}</td></>}
          <td className="small">{u.email || '—'}{u.phone && <div className="muted">{u.phone}</div>}</td>
          <td>{dateTime(u.last_login_at)}</td>
          <td>
            {u.is_active ? <Badge value="ACTIVE" text="Active" /> : <Badge value="DRAFT" text="Inactive" />}
            {u.must_change_password ? <div className="muted small">{t('Has not chosen a password yet')}</div> : null}
          </td>
          <td>
            <div className="actions">
              <Link to={`/users/${u.id}/edit`} className="btn btn-small btn-icon-only" title={t('Edit user')} aria-label={t('Edit user')}>
                <NavIcon name="edit" />
              </Link>
              {u.is_active ? (
                <button
                  type="button"
                  className="btn btn-small btn-cancel btn-icon-only"
                  title={t('Deactivate user')}
                  aria-label={t('Deactivate user')}
                  onClick={() => setAsk({ kind: 'deactivate', user: u })}
                >
                  <NavIcon name="deactivate" />
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-small btn-icon-only"
                  title={t('Activate user')}
                  aria-label={t('Activate user')}
                  onClick={() => setAsk({ kind: 'activate', user: u })}
                >
                  <NavIcon name="activate" />
                </button>
              )}
              <Link
                className="btn btn-small btn-icon-only"
                to={`/users/${u.id}/history`}
                title={t('Account history')}
                aria-label={t('Account history')}
              >
                <NavIcon name="history" />
              </Link>
            </div>
          </td>
        </tr>
      ))}
    </Table>
  );

  return (
    <>
      <PageHeader
        title={target === 'SECTOR_ADMIN' ? t('Sector Administrators') : target === 'KEBELE_ADMIN' ? t('Kebele Administrators') : t('Users')}
        subtitle={target ? SUBTITLE[target] : 'Every account in the City, with its role, area and history. You can see them but not change them.'}
      >
        {target && (
          <AddUserButton text={target === 'SECTOR_ADMIN' ? 'Add Sector Administrator' : target === 'KEBELE_ADMIN' ? 'Add Kebele Administrator' : 'Add user'} onClick={() => addUser()} />
        )}
      </PageHeader>
      <Alert kind="success">{flash}</Alert>
      {me.role === 'SUPER_ADMIN' && (
        <div className="card">
          <h2>{t('Kifle Ketema Administrators')}</h2>
          <p className="muted small">{t('One administrator for each Kifle Ketema. Edit to change the name, contact or password; deactivate to replace the person.')}</p>
          <Table head={['Kifle Ketema', 'Administrator', 'Contact', 'Status', '']}>
            {lk.kifle.map((k) => {
              const admins = data.filter((u) => u.role === 'KIFLE_ADMIN' && u.kifle_ketema_ids.includes(k.id));
              const u = admins.find((a) => a.is_active) || admins[0];
              return (
                <tr key={k.id}>
                  <td><strong>{t(k.name)}</strong></td>
                  <td>{u ? <span className="user-cell"><Avatar user={u} size={34} /><span>{u.full_name}<div className="muted small">{u.username}</div></span></span> : <span className="muted">{t('No administrator yet')}</span>}</td>
                  <td className="small">{u ? <>{u.email || '—'}{u.phone && <div className="muted">{u.phone}</div>}</> : '—'}</td>
                  <td>
                    {!u ? <Badge value="DRAFT" text="None" /> : u.is_active ? <Badge value="ACTIVE" text="Active" /> : <Badge value="DRAFT" text="Inactive" />}
                    {u?.must_change_password ? <div className="muted small">{t('Has not chosen a password yet')}</div> : null}
                  </td>
                  <td>
                    <div className="actions">
                      {u && (
                        <Link to={`/users/${u.id}/edit`} className="btn btn-small btn-icon-only" title={t('Edit user')} aria-label={t('Edit user')}>
                          <NavIcon name="edit" />
                        </Link>
                      )}
                      {u?.is_active && (
                        <button
                          type="button"
                          className="btn btn-small btn-cancel btn-icon-only"
                          title={t('Deactivate user')}
                          aria-label={t('Deactivate user')}
                          onClick={() => setAsk({ kind: 'deactivate', user: u })}
                        >
                          <NavIcon name="deactivate" />
                        </button>
                      )}
                      {u && !u.is_active && (
                        <button
                          type="button"
                          className="btn btn-small btn-icon-only"
                          title={t('Activate user')}
                          aria-label={t('Activate user')}
                          onClick={() => setAsk({ kind: 'activate', user: u })}
                        >
                          <NavIcon name="activate" />
                        </button>
                      )}
                      {u && (
                        <Link
                          className="btn btn-small btn-icon-only"
                          to={`/users/${u.id}/history`}
                          title={t('Account history')}
                          aria-label={t('Account history')}
                        >
                          <NavIcon name="history" />
                        </Link>
                      )}
                      {(!u || !u.is_active) && !admins.some((a) => a.is_active) && (
                        <AddUserButton text="Create administrator" onClick={() => addUser({ role: 'KIFLE_ADMIN', kifle: k.id })} />
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </Table>
        </div>
      )}
      {me.role === 'SUPER_ADMIN' && (
        <div className="card">
          <div className="actions" style={{ justifyContent: 'space-between' }}>
            <h2>{t('Mayor / Executive')}</h2>
            {!data.some((u) => u.role === 'EXECUTIVE' && u.is_active) && (
              <AddUserButton text="Add Mayor / Executive" onClick={() => addUser({ role: 'EXECUTIVE' })} />
            )}
          </div>
          <p className="muted small">{t('Read-only and city-wide: dashboards, reports, analytics and financial figures. They cannot change assets, accounts or settings.')}</p>
          <p className="muted small">{t('The City has one Mayor / Executive account. To replace the person, deactivate the account, then add the new one.')}</p>
          {data.some((u) => u.role === 'EXECUTIVE')
            ? outsideAccounts(data.filter((u) => u.role === 'EXECUTIVE'), false)
            : <p className="muted">{t('No Mayor or executive account yet.')}</p>}
        </div>
      )}
      {me.role === 'SUPER_ADMIN' && (
        <div className="card">
          <div className="actions" style={{ justifyContent: 'space-between' }}>
            <h2>{t('Auditors, financial officers and inspectors')}</h2>
            <div className="actions">
              {SPECIALISTS.filter(canStillAdd).map((r) => (
                <AddUserButton key={r} text={ADD_SPECIALIST[r]} withText={label(r)} onClick={() => addUser({ role: r })} />
              ))}
            </div>
          </div>
          <p className="muted small">{t('Beside the hierarchy. The Internal Auditor is read-only and sees the whole city, its financial figures and the audit log. Financial Officers and Inspectors work in the Kifle Ketemas you assign them.')}</p>
          <p className="muted small">{t('The City has one Internal Auditor: to replace the person, deactivate the account, then add the new one. Every Kifle Ketema needs at least one Inspector, usually also one Financial Officer.')}</p>
          {data.some((u) => SPECIALISTS.includes(u.role))
            ? outsideAccounts(data.filter((u) => SPECIALISTS.includes(u.role)), true)
            : <p className="muted">{t('No auditor, financial officer or inspector account yet.')}</p>}
        </div>
      )}
      {me.role === 'SUPER_ADMIN' && <h2>{t('All the accounts you manage')}</h2>}
      <div className="filters">
        <div className="field grow">
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('Search by username or name')} aria-label={t('Search by username or name')} />
        </div>
        {myRoles.length > 1 && (
          <div className="field">
            <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} aria-label={t('Role')}>
              <option value="">{t('All roles')}</option>
              {myRoles.map((r) => <option key={r} value={r}>{label(r)}</option>)}
            </select>
          </div>
        )}
        <span className="muted small">{t('{n} of {total} accounts', { n: shown.length, total: data.length })}</span>
      </div>
      <Table head={['Username', 'Name', 'Role', 'Assigned area', 'Contact', 'Last sign-in', 'Status', '']}>
        {shown.map((u) => (
          <tr key={u.id}>
            <td>{u.username}</td><td><span className="user-cell"><Avatar user={u} size={34} />{u.full_name}</span></td><td>{label(u.role)}</td><td>{scopeSummary(u)}</td>
            <td className="small">{u.email || '—'}{u.phone && <div className="muted">{u.phone}</div>}</td>
            <td>{dateTime(u.last_login_at)}</td>
            <td>
              {u.is_active ? <Badge value="ACTIVE" text="Active" /> : <Badge value="DRAFT" text="Inactive" />}
              {u.must_change_password ? <div className="muted small">{t('Has not chosen a password yet')}</div> : null}
            </td>
            <td>
              {u.read_only ? (
                <div className="actions">
                  <span className="muted small">{t('View only')}</span>
                  <Link
                    className="btn btn-small btn-icon-only"
                    to={`/users/${u.id}/history`}
                    title={t('Account history')}
                    aria-label={t('Account history')}
                  >
                    <NavIcon name="history" />
                  </Link>
                </div>
              ) : (
                <div className="actions">
                  <Link to={`/users/${u.id}/edit`} className="btn btn-small btn-icon-only" title={t('Edit user')} aria-label={t('Edit user')}>
                    <NavIcon name="edit" />
                  </Link>
                  {u.is_active ? (
                    <button
                      type="button"
                      className="btn btn-small btn-cancel btn-icon-only"
                      title={t('Deactivate user')}
                      aria-label={t('Deactivate user')}
                      onClick={() => setAsk({ kind: 'deactivate', user: u })}
                    >
                      <NavIcon name="deactivate" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-small btn-icon-only"
                      title={t('Activate user')}
                      aria-label={t('Activate user')}
                      onClick={() => setAsk({ kind: 'activate', user: u })}
                    >
                      <NavIcon name="activate" />
                    </button>
                  )}
                  <Link
                    className="btn btn-small btn-icon-only"
                    to={`/users/${u.id}/history`}
                    title={t('Account history')}
                    aria-label={t('Account history')}
                  >
                    <NavIcon name="history" />
                  </Link>
                  <button
                    type="button"
                    className="btn btn-small btn-icon-only"
                    title={t('Sign out everywhere')}
                    aria-label={t('Sign out everywhere')}
                    onClick={() => setAsk({ kind: 'signout', user: u })}
                  >
                    <NavIcon name="logout" />
                  </button>
                </div>
              )}
            </td>
          </tr>
        ))}
      </Table>
      <section className="card" style={{ marginTop: 16 }}>
        <h2>{t('The roles')}</h2>
        <dl className="role-list">
          {ROLE_HELP.filter(([r]) => myRoles.includes(r)).map(([r, text]) => <div key={r}><dt>{label(r)}</dt><dd>{t(text)}</dd></div>)}
        </dl>
      </section>
      {ask?.kind === 'deactivate' && (
        <ConfirmDialog
          title={t('Deactivate {name}?', { name: ask.user.full_name })}
          message={t('{user} will be signed out straight away and cannot sign in until the account is activated again. Nothing is deleted: the account and its history are kept.', { user: ask.user.username })}
          reasonLabel="Why is this account being deactivated?" reasonRequired reasonHelp="Kept in the account history." suggestions={DEACTIVATE_REASONS}
          confirmLabel="Deactivate" danger
          onConfirm={(reason) => setActive(ask.user, false, reason)} onClose={() => setAsk(null)}
        />
      )}
      {ask?.kind === 'activate' && (
        <ConfirmDialog
          title={t('Activate {name}?', { name: ask.user.full_name })}
          message={t('{user} will be able to sign in again with their existing password.', { user: ask.user.username })}
          reasonLabel="Note (optional)" reasonHelp="Kept in the account history, e.g. Back from leave."
          confirmLabel="Activate"
          onConfirm={(reason) => setActive(ask.user, true, reason)} onClose={() => setAsk(null)}
        />
      )}
      {ask?.kind === 'signout' && (
        <ConfirmDialog
          title={t('Sign {name} out everywhere?', { name: ask.user.full_name })}
          message={t('{user} will be signed out on every device and must sign in again. The account stays active.', { user: ask.user.username })}
          confirmLabel="Sign out everywhere"
          onConfirm={() => endSessions(ask.user)} onClose={() => setAsk(null)}
        />
      )}
    </>
  );
}
