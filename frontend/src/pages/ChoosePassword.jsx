import { ApiError, api, tokenStore } from '../api.js';
import { Alert, SpecForm } from '../components/ui.jsx';
import { validatePassword } from '../validation.js';
import LanguageSwitcher from '../components/LanguageSwitcher.jsx';
import { useAuth } from '../auth.jsx';
import { label } from '../format.js';
import { t } from '../i18n.jsx';

/** Shown instead of the system while the account still has a temporary password. */
export default function ChoosePassword() {
  const { user, logout, refresh } = useAuth();
  return (
    <div className="login">
      <div className="login-lang"><LanguageSwitcher /></div>
      <div className="card">
        <h1>{t('Choose your own password')}</h1>
        <p className="muted">
          {t('You signed in with a temporary password. Choose a new one that only you know before you continue.')}
        </p>
        <p className="small"><strong>{user.full_name}</strong> · {label(user.role)}</p>
        <Alert kind="info">{t('At least 8 characters, with upper- and lower-case letters, a number and a symbol. Do not reuse the temporary password.')}</Alert>
        <SpecForm
          submitLabel="Save new password"
          onSubmit={async (v) => {
            if (v.new_password !== v.confirm_password) {
              throw new ApiError(400, 'Check the highlighted fields.', { confirm_password: 'The two new passwords are not the same.' });
            }
            const res = await api.post('/auth/change-password', { current_password: v.current_password, new_password: v.new_password });
            if (res.token) tokenStore.set(res.token);
            await refresh();
          }}
          fields={[
            { name: 'current_password', label: 'Temporary password', type: 'password', required: true, autoComplete: 'current-password', wide: true },
            { name: 'new_password', label: 'New password', type: 'password', required: true, autoComplete: 'new-password', wide: true, validate: (v) => validatePassword(v, { label: 'New password' }) },
            { name: 'confirm_password', label: 'New password again', type: 'password', required: true, autoComplete: 'new-password', wide: true },
          ]}
        />
        <p><button type="button" className="btn btn-small btn-signout" onClick={() => logout()}>{t('Sign out')}</button></p>
      </div>
    </div>
  );
}
