import { useEffect, useState } from 'react';
import { CompanyDatesScreen } from './screens/CompanyDates.jsx';
import { CutoffReminders } from './PeriodSettings.jsx';
import { api, session, onSignedOut, OfflineError } from './api.js';
import { store, useStore } from './store.js';
import { startAutoSync, stopAutoSync, sync } from './sync.js';
import { Field, NavIcon, ToastProvider } from './ui.jsx';
import { LogScreen } from './screens/Log.jsx';
import { TripsScreen } from './screens/Trips.jsx';
import { RatesScreen } from './screens/Rates.jsx';
import { FuelScreen } from './screens/Fuel.jsx';
import { ReportScreen } from './screens/Report.jsx';
import { MoreScreen, useSyncStatus } from './screens/More.jsx';
import { UsersScreen, BackupsScreen } from './screens/Admin.jsx';

const TABS = [
  { id: 'log', label: 'Log', icon: 'log' },
  { id: 'trips', label: 'Journeys', icon: 'trips' },
  { id: 'fuel', label: 'Fuel', icon: 'fuel' },
  { id: 'rates', label: 'Rates', icon: 'rates' },
  { id: 'report', label: 'Report', icon: 'report' },
  { id: 'more', label: 'Settings', icon: 'more' },
];
const SUBPAGES = { users: 'more', backups: 'more', 'company-dates': 'more' };

