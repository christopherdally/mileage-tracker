import { useCallback, useEffect, useState } from 'react';
import { api, downloadWithAuth, OfflineError } from '../api.js';
import { Field, Sheet, useToast } from '../ui.jsx';
import { fmtDate, plural } from '../util.js';

const errText = (e) => (e instanceof OfflineError ? 'Administration needs an internet connection' : e.message);

function useLoad(path) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(async () => {
    try { setData(await api('GET', path)); setError(null); } catch (e) { setError(errText(e)); }
  }, [path]);
  useEffect(() => { load(); }, [load]);
  return { data, error, reload: load };
}

// ───────────────────────── Users ─────────────────────────

function UserForm({ user, me, onDone }) {
  const toast = useToast();
  const [f, setF] = useState({
    username: '', password: '', displayName: user?.displayName || '', vehicle: user?.vehicle || '',
    isAdmin: user?.isAdmin || false, isActive: user ? user.isActive : true, mustChangePassword: true,
  });
  const [error, setError] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const isMe = user && user.id === me.id;

  async function submit(e) {
    e.preventDefault();
    setError(null);
    try {
      if (user) {
        const body = { displayName: f.displayName, vehicle: f.vehicle, isAdmin: f.isAdmin, isActive: f.isActive };
        if (f.password) body.password = f.password;
        await api('PATCH', `/users/${user.id}`, body);
        toast(f.password ? 'Saved. Their password is reset and they are signed out.' : 'User saved');
      } else {
        await api('POST', '/users', f);
        toast(`Account created for ${f.username.toLowerCase()}`);
      }
      onDone(true);
    } catch (err) { setError(errText(err)); }
  }

  async function remove() {
    if (!confirm(`Delete ${user.username} and all of their journeys and rates? This can't be undone, except by restoring a backup.`)) return;
    try {
      await api('DELETE', `/users/${user.id}`);
      toast('User deleted');
      onDone(true);
    } catch (err) { setError(errText(err)); }
  }

  return (
    <form onSubmit={submit} noValidate>
      {!user && (
        <Field label="Email or username" hint="They sign in with this">
          {(id) => <input id={id} type="email" value={f.username} onChange={set('username')} autoCapitalize="none" autoComplete="off" spellCheck={false} />}
        </Field>
      )}
      <Field label="Name">{(id) => <input id={id} value={f.displayName} onChange={set('displayName')} />}</Field>
      <Field label="Vehicle">{(id) => <input id={id} value={f.vehicle} onChange={set('vehicle')} />}</Field>
      <Field label={user ? 'New password' : 'Password'} hint={user ? 'Leave empty to keep their current password. They will be asked to change it.' : 'At least 8 characters. Share it with them securely.'}>
        {(id) => <input id={id} type="text" autoComplete="off" value={f.password} onChange={set('password')} />}
      </Field>
      {!user && (
        <label className="check"><input type="checkbox" checked={f.mustChangePassword} onChange={set('mustChangePassword')} /><span>Ask them to choose their own password when they first sign in</span></label>
      )}
      <label className="check"><input type="checkbox" checked={f.isAdmin} onChange={set('isAdmin')} /><span>Administrator</span></label>
      {user && !isMe && (
        <label className="check"><input type="checkbox" checked={f.isActive} onChange={set('isActive')} /><span>Can sign in</span></label>
      )}
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="btn-row">
        {user && !isMe && <button type="button" className="btn btn-danger-quiet" onClick={remove}>Delete user</button>}
        <button type="submit" className="btn btn-primary">{user ? 'Save' : 'Create account'}</button>
      </div>
    </form>
  );
}

