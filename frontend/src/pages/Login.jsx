import { useState } from 'react';
import '@fontsource/playfair-display';
import '@fontsource-variable/plus-jakarta-sans';
import '@fontsource-variable/montserrat';
import LanguageSwitcher from '../components/LanguageSwitcher.jsx';
import { useAuth } from '../auth.jsx';
import { t } from '../i18n.jsx';
import './login.css';

// "Home" is the Jimma City portal (the City's front page, a separate site), set by VITE_PORTAL_URL when it lives elsewhere
const PORTAL_URL = import.meta.env.VITE_PORTAL_URL || 'https://jimma.gov.et/';

export default function Login() {
  const { login, notice } = useAuth();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError(t('Please enter both username and password.'));
      return;
    }
    setError('');
    setBusy(true);
    try {
      await login(username.trim(), password);
    } catch (err) {
      setError(err?.message || t('Unable to sign in. Please verify your credentials.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="destiny-login-viewport">
      <div className="destiny-login-frame">
        {/* Left Panel: Signature Theme Teal with Landscape Overlay */}
        <section className="destiny-panel-left" aria-label={t('About Jimma City Asset Management')}>
          <div className="destiny-left-top">
            <a href={PORTAL_URL} className="destiny-brand-link" title={t('Home')}>
              <img src="/brand/logo-256.png" alt="Jimma City Emblem" className="destiny-brand-mark" />
              <div className="destiny-brand-text">
                <span className="destiny-brand-title">{t('Jimma City')}</span>
                <span className="destiny-brand-subtitle">{t('Smart Asset Management')}</span>
              </div>
            </a>
          </div>

          <div className="destiny-left-center">
            <h1 className="destiny-headline">{t("Let's Kick Now !")}</h1>
            <p className="destiny-subhead">{t('Smart, transparent & verified municipal asset governance.')}</p>
          </div>

          <div className="destiny-left-bottom">
            <a href={PORTAL_URL} className="destiny-home-link">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m15 18-6-6 6-6"/>
              </svg>
              <span>{t('HOME')}</span>
            </a>
          </div>
        </section>

        {/* Right Panel: Crisp White with Concentric Orbital Rings */}
        <section className="destiny-panel-right" aria-label={t('Sign In Workspace')}>
          <div className="destiny-right-top">
            <LanguageSwitcher className="destiny-lang-switcher" />
          </div>

          {/* Concentric Orbital Rings Motif matching the design */}
          <div className="destiny-rings-wrap" aria-hidden="true">
            <svg className="destiny-rings-svg" viewBox="0 0 500 500" fill="none">
              <circle cx="320" cy="250" r="210" stroke="rgba(14, 90, 83, 0.07)" strokeWidth="1.5" />
              <circle cx="320" cy="250" r="150" stroke="rgba(14, 90, 83, 0.11)" strokeWidth="2" />
              <circle cx="320" cy="250" r="90" fill="rgba(14, 90, 83, 0.035)" stroke="rgba(14, 90, 83, 0.14)" strokeWidth="2.5" />
              <circle cx="170" cy="144" r="8" fill="rgba(14, 90, 83, 0.22)" />
            </svg>
          </div>

          <div className="destiny-right-bottom">
            <span className="destiny-copyright">{t('© Copyright 2026. Jimma City Administration')}</span>
          </div>
        </section>

        {/* Center Floating Card: Overlapping Both Sides */}
        <main className="destiny-center-card" aria-label={t('Sign In Form')}>
          <div className="destiny-card-header">
            <h2 className="destiny-card-title">{t('SIGN IN')}</h2>
            <div className="destiny-title-pill" aria-hidden="true" />
          </div>

          {(notice || error) && (
            <div className={`destiny-alert ${error ? 'destiny-alert-error' : 'destiny-alert-info'}`} role="alert">
              {error ? t(error) : t(notice)}
            </div>
          )}

          <form onSubmit={handleSubmit} className="destiny-form" noValidate>
            <div className="destiny-input-group">
              <input
                id="login-username"
                type="text"
                className="destiny-input"
                placeholder={t('Username')}
                value={username}
                maxLength={80}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                required
                aria-label={t('Username')}
              />
              <span className="destiny-input-icon" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
              </span>
            </div>

            <div className="destiny-input-group">
              <input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                maxLength={200}
                className="destiny-input"
                placeholder={t('Password')}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                aria-label={t('Password')}
              />
              <button
                type="button"
                className="destiny-input-icon destiny-icon-btn"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? t('Hide password') : t('Show password')}
                title={showPassword ? t('Hide password') : t('Show password')}
              >
                {showPassword ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                )}
              </button>
            </div>

            <button type="submit" className="destiny-submit-btn" disabled={busy}>
              {busy ? (
                <>
                  <span className="destiny-spinner" aria-hidden="true" />
                  <span>{t('Signing in…')}</span>
                </>
              ) : (
                t('Sign In')
              )}
            </button>

            <div className="destiny-card-footer">
              <span className="destiny-footer-muted">{t('Need help or forgot credentials?')} </span>
              <span className="destiny-footer-highlight">{t('Contact Administrator')}</span>
            </div>
          </form>
        </main>
      </div>
    </div>
  );
}
