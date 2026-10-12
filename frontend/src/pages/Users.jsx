import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useLookups } from '../lookups.jsx';
import { can } from '../permissions.js';
import { dateTime, label } from '../format.js';
import {
  Alert, Badge, ConfirmDialog, Loading, Modal, PageHeader, SpecForm, Table, opt, useAsync,
} from '../components/ui.jsx';
import { t } from '../i18n.jsx';
import { Avatar, PhotoPicker } from '../components/Avatar.jsx';

const CITYWIDE = ['SUPER_ADMIN', 'EXECUTIVE', 'AUDITOR'];
// The roles the City uses, and what each one does: the hierarchy top to bottom, then the specialist roles beside it.
const ROLE_HELP = [
  ['SUPER_ADMIN', 'Runs the system: the Kifle Ketema Administrator, Mayor and specialist accounts, master data, permissions and settings. Changes no assets.'],
  ['EXECUTIVE', 'The Mayor and executives: see the whole city, its reports and the performance of each area. Change nothing.'],
  ['KIFLE_ADMIN', 'Approves registrations, transfers and disposals in one Kifle Ketema, and creates its Kebele Administrators.'],
  ['KEBELE_ADMIN', 'Verifies newly registered assets in one Kebele and runs physical verification; creates its Sector Administrators.'],
  ['SECTOR_ADMIN', 'Registers the assets of one sector inside one Kebele and keeps their records up to date.'],
  ['AUDITOR', 'Checks the records independently: sees the whole city, its financial figures and the audit log. Changes nothing.'],
  ['FINANCIAL_OFFICER', 'Records valuations and income for one or more Kifle Ketemas.'],
  ['INSPECTOR', 'Inspects the technical condition of assets and records verification results in one or more Kifle Ketemas.'],
];
// The specialist roles: created by the Super Administrator beside the hierarchy, each covering one or more Kifle Ketemas.
const SPECIALISTS = ['AUDITOR', 'FINANCIAL_OFFICER', 'INSPECTOR'];
const BY_KIFLE_KETEMA = ['FINANCIAL_OFFICER', 'INSPECTOR'];
const ADD_SPECIALIST = { AUDITOR: 'Add Internal Auditor', FINANCIAL_OFFICER: 'Add Financial Officer', INSPECTOR: 'Add Inspector' };
const ONE_FOR_THE_CITY = ['AUDITOR']; // like the Mayor: one active account (the server refuses a second)

// Reasons offered when an account is switched off (the person can also type their own).
const DEACTIVATE_REASONS = ['On leave', 'Transferred to another office', 'Left the office', 'Password may be known to others', 'Replaced by a new administrator'];

const SUBTITLE = {
  KIFLE_ADMIN: 'You create and manage the three Kifle Ketema Administrators, the Mayor / Executive accounts and the Internal Auditors, Financial Officers and Inspectors. The accounts below them are listed for you to follow; each level manages the one beneath it.',
  KEBELE_ADMIN: 'You can create and manage the Kebele Administrators of your Kifle Ketema. The Sector Administrators working in those Kebeles and the Inspectors of your Kifle Ketema are listed for you to follow, but you cannot change them.',
  SECTOR_ADMIN: 'You can create and manage the Sector Administrators of your Kebele, one for each sector.',
};