export function UsersScreen({ me, back }) {
  const { data, error, reload } = useLoad('/users');
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(false);
  const done = (changed) => { setEditing(null); setAdding(false); if (changed) reload(); };

  return (
    <div className="screen">
      <header className="screen-head">
        <button type="button" className="back" onClick={back}>Settings</button>
        <h1>Users</h1>
        <button type="button" className="btn btn-primary btn-small" onClick={() => setAdding(true)}>Add user</button>
      </header>
      <p className="lede">There's no public sign-up. Create an account here and give the person their username and password.</p>
      {error && <p className="notice notice-warn">{error}</p>}
      {!data && !error && <p className="muted">Loading…</p>}
      {data && (
        <ul className="rates">
          {data.users.map((u) => (
            <li key={u.id}>
              <button type="button" className="rate-row" onClick={() => setEditing(u)}>
                <span className="rate-info">
                  <span className="rate-label">
                    {u.displayName || u.username}
                    {u.isAdmin && <em className="tag">Admin</em>}
                    {!u.isActive && <em className="tag tag-off">Can't sign in</em>}
                  </span>
                  <span className="muted">{u.username}, {plural(u.tripCount, 'journey')}{u.lastTrip ? `, last ${fmtDate(u.lastTrip)}` : ''}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <Sheet open={adding} onClose={() => setAdding(false)} title="Add a user">
        {adding && <UserForm me={me} onDone={done} />}
      </Sheet>
      <Sheet open={!!editing} onClose={() => setEditing(null)} title={editing ? `Edit ${editing.username}` : ''}>
        {editing && <UserForm user={editing} me={me} onDone={done} />}
      </Sheet>
    </div>
  );
}

// ───────────────────────── Backups ─────────────────────────

const size = (b) => (b === null ? '' : b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1048576).toFixed(1)} MB`);
const when = (iso) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const targetName = { local: 'Server folder', s3: 'S3 bucket' };

export function BackupsScreen({ back }) {
  const { data, error, reload } = useLoad('/backups');
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(null);
  const [confirmText, setConfirmText] = useState('');

  async function backupNow(targets) {
    setBusy(true);
    try {
      const { results } = await api('POST', '/backups', { targets });
      const failed = results.filter((r) => r.status !== 'ok');
      toast(failed.length ? `Backup failed: ${failed.map((f) => f.error).join('; ')}` : 'Backup complete', failed.length ? 'error' : 'ok');
      reload();
    } catch (e) { toast(errText(e), 'error'); } finally { setBusy(false); }
  }

  async function restore() {
    setBusy(true);
    try {
      await api('POST', `/backups/${restoring.id}/restore`, { confirm: confirmText });
      setRestoring(null);
      setConfirmText('');
      toast('Restored. Every device will reload its data on the next sync.');
      reload();
    } catch (e) { toast(errText(e), 'error'); } finally { setBusy(false); }
  }

  const cfg = data?.config;
  return (
    <div className="screen">
      <header className="screen-head">
        <button type="button" className="back" onClick={back}>Settings</button>
        <h1>Backups</h1>
      </header>
      {error && <p className="notice notice-warn">{error}</p>}
      {cfg && (
        <section className="panel">
          <p>
            Automatic backups: <strong>{cfg.schedule}</strong>, to {cfg.defaultTargets.map((t) => targetName[t]).join(' and ')}.
            The newest {cfg.keep} are kept in each place.
          </p>
          <p className="muted small">Server folder: {cfg.localDir}. S3: {cfg.s3 ? 'configured' : 'not configured'}.</p>
          <div className="btn-row wrap">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => backupNow(cfg.defaultTargets)}>
              {busy ? 'Working…' : 'Back up now'}
            </button>
            {cfg.s3 && cfg.defaultTargets.length === 1 && (
              <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => backupNow(['local', 's3'])}>Back up to both</button>
            )}
          </div>
        </section>
      )}
      {data && (
        <section className="list-section">
          <div className="list-head"><h2>History</h2></div>
          {data.backups.length === 0 && <p className="muted pad">No backups yet.</p>}
          <ul className="backups">
            {data.backups.map((b) => (
              <li key={b.id} className={b.status === 'failed' ? 'is-failed' : ''}>
                <div>
                  <p className="b-when">{when(b.createdAt)}</p>
                  <p className="muted small">
                    {b.status === 'restored' ? `Restored from ${b.filename}` : `${targetName[b.target] || b.target}${b.sizeBytes ? `, ${size(b.sizeBytes)}` : ''}, by ${b.createdBy}`}
                  </p>
                  {b.status === 'failed' && <p className="warn-text small">{b.error}</p>}
                </div>
                {b.status === 'ok' && (
                  <div className="b-actions">
                    <button type="button" className="btn btn-quiet btn-small"
                      onClick={() => downloadWithAuth(`/backups/${b.id}/download`, b.filename).catch((e) => toast(errText(e), 'error'))}>Download</button>
                    <button type="button" className="btn btn-danger-quiet btn-small" onClick={() => setRestoring(b)}>Restore</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      <Sheet open={!!restoring} onClose={() => setRestoring(null)} title="Restore this backup?">
        {restoring && (
          <div>
            <p>All users' journeys, rates and accounts will go back to how they were at <strong>{when(restoring.createdAt)}</strong>. A backup of the current data is taken first, so you can undo this.</p>
            <p>Changes still waiting on people's phones will sync up afterwards.</p>
            <Field label="Type RESTORE to confirm">
              {(id) => <input id={id} value={confirmText} autoCapitalize="characters" onChange={(e) => setConfirmText(e.target.value)} />}
            </Field>
            <div className="btn-row">
              <button type="button" className="btn btn-danger" disabled={busy || confirmText !== 'RESTORE'} onClick={restore}>
                {busy ? 'Restoring…' : 'Restore backup'}
              </button>
            </div>
          </div>
        )}
      </Sheet>
    </div>
  );
}
