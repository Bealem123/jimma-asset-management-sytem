import { api, tokenStore } from '../api.js';
import { LANGUAGES, markChosen, t, useLanguage } from '../i18n.jsx';
import NavIcon from './NavIcon.jsx';

/** Language picker. When signed in, the choice is also saved on the user's account. */
export default function LanguageSwitcher({ className }) {
  const { lang, setLang } = useLanguage();
  async function change(code) {
    markChosen();
    if (tokenStore.get()) await api.post('/auth/language', { language: code }).catch(() => {});
    await setLang(code);
  }
  return (
    <label className={`lang-switch ${className || ''}`}>
      <span className="sr-only">{t('Language')}</span>
      <NavIcon name="globe" />
      <select value={lang} onChange={(e) => change(e.target.value)} aria-label={t('Language')}>
        {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.native}</option>)}
      </select>
    </label>
  );
}
