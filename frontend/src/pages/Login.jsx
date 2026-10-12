import { Link } from 'react-router-dom';
import '@fontsource-variable/montserrat';
import { SpecForm, Alert } from '../components/ui.jsx';
import LanguageSwitcher from '../components/LanguageSwitcher.jsx';
import { useAuth } from '../auth.jsx';
import { t } from '../i18n.jsx';

// Sign-in: a frosted-glass card over a full-screen photo of Jimma (public/login-bg.jpg; a dark gradient without it).
export default function Login() {
  const { login, notice } = useAuth();
  return (
    <div className="login">
      <div className="login-lang login-top"><Link to="/" className="small">← {t('Home')}</Link><LanguageSwitcher /></div>
      <div className="card">
        <h1>{t('Sign in')}</h1>
        <p className="muted">{t('Sign in with the account given to you by the system administrator.')}</p>
        <Alert kind="info">{notice}</Alert>
        <SpecForm
          submitLabel="Sign in"
          onSubmit={(v) => login(v.username, v.password)}
          fields={[
            { name: 'username', label: 'Username', placeholder: 'Enter your username', required: true, autoComplete: 'username', wide: true },
            { name: 'password', label: 'Password', placeholder: 'Enter your password', type: 'password', required: true, autoComplete: 'current-password', wide: true },
          ]}
        />
      </div>
    </div>
  );
}
