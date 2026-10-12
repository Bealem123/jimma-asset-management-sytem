import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, setUnauthorizedHandler, tokenStore } from './api.js';
import { getLanguage, hasChosen, useLanguage } from './i18n.jsx';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(Boolean(tokenStore.get()));
  const [notice, setNotice] = useState('');
  const { setLang } = useLanguage();

  // A language picked on this device wins and is saved to the account; on a device where nothing was
  // picked, the language saved on the account is used.
  const adoptLanguage = useCallback(async (u) => {
    if (hasChosen()) {
      if (u.language !== getLanguage()) api.post('/auth/language', { language: getLanguage() }).catch(() => {});
    } else if (u.language && u.language !== getLanguage()) {
      await setLang(u.language);
    }
  }, [setLang]);

  const logout = useCallback((message = '') => {
    tokenStore.clear();
    setUser(null);
    setNotice(message);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => logout('Your session has ended. Please sign in again.'));
    if (!tokenStore.get()) return;
    api.get('/auth/me').then((r) => { setUser(r.user); adoptLanguage(r.user); }).catch(() => tokenStore.clear()).finally(() => setLoading(false));
  }, [logout, adoptLanguage]);

  const login = useCallback(async (username, password) => {
    const r = await api.post('/auth/login', { username, password });
    tokenStore.set(r.token);
    setNotice('');
    setUser(r.user);
    adoptLanguage(r.user);
  }, [adoptLanguage]);

  /** Reload the signed-in user (e.g. after choosing a new password). */
  const refresh = useCallback(async () => {
    const r = await api.get('/auth/me');
    setUser(r.user);
  }, []);

  const value = useMemo(() => ({ user, loading, login, logout, notice, refresh }), [user, loading, login, logout, notice, refresh]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
