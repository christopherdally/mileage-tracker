import { useEffect, useState } from 'react';
import { useStore } from '../store.js';
import { sync, syncStatus, onSyncStatus } from '../sync.js';
import { api, session, OfflineError } from '../api.js';
import { Field, useToast } from '../ui.jsx';

export function useSyncStatus() {
  const [s, setS] = useState(syncStatus());
  useEffect(() => onSyncStatus(setS), []);
  return s;
}

const ago = (iso) => {
  if (!iso) return 'never';
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};

export function MoreScreen({ user, onUser, onSignOut, go }) {
  const { pending, meta } = useStore();
  const status = useSyncStatus();
  const toast = useToast();
  const [displayName, setDisplayName] = useState(user.displayName || '');
  const [vehicle, setVehicle] = useState(user.vehicle || '');
  const [pw, setPw] = useState({ current: '', next: '' });
  const [pwError, setPwError] = useState(null);

  async function saveProfile(e) {
    e.preventDefault();
    try {
      const { user: u } = await api('PUT', '/auth/me', { displayName, vehicle });
      onUser(u);
      toast('Details saved');
    } catch (err) {
      toast(err instanceof OfflineError ? 'Connect to the internet to change your details' : err.message, 'error');
    }
  }

  async function changePassword(e) {
    e.preventDefault();
    setPwError(null);
    if (pw.next.length < 8) return setPwError('Use at least 8 characters');
    try {
      const { token, user: u } = await api('POST', '/auth/password', { currentPassword: pw.current, newPassword: pw.next });
      session.save(token, u);
      setPw({ current: '', next: '' });
      toast('Password changed. Other devices have been signed out.');
    } catch (err) {
      setPwError(err instanceof OfflineError ? 'Connect to the internet to change your password' : err.message);
    }
  }

  const statusText =
    status.state === 'syncing' ? 'Syncing…'
    : status.state === 'offline' ? `Offline. ${pending ? `${pending} changes saved on this phone.` : 'Everything is saved on this phone.'}`
    : status.state === 'error' ? `Sync problem: ${status.error}`
    : pending ? `${pending} changes waiting to sync` : 'Everything is synced';

  return (
    <div className="screen">
      <header className="screen-head"><h1>Settings</h1></header>

      <section className="panel"><h2 className="panel-title">Report archive</h2><p className="muted small">Upload, download and manage previous monthly report PDFs in S3.</p><button type="button" className="btn btn-quiet" onClick={() => go("report-archive")}>Manage archived reports</button></section>
      <section className="panel">
        <h2 className="panel-title">Company end dates</h2>
        <p className="muted small">Enter fuel card and mileage end dates for several months ahead.</p>
        <button type="button" className="btn btn-quiet" onClick={() => go("company-dates")}>Manage end dates</button>
      </section>

      <section className="panel">
        <h2 className="panel-title">Sync</h2>
        <p className={status.state === 'error' ? 'warn-text' : ''}>{statusText}</p>
        <p className="muted small">Last synced {ago(meta.lastSync)}</p>
        <button type="button" className="btn btn-quiet" onClick={() => sync()} disabled={status.state === 'syncing'}>Sync now</button>
      </section>

      <section className="panel">
        <h2 className="panel-title">Your details</h2>
        <p className="muted small">Signed in as {user.username}. These appear on your claim PDF.</p>
        <form onSubmit={saveProfile}>
          <Field label="Name">{(id) => <input id={id} value={displayName} maxLength={100} onChange={(e) => setDisplayName(e.target.value)} />}</Field>
          <Field label="Vehicle" hint="Make, model and registration">
            {(id) => <input id={id} value={vehicle} maxLength={100} onChange={(e) => setVehicle(e.target.value)} placeholder="Ford Focus AB12 CDE" />}
          </Field>
          <button type="submit" className="btn btn-quiet">Save details</button>
        </form>
      </section>

      <section className="panel">
        <h2 className="panel-title">Password</h2>
        <form onSubmit={changePassword}>
          <Field label="Current password">{(id) => <input id={id} type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />}</Field>
          <Field label="New password" error={pwError} hint="At least 8 characters">
            {(id) => <input id={id} type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />}
          </Field>
          <button type="submit" className="btn btn-quiet">Change password</button>
        </form>
      </section>

      {user.isAdmin && (
        <section className="panel">
          <h2 className="panel-title">Administration</h2>
          <nav className="link-list">
            <button type="button" onClick={() => go('users')}><span>Users</span><span className="muted">Add people, reset passwords</span></button>
            <button type="button" onClick={() => go('backups')}><span>Backups</span><span className="muted">Back up and restore the database</span></button>
          </nav>
        </section>
      )}

      <button type="button" className="btn btn-danger-quiet btn-block" onClick={() => onSignOut(pending)}>Sign out</button>

      <p className="muted small about-version">Mileage Tracker v{__APP_VERSION__}</p>
    </div>
  );
}


