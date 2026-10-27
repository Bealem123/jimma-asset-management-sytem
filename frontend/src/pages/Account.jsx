import { useState } from 'react';
import { api, tokenStore } from '../api.js';
import { useAuth } from '../auth.jsx';
import { can } from '../permissions.js';
import { label } from '../format.js';
import { areaOf } from '../area.js';
import { Alert, PageHeader, SpecForm } from '../components/ui.jsx';
import { validatePassword } from '../validation.js';
import { useLookups } from '../lookups.jsx';
import { t } from '../i18n.jsx';
import { PhotoPicker } from '../components/Avatar.jsx';

export default function Account() {
  const { user, refresh } = useAuth();
  const lk = useLookups();
  const [done, setDone] = useState(false);
  const area = areaOf(user, lk);

  return (
    <>
      <PageHeader title="My account" />
      <div className="grid grid-2">
        <section className="card">
          <h2>{t('Profile')}</h2>
          <PhotoPicker user={user} path="/auth/photo" onChanged={() => refresh()} />
          <dl className="dl">
            <dt>{t('Name')}</dt><dd>{user.full_name}</dd>
            <dt>{t('Username')}</dt><dd>{user.username}</dd>
            <dt>{t('Role')}</dt><dd>{label(user.role)}</dd>
            <dt>{t('Assigned area')}</dt>
            <dd>{can.citywide(user) ? t('Whole city') : area || t('None assigned. Ask an administrator.')}</dd>
            <dt>{t('E-mail')}</dt><dd>{user.email || t('Not set. An administrator can add it to send you notifications.')}</dd>
            <dt>{t('Phone')}</dt><dd>{user.phone || t('Not set')}</dd>
          </dl>
          <details style={{ marginTop: 12 }}>
            <summary className="small">{t('What my role can do ({n} permissions)', { n: user.permissions.length })}</summary>
            <ul className="small">{user.permissions.map((p) => <li key={p}>{t(lk.enums.permissions?.[p] || p)}</li>)}</ul>
          </details>
        </section>
        <section className="card">
          <h2>{t('Change password')}</h2>
          <Alert kind="success">{done && t('Password changed. Your other sign-ins were ended.')}</Alert>
          <SpecForm
            key={String(done)}
            submitLabel="Change password"
            onSubmit={async (v) => {
              const res = await api.post('/auth/change-password', { current_password: v.current_password, new_password: v.new_password });
              if (res.token) tokenStore.set(res.token); // the old token no longer works: keep this browser signed in
              setDone(true);
            }}
            fields={[
              { name: 'current_password', label: 'Current password', type: 'password', required: true, autoComplete: 'current-password', wide: true },
              { name: 'new_password', label: 'New password', type: 'password', required: true, autoComplete: 'new-password', help: 'At least 8 characters, with upper- and lower-case letters, a number and a symbol.', wide: true, validate: (v) => validatePassword(v, { label: 'New password' }) },
            ]}
          />
        </section>
      </div>
    </>
  );
}
