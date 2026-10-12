import { Fragment, Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { Navigate, NavLink, Route, Routes, Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from './api.js';
import { useAuth } from './auth.jsx';
import { LookupProvider, useLookups } from './lookups.jsx';
import { can } from './permissions.js';
import { label } from './format.js';
import { areaOf } from './area.js';
import { clearFailed, syncOutbox, useOutbox } from './offline.js';
import { Alert, Loading } from './components/ui.jsx';
import Login from './pages/Login.jsx';
import ChoosePassword from './pages/ChoosePassword.jsx';
import LanguageSwitcher from './components/LanguageSwitcher.jsx';
import NavIcon from './components/NavIcon.jsx';
import { Avatar } from './components/Avatar.jsx';
import Dashboard from './pages/Dashboard.jsx';
import AssetList from './pages/AssetList.jsx';
import AssetForm from './pages/AssetForm.jsx';
import AssetDetail from './pages/AssetDetail.jsx';
import Approvals from './pages/Approvals.jsx';
import Reservations from './pages/Reservations.jsx';
import ImportPage from './pages/ImportPage.jsx';
import FollowUps from './pages/FollowUps.jsx';
import Notifications from './pages/Notifications.jsx';
import Audit from './pages/Audit.jsx';
import MasterData from './pages/MasterData.jsx';
import Users from './pages/Users.jsx';
import Account from './pages/Account.jsx';
import { t } from './i18n.jsx';

// Heavy screens (map, camera scanner, barcodes, charts) load only when opened, so the first page stays light on a phone.
const Scan = lazy(() => import('./pages/Scan.jsx'));
const MapPage = lazy(() => import('./pages/MapPage.jsx'));
const Labels = lazy(() => import('./pages/Labels.jsx'));
const Analytics = lazy(() => import('./pages/Analytics.jsx'));
const Performance = lazy(() => import('./pages/Performance.jsx'));
const UserHistory = lazy(() => import('./pages/UserHistory.jsx'));
const System = lazy(() => import('./pages/System.jsx'));
const Verification = lazy(() => import('./pages/Verification.jsx'));
const VerificationDetail = lazy(() => import('./pages/Verification.jsx').then((m) => ({ default: m.VerificationDetail })));
const MonthlyReports = lazy(() => import('./pages/MonthlyReports.jsx'));
const MonthlyReportPage = lazy(() => import('./pages/MonthlyReports.jsx').then((m) => ({ default: m.MonthlyReportPage })));
const PrepareReportPage = lazy(() => import('./pages/MonthlyReports.jsx').then((m) => ({ default: m.PrepareReportPage })));
const Landing = lazy(() => import('./pages/Landing.jsx'));

/** Shows what is waiting on this device, and whether the connection is down. */
function OutboxBanner() {
  const { pending, failed, online } = useOutbox();
  const [busy, setBusy] = useState(false);
  if (online && !pending.length && !failed.length) return null;
  return (
    <div className="outbox" role="status">
      {!online && <div><strong>{t('You are offline.')}</strong>{' '}{t('You can keep recording inspections and verification results; they are saved on this device and sent when the connection returns.')}</div>}
      {pending.length > 0 && (
        <div>
          {t('{n} result(s) saved on this device, waiting to be sent.', { n: pending.length })}{' '}
          {online && <button type="button" className="btn btn-small" disabled={busy} onClick={async () => { setBusy(true); await syncOutbox(); setBusy(false); }}>{t('Send now')}</button>}
        </div>
      )}
      {failed.length > 0 && (
        <div className="outbox-failed">
          {t('{n} saved result(s) were refused by the server:', { n: failed.length })} {failed.map((f) => `${f.description} (${f.error})`).join('; ')}.{' '}
          <button type="button" className="btn btn-small" onClick={clearFailed}>{t('Dismiss')}</button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- side menu
// Every page the menu can link to. `show` repeats the page's own guard (pages without one are open to everybody);
// `badge` names a count from /dashboard/queue: work waiting for this user.
const NAV = {
  dashboard: { to: '/', end: true, icon: 'dashboard', text: 'Dashboard' },
  register: { to: '/assets/new', end: true, icon: 'register', text: 'Register asset', show: can.create },
  assets: { to: '/assets', icon: 'assets', text: 'Assets' },
  map: { to: '/map', icon: 'map', text: 'Map' },
  scan: { to: '/scan', icon: 'scan', text: 'Scan QR code' },
  approvals: { to: '/approvals', icon: 'approvals', text: 'Approvals', badge: 'approvals', show: (u) => can.review(u) || can.approve(u) || can.decide(u) || can.request(u) || can.oversee(u) },
  reservations: { to: '/reservations', icon: 'reservations', text: 'Reservations', show: can.reserve },
  verification: { to: '/verification', icon: 'verification', text: 'Verification', badge: 'verification', show: (u) => can.verify(u) || can.oversee(u) },
  followups: { to: '/follow-ups', icon: 'followups', text: 'Follow-ups' },
  monthly: { to: '/monthly-reports', icon: 'monthly', text: 'Monthly reports', badge: 'monthly', show: can.monthly },
  performance: { to: '/performance', icon: 'performance', text: 'Performance by area', show: can.analytics },
  analytics: { to: '/analytics', icon: 'analytics', text: 'Analytics', show: can.analytics },
  import: { to: '/import', icon: 'import', text: 'Import assets', show: can.importAssets },
  audit: { to: '/audit', icon: 'audit', text: 'Audit log', show: can.viewAudit },
  master: { to: '/master', icon: 'master', text: 'Master data', show: can.manageMaster },
  users: { to: '/users', icon: 'users', text: 'Users', show: can.openUsers },
  system: { to: '/system', icon: 'system', text: 'System', show: can.manageSystem },
};

// Each role's menu is built around its job, its own work first. An entry is a key, or [key, text] to rename it.
const MENUS = {
  EXECUTIVE: [ // decides and holds the areas to account; changes nothing
    [null, ['dashboard', 'monthly', 'performance', 'analytics']],
    ['Explore', ['map', 'assets']],
  ],
  SUPER_ADMIN: [ // runs the system
    [null, ['dashboard']],
    ['Administration', ['users', 'master', 'system', 'audit']],
    ['Monitoring', ['approvals', 'verification', 'monthly', 'performance', 'analytics']],
    ['Explore', ['assets', 'map']],
  ],
  KIFLE_ADMIN: [ // approves
    [null, ['dashboard']],
    ['Your work', ['approvals', 'verification', 'monthly', ['users', 'Kebele Administrators']]],
    ['Oversight', ['performance', 'assets', 'map', 'analytics']],
  ],
  KEBELE_ADMIN: [ // verifies in the field
    [null, ['dashboard']],
    ['Your work', ['verification', 'scan', ['approvals', 'Verify registrations'], 'followups', 'monthly']],
    ['Your Kebele', ['assets', 'map', 'reservations', ['users', 'Sector Administrators'], 'performance', 'analytics']],
  ],
  SECTOR_ADMIN: [ // registers and maintains
    [null, ['dashboard']],
    ['Your work', ['register', 'assets', ['approvals', 'Requests'], 'scan', 'verification', 'followups', 'reservations', 'monthly']],
    ['Insights', ['analytics', 'performance', 'map']],
  ],
  AUDITOR: [ // checks the records independently; changes nothing
    [null, ['dashboard']],
    ['Your work', ['audit', 'monthly', 'analytics', 'performance']],
    ['Explore', ['assets', 'map']],
  ],
  FINANCIAL_OFFICER: [ // values and income of its Kifle Ketemas
    [null, ['dashboard']],
    ['Your work', ['assets', 'monthly', 'analytics']],
    ['Explore', ['performance', 'map']],
  ],
  INSPECTOR: [ // inspects in the field
    [null, ['dashboard']],
    ['Your work', ['scan', 'assets', 'verification', 'followups', 'monthly']],
    ['Explore', ['map']],
  ],
};
// Every other role: the general menu.
const GENERAL_MENU = [
  [null, ['dashboard', 'assets', 'map', 'scan']],
  ['Operations', ['approvals', 'reservations', 'verification', 'followups']],
  ['Insights', ['analytics']],
  ['Administration', ['import', 'audit', 'master', 'users', 'system']],
];

/**
 * The menu for this user: the role's sections, without what its permissions do not allow. A page a Super
 * Administrator has since allowed this role (System → Permissions) but its menu does not list goes under "More".
 */
function menuFor(user) {
  const allowed = (key) => !NAV[key].show || NAV[key].show(user);
  const sections = (MENUS[user.role] || GENERAL_MENU)
    .map(([heading, entries]) => [heading, entries.map((e) => (Array.isArray(e) ? e : [e])).filter(([key]) => allowed(key))])
    .filter(([, items]) => items.length);
  const listed = new Set(sections.flatMap(([, items]) => items.map(([key]) => key)));
  const more = Object.keys(NAV).filter((key) => NAV[key].show && !listed.has(key) && allowed(key)).map((key) => [key]);
  return more.length ? [...sections, ['More', more]] : sections;
}

/** Every account should carry a profile picture: until it does, a reminder sits above each page (except My account). */
function PhotoReminder({ user }) {
  const location = useLocation();
  const [hidden, setHidden] = useState(() => { try { return sessionStorage.getItem('photo-reminder') === 'off'; } catch { return false; } });
  if (user.photo || hidden || location.pathname === '/account') return null;
  const hide = () => { try { sessionStorage.setItem('photo-reminder', 'off'); } catch { /* no storage: hide until reload */ } setHidden(true); };
  return (
    <div className="alert alert-info photo-reminder" role="status">
      <span>{t('Your account has no profile picture yet. Add one so colleagues can recognise you.')}</span>
      <span className="actions">
        <Link className="btn btn-small btn-primary" to="/account">{t('Add picture')}</Link>
        <button type="button" className="btn btn-small" onClick={hide}>{t('Later')}</button>
      </span>
    </div>
  );
}

/** Remembers on this device whether the menu is folded to icons. */
function useCollapsed() {
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('menu-collapsed') === '1'; } catch { return false; } });
  const toggle = useCallback((value) => {
    setCollapsed((c) => {
      const next = typeof value === 'boolean' ? value : !c;
      try { localStorage.setItem('menu-collapsed', next ? '1' : '0'); } catch { /* private window: just do not remember it */ }
      return next;
    });
  }, []);
  return [collapsed, toggle];
}

function Shell() {
  const { user, logout } = useAuth();
  const lookups = useLookups();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [collapsed, setCollapsed] = useCollapsed();
  const [query, setQuery] = useState('');
  const [queue, setQueue] = useState({});

  const refreshUnread = useCallback(() => {
    api.get('/notifications/count').then((r) => setUnread(r.unread)).catch(() => {});
    api.get('/dashboard/queue').then(setQueue).catch(() => {});
  }, []);
  useEffect(() => {
    refreshUnread();
    const timer = setInterval(refreshUnread, 60000);
    return () => clearInterval(timer);
  }, [refreshUnread]);

  function search(e) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    navigate(`/assets?q=${encodeURIComponent(q)}`);
    setQuery('');
    setOpen(false);
  }

  return (
    <div className={`app${collapsed ? ' collapsed' : ''}`}>
      <a className="skip" href="#main">{t('Skip to content')}</a>
      <aside className={`sidebar${open ? ' open' : ''}`}>
        <div className="sidebar-head">
          <Link to="/" className="brand">
            <img className="brand-mark" src="/brand/logo-256.png" alt="" aria-hidden="true" />
            <span className="brand-text">{t('Jimma City')}<small>{t('Smart Asset Management')}</small></span>
          </Link>
          <button type="button" className="icon-btn collapse-btn" aria-label={collapsed ? t('Expand menu') : t('Collapse menu')} title={collapsed ? t('Expand menu') : t('Collapse menu')} onClick={() => setCollapsed()}>
            <NavIcon name="collapse" />
          </button>
          <button type="button" className="btn menu-toggle" aria-expanded={open} aria-controls="sidebar-nav" onClick={() => setOpen(!open)}>{t('Menu')}</button>
        </div>
        <nav id="sidebar-nav" className="nav nav-main" aria-label={t('Main')} onClick={() => setOpen(false)}>
          {menuFor(user).map(([heading, items]) => (
            <Fragment key={heading || 'main'}>
              {heading && <div className="nav-label" aria-hidden="true">{t(heading)}</div>}
              {items.map(([key, text]) => {
                const item = NAV[key];
                const waiting = item.badge ? queue[item.badge] : 0;
                return (
                  // "Assets" is not also highlighted while "Register asset" (/assets/new) is open
                  <NavLink key={key} to={item.to} end={item.end || (key === 'assets' && location.pathname === '/assets/new')}>
                    <NavIcon name={item.icon} /><span className="nav-text">{t(text || item.text)}</span>
                    {waiting > 0 && <span className="count" aria-label={t('{n} waiting for you', { n: waiting })}>{waiting > 99 ? '99+' : waiting}</span>}
                  </NavLink>
                );
              })}
            </Fragment>
          ))}
        </nav>
        <nav className="nav side-foot" aria-label={t('Account')} onClick={() => setOpen(false)}>
          <NavLink to="/account"><NavIcon name="account" /><span className="nav-text">{t('My account')}</span></NavLink>
          <button type="button" className="nav-button nav-signout" onClick={() => logout()}><NavIcon name="logout" /><span className="nav-text">{t('Sign out')}</span></button>
        </nav>
      </aside>
      <div className="content">
        <header className="topbar">
          <Link to="/account" className="who" title={t('My account')}>
            <Avatar user={user} />
            <span className="who-text" title={[label(user.role), areaOf(user, lookups)].filter(Boolean).join(' · ')}>
              <strong>{user.full_name}</strong>
              <small>{label(user.role)}{areaOf(user, lookups) && <span className="who-area"> · {areaOf(user, lookups)}</span>}</small>
            </span>
          </Link>
          <div className="topbar-tools">
            <form className="top-search" role="search" onSubmit={search}>
              <NavIcon name="search" />
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('Global search')} aria-label={t('Global search')} />
            </form>
            <LanguageSwitcher />
            <NavLink to="/notifications" className="round-btn" aria-label={unread > 0 ? `${t('Notifications')}: ${t('{n} unread', { n: unread })}` : t('Notifications')} title={t('Notifications')}>
              <NavIcon name="notifications" />
              {unread > 0 && <span className="dot-count" aria-hidden="true">{unread > 99 ? '99+' : unread}</span>}
            </NavLink>
            <NavLink to="/account" className="round-btn" aria-label={t('My account')} title={t('My account')}><NavIcon name="settings" /></NavLink>
          </div>
        </header>
        <main id="main" className="main" tabIndex={-1}>
          <OutboxBanner />
          <PhotoReminder user={user} />
          {lookups.error && <Alert>{lookups.error}</Alert>}
          {!lookups.ready ? <Loading /> : (
            <Suspense fallback={<Loading />}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/assets" element={<AssetList />} />
              <Route path="/assets/new" element={can.create(user) ? <AssetForm /> : <Navigate to="/assets" replace />} />
              <Route path="/assets/:id" element={<AssetDetail />} />
              <Route path="/assets/:id/edit" element={<AssetForm />} />
              <Route path="/map" element={<MapPage />} />
              <Route path="/scan" element={<Scan />} />
              <Route path="/scan/:code" element={<Scan />} />
              <Route path="/labels" element={<Labels />} />
              <Route path="/approvals" element={can.review(user) || can.approve(user) || can.decide(user) || can.request(user) || can.oversee(user) ? <Approvals /> : <Navigate to="/" replace />} />
              <Route path="/reservations" element={can.reserve(user) ? <Reservations /> : <Navigate to="/" replace />} />
              <Route path="/verification" element={can.verify(user) || can.oversee(user) ? <Verification /> : <Navigate to="/" replace />} />
              <Route path="/verification/:id" element={can.verify(user) || can.oversee(user) ? <VerificationDetail /> : <Navigate to="/" replace />} />
              <Route path="/follow-ups" element={<FollowUps />} />
              <Route path="/monthly-reports" element={can.monthly(user) ? <MonthlyReports /> : <Navigate to="/" replace />} />
              <Route path="/monthly-reports/report/:id" element={can.monthly(user) ? <MonthlyReportPage /> : <Navigate to="/" replace />} />
              <Route path="/monthly-reports/prepare/:periodKey" element={can.monthly(user) ? <PrepareReportPage /> : <Navigate to="/" replace />} />
              <Route path="/notifications" element={<Notifications onChange={refreshUnread} />} />
              <Route path="/import" element={can.importAssets(user) ? <ImportPage /> : <Navigate to="/" replace />} />
              <Route path="/analytics" element={can.analytics(user) ? <Analytics /> : <Navigate to="/" replace />} />
              <Route path="/performance" element={can.analytics(user) ? <Performance /> : <Navigate to="/" replace />} />
              <Route path="/audit" element={can.viewAudit(user) ? <Audit /> : <Navigate to="/" replace />} />
              <Route path="/master" element={can.manageMaster(user) ? <MasterData /> : <Navigate to="/" replace />} />
              <Route path="/users" element={can.openUsers(user) ? <Users /> : <Navigate to="/" replace />} />
              <Route path="/users/:id/history" element={can.openUsers(user) ? <UserHistory /> : <Navigate to="/" replace />} />
              <Route path="/system" element={can.manageSystem(user) ? <System /> : <Navigate to="/" replace />} />
              <Route path="/account" element={<Account />} />
              <Route path="/login" element={<Navigate to="/" replace />} />
              <Route path="*" element={<p>{t('Page not found.')}{' '}<Link to="/">{t('Go to the dashboard')}</Link>.</p>} />
            </Routes>
            </Suspense>
          )}
        </main>
        <footer className="footer">{t('Jimma City Administration · Smart Asset Management System · working draft')}</footer>
      </div>
    </div>
  );
}

/** Not signed in: the public front page at the root address, the sign-in form everywhere else (deep links ask to sign in). */
function Public() {
  const location = useLocation();
  if (location.pathname !== '/') return <Login />;
  return <Suspense fallback={<div className="login"><Loading /></div>}><Landing /></Suspense>;
}

export default function App() {
  const { user, loading } = useAuth();
  if (loading) return <div className="login"><Loading text="Signing you in…" /></div>;
  if (!user) return <Public />;
  if (user.must_change_password) return <ChoosePassword />;
  return (
    <LookupProvider>
      <Shell />
    </LookupProvider>
  );
}
