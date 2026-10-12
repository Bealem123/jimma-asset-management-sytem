import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './auth.jsx';
import { I18nProvider, LanguageBoundary } from './i18n.jsx';
import App from './App.jsx';
import '@fontsource-variable/plus-jakarta-sans';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <I18nProvider>
      <BrowserRouter>
        <AuthProvider>
          <LanguageBoundary><App /></LanguageBoundary>
        </AuthProvider>
      </BrowserRouter>
    </I18nProvider>
  </StrictMode>,
);

// Offline support (installable app + field data collection). Only in the built app, never in development.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* offline support is optional */ });
  });
}