export default function Users() {
  const lk = useLookups();
  const { user: me } = useAuth();
  const target = can.managedAccountRole(me); // each level manages only the level below it
  const { data, error, loading, reload } = useAsync(() => api.get('/users'), []);
  const [modal, setModal] = useState(null);
  const [ask, setAsk] = useState(null); // { kind: 'deactivate' | 'activate' | 'signout', user }
  const [flash, setFlash] = useState('');
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');

  if (loading && !data) return <Loading />;
  if (error) return <Alert>{error}</Alert>;

  const needle = search.trim().toLowerCase();
  const shown = data.filter((u) => (!roleFilter || u.role === roleFilter)
    && (!needle || u.username.toLowerCase().includes(needle) || u.full_name.toLowerCase().includes(needle)));

  const ids = (arr) => (arr || []).map(Number);
  const roleKeys = can.managedAccountRoles(me);
  const myKebeles = me.role === 'KIFLE_ADMIN' ? lk.kebeles.filter((k) => me.scope.kifle.includes(k.kifle_ketema_id))
    : me.role === 'KEBELE_ADMIN' ? lk.kebeles.filter((k) => me.scope.kebeles.includes(k.id)) : lk.kebeles;
  const editing = modal?.user;

  const fields = [
    { name: 'username', label: 'Username', required: true, autoComplete: 'off', help: 'What the person types to sign in. Letters, numbers, dot, dash, underscore.' },
    { name: 'full_name', label: 'Full name', required: true },
    { name: 'role', label: 'Role', type: 'select', required: true, options: [{ value: '', label: 'Choose…' }, ...roleKeys.map((r) => ({ value: r, label: label(r) }))] },
    { name: 'password', label: editing ? 'New password (leave empty to keep)' : 'Password', type: 'password', required: !editing, autoComplete: 'new-password', help: 'At least 10 characters. Setting one signs the user out everywhere.' },
    { name: 'email', label: 'E-mail', type: 'email', help: 'For e-mail notifications.' },
    { name: 'phone', label: 'Phone', help: 'For SMS notifications, e.g. +2519…' },
    { name: 'sector_id', label: 'Sector', type: 'select', required: true, options: [{ value: '', label: 'Choose…' }, ...lk.sectors.map((x) => ({ value: String(x.id), label: t(x.name) }))], show: (v) => v.role === 'SECTOR_ADMIN', help: 'One of the 13 sectors. A Sector Administrator manages exactly one sector in this Kebele.' },
    { name: 'kifle_ketema_ids', label: 'Kifle Ketemas', type: 'multiselect', options: opt(lk.kifle), show: (v) => v.role === 'KIFLE_ADMIN' || BY_KIFLE_KETEMA.includes(v.role), help: 'A Kifle Ketema Administrator has exactly one. A Financial Officer or Inspector has one or more, and covers every Kebele in them.' },
    { name: 'kebele_ids', label: 'Kebeles', type: 'multiselect', options: opt(myKebeles, (k) => `${t(k.name)}${k.kifle_ketema_name ? ` (${k.kifle_ketema_name})` : ` (${t('Kifle Ketema not set')})`}`), show: (v) => v.role === 'KEBELE_ADMIN' || v.role === 'SECTOR_ADMIN', help: 'A Kebele Administrator and a Sector Administrator each have exactly one.' },
    { name: 'is_active', type: 'checkbox', label: 'Active', checkLabel: 'Account is active (can sign in)', wide: true },
    { name: 'reason', label: 'Reason for deactivating', required: true, wide: true, show: (v) => Boolean(editing?.is_active) && !v.is_active, help: 'Kept in the account history, e.g. On leave until December.' },
  ];

  async function save(v) {
    const body = {
      username: v.username, full_name: v.full_name, role: v.role, is_active: v.is_active, email: v.email, phone: v.phone,
      kifle_ketema_ids: ids(v.kifle_ketema_ids), kebele_ids: ids(v.kebele_ids), sector_ids: v.role === 'SECTOR_ADMIN' && v.sector_id ? [Number(v.sector_id)] : [],
    };
    if (v.password) body.password = v.password;
    if (editing && Boolean(editing.is_active) !== Boolean(v.is_active)) body.reason = v.reason;
    if (editing) await api.patch(`/users/${editing.id}`, body);
    else await api.post('/users', body);
    setModal(null);
    setFlash(editing ? 'User updated.' : 'User created.');
    reload();
  }

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
              <button type="button" className="btn btn-small" onClick={() => setModal({ user: u })}>{t('Edit')}</button>
              {u.is_active
                ? <button type="button" className="btn btn-small" onClick={() => setAsk({ kind: 'deactivate', user: u })}>{t('Deactivate')}</button>
                : <button type="button" className="btn btn-small" onClick={() => setAsk({ kind: 'activate', user: u })}>{t('Activate')}</button>}
              <Link className="btn btn-small" to={`/users/${u.id}/history`}>{t('History')}</Link>
            </div>
          </td>
        </tr>
      ))}
    </Table>
  );

  return (
    <>
      <PageHeader title="Users" subtitle={SUBTITLE[target]}>
        <button type="button" className="btn btn-small btn-primary btn-add" onClick={() => setModal({})}>{t('Add user')}</button>
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
                      {u && <button type="button" className="btn btn-small" onClick={() => setModal({ user: u })}>{t('Edit')}</button>}
                      {u?.is_active && <button type="button" className="btn btn-small" onClick={() => setAsk({ kind: 'deactivate', user: u })}>{t('Deactivate')}</button>}
                      {u && !u.is_active && <button type="button" className="btn btn-small" onClick={() => setAsk({ kind: 'activate', user: u })}>{t('Activate')}</button>}
                      {u && <Link className="btn btn-small" to={`/users/${u.id}/history`}>{t('History')}</Link>}
                      {(!u || !u.is_active) && !admins.some((a) => a.is_active) && (
                        <button type="button" className="btn btn-small btn-primary" onClick={() => setModal({ preset: { role: 'KIFLE_ADMIN', kifle_ketema_ids: [String(k.id)] } })}>{t('Create administrator')}</button>
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
              <button type="button" className="btn btn-small btn-primary btn-add" onClick={() => setModal({ preset: { role: 'EXECUTIVE' } })}>{t('Add Mayor / Executive')}</button>
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
              {SPECIALISTS.filter((r) => !ONE_FOR_THE_CITY.includes(r) || !data.some((u) => u.role === r && u.is_active)).map((r) => (
                <button key={r} type="button" className="btn btn-small btn-primary btn-add" onClick={() => setModal({ preset: { role: r } })}>{t(ADD_SPECIALIST[r])}</button>
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
      {me.role === 'SUPER_ADMIN' && <h2>{t('All accounts')}</h2>}
      <div className="filters">
        <div className="field grow">
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('Search by username or name')} aria-label={t('Search by username or name')} />
        </div>
        <div className="field">
          <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} aria-label={t('Role')}>
            <option value="">{t('All roles')}</option>
            {ROLE_HELP.map(([r]) => <option key={r} value={r}>{label(r)}</option>)}
          </select>
        </div>
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
                  <Link className="btn btn-small" to={`/users/${u.id}/history`}>{t('History')}</Link>
                </div>
              ) : (
                <div className="actions">
                  <button type="button" className="btn btn-small" onClick={() => setModal({ user: u })}>{t('Edit')}</button>
                  <Link className="btn btn-small" to={`/users/${u.id}/history`}>{t('History')}</Link>
                  <button type="button" className="btn btn-small" onClick={() => setAsk({ kind: 'signout', user: u })}>{t('Sign out')}</button>
                </div>
              )}
            </td>
          </tr>
        ))}
      </Table>
      <section className="card" style={{ marginTop: 16 }}>
        <h2>{t('The roles')}</h2>
        <dl className="role-list">
          {ROLE_HELP.map(([r, text]) => <div key={r}><dt>{label(r)}</dt><dd>{t(text)}</dd></div>)}
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
      {modal && (
        <Modal title={editing ? `Edit ${editing.username}` : 'Add user'} onClose={() => setModal(null)} wide>
          {editing && (
            <PhotoPicker
              user={editing} path={`/users/${editing.id}/photo`}
              onChanged={(photo) => { setModal((m) => ({ ...m, user: { ...m.user, photo } })); reload(); }}
            />
          )}
          <SpecForm
            key={editing?.id ?? 'new'}
            fields={fields}
            initial={editing
              ? { ...editing, password: '', email: editing.email ?? '', phone: editing.phone ?? '', sector_id: editing.sector_ids?.[0] ? String(editing.sector_ids[0]) : '', kifle_ketema_ids: editing.kifle_ketema_ids.map(String), kebele_ids: editing.kebele_ids.map(String), is_active: Boolean(editing.is_active) }
              : { role: target, is_active: true, kifle_ketema_ids: [], kebele_ids: me.role === 'KEBELE_ADMIN' && me.scope.kebeles.length === 1 ? [String(me.scope.kebeles[0])] : [], sector_id: '', ...modal.preset }}
            onSubmit={save}
            onCancel={() => setModal(null)}
          />
        </Modal>
      )}
    </>
  );
}