function useRoute() {
  const read = () => (location.hash.slice(1) || 'log');
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => { setRoute(read()); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return [route, (r) => { location.hash = r; }];
}

export function App() {
  const [user, setUser] = useState(session.token ? session.user : null);
  const [ready, setReady] = useState(false);
  const [expired, setExpired] = useState(false);

  // Open this user's on-device database and start syncing.
  useEffect(() => {
    if (!user) return undefined;
    let cancelled = false;
    (async () => {
      await store.open(user.id);
      if (cancelled) return;
      setReady(true);
      startAutoSync();
      // Refresh profile in the background; offline is fine.
      api('GET', '/auth/me').then(({ user: u }) => { session.save(null, u); setUser(u); }).catch(() => {});
    })();
    return () => { cancelled = true; stopAutoSync(); };
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => onSignedOut(() => setExpired(true)), []);

  async function signOut(pending) {
    if (pending && !confirm(`${pending} changes haven't synced yet. They stay on this phone and will sync next time you sign in. Sign out?`)) return;
    stopAutoSync();
    store.close();
    session.clear();
    setReady(false);
    setUser(null);
    location.hash = '';
  }

  if (!user || expired) {
    return (
      <ToastProvider>
        <Login expiredFor={expired ? user : null} onLogin={(u) => {
          const sameUser = user && u.id === user.id;
          setExpired(false);
          setUser(u);
          if (sameUser) sync();
        }} />
      </ToastProvider>
    );
  }
  if (user.mustChangePassword) {
    return (
      <ToastProvider>
        <FirstPassword user={user} onDone={(u) => { session.save(null, u); setUser(u); }} onSignOut={() => signOut(0)} />
      </ToastProvider>
    );
  }
  if (!ready) return <div className="boot" aria-busy="true" />;
  return (
    <ToastProvider>
      <Shell user={user} setUser={(u) => { session.save(null, u); setUser(u); }} signOut={signOut} />
    </ToastProvider>
  );
}

function Shell({ user, setUser, signOut }) {
  const [rawRoute, go] = useRoute();
  const route = rawRoute.split("?")[0];
  const { meta, pending } = useStore();
  const status = useSyncStatus();
  const claimStartDay = meta.claimStartDay || 1;
  const tab = SUBPAGES[route] || (TABS.some((t) => t.id === route) ? route : 'log');
  const page = route === 'company-dates' || (SUBPAGES[route] && user.isAdmin) ? route : tab;

  return (
    <div className="app">
      <SyncBar status={status} pending={pending} />
      <main id="main">
        <CutoffReminders />
        {page === 'company-dates' && <CompanyDatesScreen key={rawRoute} back={() => { const source = new URLSearchParams(rawRoute.split('?')[1] || '').get('back'); go(['report', 'fuel'].includes(source) ? source : 'more'); }} />}
        {page === 'log' && <LogScreen claimStartDay={claimStartDay} />}
        {page === 'trips' && <TripsScreen />}
        {page === 'fuel' && <FuelScreen claimStartDay={claimStartDay} />}
        {page === 'rates' && <RatesScreen />}
        {page === 'report' && <ReportScreen claimStartDay={claimStartDay} />}
        {page === 'more' && <MoreScreen user={user} onUser={setUser} onSignOut={signOut} go={go} />}
        {page === 'users' && <UsersScreen me={user} back={() => go('more')} />}
        {page === 'backups' && <BackupsScreen back={() => go('more')} />}
      </main>
      <nav className="tabbar" aria-label="Main">
        {TABS.map((t) => (
          <a key={t.id} href={`#${t.id}`} className={tab === t.id ? 'on' : ''} aria-current={tab === t.id ? 'page' : undefined}>
            <NavIcon name={t.icon} />
            <span>{t.label}</span>
          </a>
        ))}
      </nav>
    </div>
  );
}

function SyncBar({ status, pending }) {
  let text = null;
  let kind = '';
  if (status.state === 'offline') { text = pending ? `Offline. ${pending} saved on this phone.` : 'Offline. Changes will save on this phone.'; kind = 'offline'; }
  else if (status.state === 'error') { text = `Sync problem: ${status.error}`; kind = 'error'; }
  else if (pending && status.state !== 'syncing') { text = `${pending} waiting to sync`; kind = 'pending'; }
  if (!text) return null;
  return <div className={`syncbar syncbar-${kind}`} role="status">{text}</div>;
}

function Login({ onLogin, expiredFor }) {
  const [username, setUsername] = useState(expiredFor?.username || '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { token, user } = await api('POST', '/auth/login', { username, password });
      session.save(token, user);
      onLogin(user);
    } catch (err) {
      setError(err instanceof OfflineError ? "You're offline. Connect to the internet to sign in." : err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <div className="login-mark" aria-hidden="true">
        <span className="wheel"><span className="wheel-strip"><span>0</span></span></span>
        <span className="wheel"><span className="wheel-strip"><span>0</span></span></span>
        <span className="wheel"><span className="wheel-strip"><span>4</span></span></span>
        <span className="wheel"><span className="wheel-strip"><span>5</span></span></span>
        <span className="wheel wheel-tenths"><span className="wheel-strip"><span>0</span></span></span>
      </div>
      <h1>Mileage</h1>
      <p className="muted">Sign in with the details your administrator gave you.</p>
      {expiredFor && <p className="notice">Your session ended. Sign in again to keep syncing. Nothing on this phone has been lost.</p>}
      <form onSubmit={submit} noValidate>
        <Field label="Email or username">
          {(id) => <input id={id} type="email" value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" autoComplete="username" autoCorrect="off" spellCheck={false} required />}
        </Field>
        <Field label="Password" error={error}>
          {(id) => <input id={id} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />}
        </Field>
        <button type="submit" className="btn btn-primary btn-block" disabled={busy || !username || !password}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}

/** Shown after signing in with a password someone else set: choose your own before going further. */
function FirstPassword({ user, onDone, onSignOut }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    if (next.length < 8) return setError('Use at least 8 characters');
    if (next !== again) return setError("The two new passwords don't match");
    setBusy(true);
    try {
      const { token, user: u } = await api('POST', '/auth/password', { currentPassword: current, newPassword: next });
      session.save(token, u);
      onDone(u);
    } catch (err) {
      setError(err instanceof OfflineError ? 'Connect to the internet to set your password' : err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <h1>Choose your password</h1>
      <p className="muted">You're signed in as {user.username}. Replace the password you were given with one only you know.</p>
      <form onSubmit={submit} noValidate>
        <Field label="Password you were given">
          {(id) => <input id={id} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />}
        </Field>
        <Field label="New password" hint="At least 8 characters">
          {(id) => <input id={id} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />}
        </Field>
        <Field label="New password again" error={error}>
          {(id) => <input id={id} type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />}
        </Field>
        <button type="submit" className="btn btn-primary btn-block" disabled={busy || !current || !next || !again}>
          {busy ? 'Saving…' : 'Save password'}
        </button>
        <button type="button" className="btn btn-quiet btn-block mt" onClick={onSignOut}>Sign out</button>
      </form>
    </main>
  );
}

