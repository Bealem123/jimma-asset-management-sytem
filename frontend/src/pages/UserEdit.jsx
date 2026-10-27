import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useLookups } from '../lookups.jsx';
import { can } from '../permissions.js';
import { label } from '../format.js';
import { Alert, Loading, PageHeader, SpecForm, opt } from '../components/ui.jsx';
import { t } from '../i18n.jsx';
import { PhotoPicker } from '../components/Avatar.jsx';
import NavIcon from '../components/NavIcon.jsx';
import { validateEmail, validatePassword, validatePhone } from '../validation.js';
import { nameFields } from './Users.jsx';

const BY_KIFLE_KETEMA = ['FINANCIAL_OFFICER', 'INSPECTOR'];

export default function UserEdit() {
  const { id } = useParams();
  const navigate = useNavigate();
  const lk = useLookups();
  const { user: me } = useAuth();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError('');
    api.get(`/users/${id}`)
      .then((data) => {
        if (live) setUser(data);
      })
      .catch((err) => {
        if (live) setError(err.message || 'Failed to load user account.');
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => { live = false; };
  }, [id]);

  if (loading) return <Loading />;
  if (error) {
    return (
      <>
        <p style={{ margin: '0 0 12px' }}><Link to="/users">← {t('Back to users')}</Link></p>
        <Alert kind="bad">{error}</Alert>
      </>
    );
  }
  if (!user) return null;

  const roleKeys = Array.from(new Set([...can.managedAccountRoles(me), user.role])).filter(Boolean);
  const myKebeles = me.role === 'KIFLE_ADMIN' ? lk.kebeles.filter((k) => me.scope.kifle.includes(k.kifle_ketema_id))
    : me.role === 'KEBELE_ADMIN' ? lk.kebeles.filter((k) => me.scope.kebeles.includes(k.id)) : lk.kebeles;

  const ids = (arr) => (arr || []).map(Number);

  const fields = [
    // the username stays as it was made; the name is the person's own name and father's name
    ...nameFields(undefined).map(({ page, ...f }) => (f.name === 'first_name' ? { ...f, help: t('Their username stays {username}.', { username: user.username }) } : f)),
    {
      name: 'role',
      label: 'Role',
      type: 'select',
      required: true,
      options: [{ value: '', label: 'Choose…' }, ...roleKeys.map((r) => ({ value: r, label: label(r) }))],
    },
    {
      name: 'password',
      label: 'New password (leave empty to keep)',
      type: 'password',
      autoComplete: 'new-password',
      help: 'At least 8 characters, with upper- and lower-case letters, a number and a symbol. Setting one signs the user out everywhere.',
      validate: (v) => (v ? validatePassword(v, { required: false, min: 8, label: 'Password' }) : null),
    },
    {
      name: 'email',
      label: 'E-mail',
      type: 'email',
      help: 'For e-mail notifications.',
      validate: (v) => validateEmail(v, { required: false, label: 'E-mail' }),
    },
    {
      name: 'phone',
      label: 'Phone',
      type: 'tel',
      help: 'For SMS notifications, e.g. +2519…',
      validate: (v) => validatePhone(v, { required: false, label: 'Phone' }),
    },
    {
      name: 'sector_id',
      label: 'Sector',
      type: 'select',
      required: true,
      options: [{ value: '', label: 'Choose…' }, ...lk.sectors.map((x) => ({ value: String(x.id), label: t(x.name) }))],
      show: (v) => v.role === 'SECTOR_ADMIN',
      help: 'One of the 13 sectors. A Sector Administrator manages exactly one sector in this Kebele.',
    },
    {
      name: 'kifle_ketema_ids',
      label: 'Kifle Ketemas',
      type: 'multiselect',
      options: opt(lk.kifle),
      show: (v) => v.role === 'KIFLE_ADMIN' || BY_KIFLE_KETEMA.includes(v.role),
      help: 'Exactly one. Each Kifle Ketema has one Kifle Ketema Administrator, one Financial Officer and one Inspector, who cover every Kebele in it.',
    },
    {
      name: 'kebele_ids',
      label: 'Kebeles',
      type: 'multiselect',
      options: opt(myKebeles, (k) => `${t(k.name)}${k.kifle_ketema_name ? ` (${k.kifle_ketema_name})` : ` (${t('Kifle Ketema not set')})`}`),
      show: (v) => v.role === 'KEBELE_ADMIN' || v.role === 'SECTOR_ADMIN',
      help: 'A Kebele Administrator and a Sector Administrator each have exactly one.',
    },
    {
      name: 'is_active',
      type: 'checkbox',
      label: 'Active',
      checkLabel: 'Account is active (can sign in)',
      wide: true,
    },
    {
      name: 'reason',
      label: 'Reason for deactivating',
      required: true,
      wide: true,
      show: (v) => Boolean(user?.is_active) && !v.is_active,
      help: 'Kept in the account history, e.g. On leave until December.',
    },
  ];

  async function save(v) {
    const body = {
      first_name: v.first_name,
      father_name: v.father_name,
      grandfather_name: v.grandfather_name,
      role: v.role,
      is_active: v.is_active,
      email: v.email,
      phone: v.phone,
      kifle_ketema_ids: ids(v.kifle_ketema_ids),
      kebele_ids: ids(v.kebele_ids),
      sector_ids: v.role === 'SECTOR_ADMIN' && v.sector_id ? [Number(v.sector_id)] : [],
    };
    if (v.password) body.password = v.password;
    if (Boolean(user.is_active) !== Boolean(v.is_active)) body.reason = v.reason;

    await api.patch(`/users/${user.id}`, body);
    navigate('/users', { state: { flash: t('User {name} updated.', { name: user.username }) } });
  }

  return (
    <>
      <p style={{ margin: '0 0 12px' }}>
        <Link to="/users" className="btn-icon-nav">
          <NavIcon name="chevronLeft" /> {t(me.role === 'KEBELE_ADMIN' ? 'Back to Sector Administrators' : 'Back to users')}
        </Link>
      </p>

      <section className="card">
        <PageHeader title={t('Edit {username}', { username: user.username })} subtitle={`${user.full_name} · ${label(user.role)}`}>
          <div className="actions">
            <Link to={`/users/${user.id}/history`} className="btn btn-small">
              <span className="btn-icon-nav"><NavIcon name="history" /> {t('Account history')}</span>
            </Link>
            <Link to="/users" className="btn btn-small">
              {t(me.role === 'KEBELE_ADMIN' ? 'Back to Sector Administrators' : 'Back to users')}
            </Link>
          </div>
        </PageHeader>

        {user.read_only && (
          <Alert kind="warn">{t('This account is view-only for your administrative scope. You cannot modify it.')}</Alert>
        )}

        <div style={{ marginBottom: 20 }}>
          <PhotoPicker
            user={user}
            path={`/users/${user.id}/photo`}
            onChanged={(photo) => setUser((u) => ({ ...u, photo }))}
          />
        </div>

        <SpecForm
          key={user.id}
          fields={fields}
          initial={{
            ...user,
            first_name: user.first_name ?? '',
            father_name: user.father_name ?? '',
            grandfather_name: user.grandfather_name ?? '',
            password: '',
            email: user.email ?? '',
            phone: user.phone ?? '',
            sector_id: user.sector_ids?.[0] ? String(user.sector_ids[0]) : '',
            kifle_ketema_ids: (user.kifle_ketema_ids || []).map(String),
            kebele_ids: (user.kebele_ids || []).map(String),
            is_active: Boolean(user.is_active),
            reason: '',
          }}
          submitLabel={t('Save changes')}
          onSubmit={save}
          onCancel={() => navigate('/users')}
          disabled={user.read_only}
        />
      </section>
    </>
  );
}
