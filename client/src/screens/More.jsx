import { useEffect, useState } from 'react';
import { store, useStore } from '../store.js';
import { sync, syncSoon, syncStatus, onSyncStatus } from '../sync.js';
import { api, session, OfflineError } from '../api.js';
import { Field, Sheet, useToast } from '../ui.jsx';
import { uuid } from '../util.js';
import { TwoStepPanel } from '../TwoStep.jsx';

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

/** Add, rename or remove one vehicle. `vehicle` is undefined when adding. */
function VehicleForm({ vehicle, onDone }) {
  const { liveVehicles, liveTrips, liveFuel } = useStore();
  const toast = useToast();
  const [name, setName] = useState(vehicle?.name || '');
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    const clean = name.trim();
    if (!clean) return setError('Enter the make, model and registration');
    if (liveVehicles.some((v) => v.id !== vehicle?.id && v.name.toLowerCase() === clean.toLowerCase())) {
      return setError('You already have a vehicle with that name');
    }
    await store.save('vehicles', { id: vehicle?.id || uuid(), name: clean, deleted: false });
    syncSoon();
    toast(vehicle ? 'Vehicle saved' : `Added ${clean}`);
    onDone();
  }

  async function remove() {
    const used = liveTrips.filter((t) => t.vehicleId === vehicle.id).length + liveFuel.filter((f) => f.vehicleId === vehicle.id).length;
    const note = used ? ' Journeys and fuel already logged with it are kept.' : '';
    if (!confirm(`Remove ${vehicle.name}? You won't be able to choose it for new entries.${note}`)) return;
    await store.softDelete('vehicles', vehicle.id);
    syncSoon();
    toast('Vehicle removed');
    onDone();
  }

  return (
    <form onSubmit={submit} noValidate>
      <Field label="Vehicle" hint="Make, model and registration" error={error}>
        {(id) => <input id={id} value={name} maxLength={100} onChange={(e) => setName(e.target.value)} placeholder="Ford Focus AB12 CDE" autoComplete="off" />}
      </Field>
      <div className="btn-row">
        {vehicle && <button type="button" className="btn btn-danger-quiet" onClick={remove}>Remove</button>}
        <button type="submit" className="btn btn-primary">{vehicle ? 'Save changes' : 'Add vehicle'}</button>
      </div>
    </form>
  );
}

function VehiclesPanel() {
  const { liveVehicles } = useStore();
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(false);
  return (
    <section className="panel">
      <h2 className="panel-title">Vehicles</h2>
      <p className="muted small">
        {liveVehicles.length > 1
          ? 'Choose the vehicle on each journey and fuel entry. Reports can cover all of them or one.'
          : 'The vehicle you drive for work, shown on your claim PDF. Add another if you use more than one.'}
      </p>
      {liveVehicles.length > 0 && (
        <nav className="link-list" aria-label="Your vehicles">
          {liveVehicles.map((v) => (
            <button type="button" key={v.id} onClick={() => setEditing(v)}>
              <span>{v.name}</span>
              <span className="muted">{v.dirty ? 'Not synced' : 'Edit'}</span>
            </button>
          ))}
        </nav>
      )}
      <button type="button" className="btn btn-quiet" onClick={() => setAdding(true)}>Add vehicle</button>
      <Sheet open={adding} onClose={() => setAdding(false)} title="Add a vehicle">
        {adding && <VehicleForm onDone={() => setAdding(false)} />}
      </Sheet>
      <Sheet open={!!editing} onClose={() => setEditing(null)} title="Edit vehicle">
        {editing && <VehicleForm vehicle={editing} onDone={() => setEditing(null)} />}
      </Sheet>
    </section>
  );
}

export function MoreScreen({ user, onUser, onSignOut, go }) {
  const { pending, meta } = useStore();
  const status = useSyncStatus();
  const toast = useToast();
  const [displayName, setDisplayName] = useState(user.displayName || '');
  const [pw, setPw] = useState({ current: '', next: '' });
  const [pwError, setPwError] = useState(null);

  async function saveProfile(e) {
    e.preventDefault();
    try {
      const { user: u } = await api('PUT', '/auth/me', { displayName });
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
        <p className="muted small">Signed in as {user.username}. Your name appears on your claim PDF.</p>
        <form onSubmit={saveProfile}>
          <Field label="Name">{(id) => <input id={id} value={displayName} maxLength={100} onChange={(e) => setDisplayName(e.target.value)} />}</Field>
          <button type="submit" className="btn btn-quiet">Save details</button>
        </form>
      </section>

      <VehiclesPanel />

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

      <TwoStepPanel user={user} onUser={onUser} />

      {user.isAdmin && (
        <section className="panel">
          <h2 className="panel-title">Administration</h2>
          <nav className="link-list">
            <button type="button" onClick={() => go('users')}><span>Users</span><span className="muted">Add people, reset passwords</span></button>
            <button type="button" onClick={() => go('backups')}><span>Backups</span><span className="muted">Back up and restore the database</span></button>
            <button type="button" onClick={() => go('activity')}><span>Activity log</span><span className="muted">Who changed accounts and backups, and when</span></button>
          </nav>
        </section>
      )}

      <button type="button" className="btn btn-danger-quiet btn-block" onClick={() => onSignOut(pending)}>Sign out</button>

      <p className="muted small about-version">
        Mileage Tracker v{__APP_VERSION__}
        <br />
        © {new Date().getFullYear()} Christopher Dally /{' '}
        <a href="https://lifespansoftware.com/" target="_blank" rel="noopener">LifespanSoftware</a>
        {' · '}
        <a href="https://github.com/christopherdally/mileage-tracker" target="_blank" rel="noopener">GitHub</a>
      </p>
    </div>
  );
}


