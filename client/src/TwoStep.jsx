// Settings panel for two-step sign-in (a code from an authenticator app as well as the password).
import { useEffect, useState } from 'react';
import { api, saveBlob, OfflineError } from './api.js';
import { Field, Sheet, useToast } from './ui.jsx';

const errText = (e) => (e instanceof OfflineError ? 'Connect to the internet to change two-step sign-in' : e.message);

/** QR code drawn as SVG. Always dark on white so a phone camera can read it in dark mode too. */
function QrCode({ text }) {
  const [qr, setQr] = useState(null);
  useEffect(() => {
    let live = true;
    import('qrcode-generator').then(({ default: qrcode }) => {
      const code = qrcode(0, 'M');
      code.addData(text);
      code.make();
      const n = code.getModuleCount();
      let d = '';
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (code.isDark(y, x)) d += `M${x + 4},${y + 4}h1v1h-1z`;
      if (live) setQr({ size: n + 8, d });
    });
    return () => { live = false; };
  }, [text]);
  if (!qr) return <div className="qr" aria-hidden="true" />;
  return (
    <svg className="qr" viewBox={`0 0 ${qr.size} ${qr.size}`} role="img" aria-label="QR code for your authenticator app" shapeRendering="crispEdges">
      <rect width={qr.size} height={qr.size} fill="#fff" />
      <path d={qr.d} fill="#000" />
    </svg>
  );
}

function Setup({ user, onUser, onDone }) {
  const toast = useToast();
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [recovery, setRecovery] = useState(null);

  useEffect(() => {
    api('POST', '/auth/2fa/setup', {}).then(setSetup, (e) => setError(errText(e)));
  }, []);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await api('POST', '/auth/2fa/enable', { code });
      onUser(res.user);
      setRecovery(res.recoveryCodes);
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  if (recovery) {
    const text = `Mileage Tracker recovery codes for ${user.username}\nEach code signs you in once if you can't use your authenticator app.\n\n${recovery.join('\n')}\n`;
    return (
      <>
        <p className="notice">Two-step sign-in is on. Keep these recovery codes somewhere safe. Each one signs you in once if you lose your phone. They won't be shown again.</p>
        <ul className="codes num">{recovery.map((c) => <li key={c}>{c}</li>)}</ul>
        <div className="btn-row wrap">
          <button type="button" className="btn btn-quiet btn-small" onClick={() => navigator.clipboard.writeText(text).then(() => toast('Codes copied'), () => toast("Couldn't copy. Use Download instead.", 'error'))}>Copy</button>
          <button type="button" className="btn btn-quiet btn-small" onClick={() => saveBlob(new Blob([text], { type: 'text/plain' }), 'mileage-tracker-recovery-codes.txt')}>Download</button>
        </div>
        <div className="btn-row"><button type="button" className="btn btn-primary" onClick={onDone}>I've saved them</button></div>
      </>
    );
  }
  if (!setup) return error ? <p className="field-error" role="alert">{error}</p> : <p className="muted">Getting ready…</p>;
  return (
    <form onSubmit={submit} noValidate>
      <p>1. Add this account to an authenticator app such as Google Authenticator, Microsoft Authenticator or 1Password.</p>
      <QrCode text={setup.uri} />
      <p className="muted small">On this phone? <a href={setup.uri}>Open your authenticator app</a>, or type in this key:</p>
      <p className="secret num" data-testid="totp-secret">{setup.secret.match(/.{1,4}/g).join(' ')}</p>
      <p className="mt">2. Enter the 6-digit code the app shows.</p>
      <Field label="Code from the app" error={error}>
        {(id) => <input id={id} inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" />}
      </Field>
      <div className="btn-row">
        <button type="submit" className="btn btn-primary" disabled={busy || code.replace(/\s/g, '').length < 6}>{busy ? 'Checking…' : 'Turn on'}</button>
      </div>
    </form>
  );
}

function TurnOff({ onUser, onDone }) {
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    try {
      const { user } = await api('POST', '/auth/2fa/disable', { password });
      onUser(user);
      toast('Two-step sign-in is off');
      onDone();
    } catch (err) {
      setError(errText(err));
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <p className="muted">Your password alone will sign you in. Your recovery codes stop working.</p>
      <Field label="Your password" error={error}>
        {(id) => <input id={id} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
      </Field>
      <div className="btn-row"><button type="submit" className="btn btn-primary" disabled={!password}>Turn off</button></div>
    </form>
  );
}

export function TwoStepPanel({ user, onUser }) {
  const [open, setOpen] = useState(null);
  return (
    <section className="panel">
      <h2 className="panel-title">Two-step sign-in</h2>
      {user.twoFactor ? (
        <>
          <p>On. Signing in needs your password and a code from your authenticator app.</p>
          <button type="button" className="btn btn-quiet" onClick={() => setOpen('off')}>Turn off</button>
        </>
      ) : (
        <>
          <p className="muted small">Ask for a code from an authenticator app as well as your password, so a stolen password isn't enough to sign in.</p>
          <button type="button" className="btn btn-quiet" onClick={() => setOpen('setup')}>Set up two-step sign-in</button>
        </>
      )}
      <Sheet open={open === 'setup'} onClose={() => setOpen(null)} title="Set up two-step sign-in">
        {open === 'setup' && <Setup user={user} onUser={onUser} onDone={() => setOpen(null)} />}
      </Sheet>
      <Sheet open={open === 'off'} onClose={() => setOpen(null)} title="Turn off two-step sign-in">
        {open === 'off' && <TurnOff onUser={onUser} onDone={() => setOpen(null)} />}
      </Sheet>
    </section>
  );
}
