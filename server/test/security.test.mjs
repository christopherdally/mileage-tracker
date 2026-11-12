// Tests for password reset by email, two-step sign-in, the activity log and rate limits.
// Start the server on an EMPTY database with ADMIN_PASSWORD set, ADMIN_USERNAME unset, APP_URL set and
// SMTP_HOST=127.0.0.1 SMTP_PORT=<port> (this test listens there), then:
//   BASE=http://localhost:3000 ADMIN_PASSWORD=... SMTP_PORT=... node server/test/security.test.mjs
import { startSmtpSink } from './smtp-sink.mjs';
import { codeAt, currentStep } from '../src/totp.js';

const B = process.env.BASE || 'http://localhost:3000';
const PW = process.env.ADMIN_PASSWORD;
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
async function call(method, path, body, token) {
  const r = await fetch(B + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  return { s: r.status, j };
}
const login = (username, password, code) => call('POST', '/api/auth/login', { username, password, code });
const mail = await startSmtpSink(Number(process.env.SMTP_PORT));
const noMail = () => mail.next(700).then(() => false, () => true);

ok((await call('GET', '/api/auth/options')).j.passwordReset === true, 'sign-in screen is told password reset is available');
const admin = (await login('admin@example.com', PW)).j.token;
await call('POST', '/api/users', { username: 'dave', password: 'davepass1' }, admin);
await call('POST', '/api/users', { username: 'jo@example.com', password: 'jopass123' }, admin);

// ── Password reset by email ──
let r = await call('POST', '/api/auth/forgot', { username: 'nobody@example.com' });
ok(r.s === 200 && r.j.ok && (await noMail()), 'unknown account: same reply, no email');
r = await call('POST', '/api/auth/forgot', { username: 'dave' });
ok(r.s === 200 && (await noMail()), 'account without an email address: same reply, no email');
r = await call('POST', '/api/auth/forgot', { username: 'Jo@Example.com' });
let message = await mail.next();
const link = /http:\/\/\S+#reset\?token=([\w-]+)/.exec(message.text);
ok(r.s === 200 && message.to === 'jo@example.com' && link && link[0].startsWith(process.env.APP_URL || B), 'reset link emailed to the account');
const token = link[1];
ok((await call('POST', '/api/auth/reset', { token: 'wrong', newPassword: 'brand-new-pass' })).s === 400, 'made-up token refused');
ok((await call('POST', '/api/auth/reset', { token, newPassword: 'short' })).s === 400, 'new password still has to be long enough');
const joOld = (await login('jo@example.com', 'jopass123')).j.token;
r = await call('POST', '/api/auth/reset', { token, newPassword: 'brand-new-pass' });
ok(r.s === 200, 'password reset with the emailed link');
ok((await login('jo@example.com', 'jopass123')).s === 401, 'old password no longer works');
ok((await call('GET', '/api/auth/me', null, joOld)).s === 401, 'devices signed in before the reset are signed out');
r = await login('jo@example.com', 'brand-new-pass');
ok(r.s === 200 && r.j.user.mustChangePassword === false, 'new password works');
let jo = r.j.token;
ok((await call('POST', '/api/auth/reset', { token, newPassword: 'another-pass-1' })).s === 400, 'a link works only once');

let sent = 0;
for (let i = 0; i < 4; i++) {
  await call('POST', '/api/auth/forgot', { username: 'jo@example.com' });
  if (!(await noMail())) sent++;
}
ok(sent === 2, 'at most three reset emails an hour per account');

// ── Two-step sign-in ──
r = await call('POST', '/api/auth/2fa/setup', {}, jo);
const secret = r.j.secret;
ok(r.s === 200 && /^[A-Z2-7]{32}$/.test(secret) && r.j.uri.startsWith('otpauth://totp/') && r.j.uri.includes(secret), 'setup returns a secret for the authenticator app');
ok((await login('jo@example.com', 'brand-new-pass')).s === 200, 'nothing changes at sign-in until setup is confirmed');
ok((await call('POST', '/api/auth/2fa/enable', { code: '000000' }, jo)).s === 400, 'wrong code does not turn it on');
const step = currentStep();
r = await call('POST', '/api/auth/2fa/enable', { code: codeAt(secret, step) }, jo);
const codes = r.j.recoveryCodes;
ok(r.s === 200 && r.j.user.twoFactor === true && codes.length === 10 && /^[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}$/.test(codes[0]), 'right code turns it on and gives recovery codes');
r = await login('jo@example.com', 'brand-new-pass');
ok(r.s === 401 && r.j.twoFactorRequired === true && !r.j.token, 'password alone no longer signs in');
ok((await login('jo@example.com', 'wrong-password', codeAt(secret, step + 1))).j.twoFactorRequired !== true, 'a wrong password is not told about two-step sign-in');
ok((await login('jo@example.com', 'brand-new-pass', '123456')).s === 401, 'wrong code refused');
ok((await login('jo@example.com', 'brand-new-pass', codeAt(secret, step))).s === 401, 'a code that was already used is refused');
r = await login('jo@example.com', 'brand-new-pass', codeAt(secret, step + 1));
ok(r.s === 200 && r.j.token, 'password and a fresh code sign in');
r = await login('jo@example.com', 'brand-new-pass', codes[3].toUpperCase());
ok(r.s === 200, 'a recovery code signs in');
jo = r.j.token;
ok((await login('jo@example.com', 'brand-new-pass', codes[3])).s === 401, 'each recovery code works once');
ok((await call('POST', '/api/auth/2fa/disable', { password: 'nope' }, jo)).s === 400, 'turning it off needs the password');
r = await call('POST', '/api/auth/2fa/disable', { password: 'brand-new-pass' }, jo);
ok(r.s === 200 && r.j.user.twoFactor === false && (await login('jo@example.com', 'brand-new-pass')).s === 200, 'turned off: password alone signs in again');

// Ten wrong codes lock code entry for that account, even for the right code.
const dave = (await login('dave', 'davepass1')).j.token;
const daveSecret = (await call('POST', '/api/auth/2fa/setup', {}, dave)).j.secret;
for (let i = 0; i < 10; i++) await call('POST', '/api/auth/2fa/enable', { code: '000000' }, dave);
ok((await call('POST', '/api/auth/2fa/enable', { code: codeAt(daveSecret, currentStep()) }, dave)).s === 429, 'code guessing is cut off after ten wrong tries');

// An admin can turn it off for someone who has lost their phone.
const joSecret = (await call('POST', '/api/auth/2fa/setup', {}, jo)).j.secret;
await call('POST', '/api/auth/2fa/enable', { code: codeAt(joSecret, currentStep()) }, jo);
const users = (await call('GET', '/api/users', null, admin)).j.users;
const joRow = users.find((u) => u.username === 'jo@example.com');
ok(joRow.twoFactor === true && !('totpSecret' in joRow) && !JSON.stringify(users).includes(joSecret), 'admins see who has it on, never the secret');
r = await call('PATCH', '/api/users/' + joRow.id, { resetTwoFactor: true }, admin);
ok(r.j.user.twoFactor === false && (await login('jo@example.com', 'brand-new-pass')).s === 200, 'admin turns two-step sign-in off for a user');

// ── Activity log ──
await call('DELETE', '/api/users/' + users.find((u) => u.username === 'dave').id, null, admin);
ok((await call('GET', '/api/audit', null, jo)).s === 403, 'activity log is for admins');
r = await call('GET', '/api/audit', null, admin);
const actions = r.j.entries.map((e) => `${e.action} ${e.target}`);
const has = (a) => actions.includes(a);
ok(has('user.create dave') && has('user.create jo@example.com') && has('user.delete dave'), 'user creation and deletion are logged');
ok(has('auth.password_reset_request jo@example.com') && has('auth.password_reset jo@example.com'), 'password resets are logged');
ok(has('auth.2fa_enable jo@example.com') && has('auth.2fa_disable jo@example.com') && has('auth.recovery_code_used jo@example.com'), 'two-step changes are logged');
const reset = r.j.entries.find((e) => e.action === 'user.update');
ok(reset && reset.actor === 'admin@example.com' && reset.target === 'jo@example.com' && reset.detail.changes.includes('two-step sign-in turned off') && reset.ip, 'admin changes say who did what to whom, and from where');
ok(r.j.entries[0].action === 'user.delete' && r.j.entries.every((e, i, all) => !i || e.id < all[i - 1].id), 'newest first');
ok(!JSON.stringify(r.j.entries).includes(token) && !JSON.stringify(r.j.entries).includes('brand-new-pass'), 'no secrets in the log');

// The log survives a restore of an older backup.
r = await call('POST', '/api/backups', {}, admin);
const backup = (await call('GET', '/api/backups', null, admin)).j.backups.find((b) => b.status === 'ok');
await call('POST', '/api/users', { username: 'after-backup', password: 'whatever-1' }, admin);
r = await call('POST', `/api/backups/${backup.id}/restore`, { confirm: 'RESTORE' }, admin);
const after = (await call('GET', '/api/audit', null, admin)).j.entries.map((e) => `${e.action} ${e.target}`);
ok(r.s === 200 && after[0].startsWith('backup.restore ') && after.includes('user.create after-backup') && after.includes('backup.create ' + backup.filename),
  'restoring a backup keeps the activity log and records the restore');

// ── Sign-in attempts are limited per address, counted in the database ──
let blockedAt = 0;
for (let i = 1; i <= 25 && !blockedAt; i++) if ((await login('admin@example.com', 'wrong-password')).s === 429) blockedAt = i;
ok(blockedAt > 0, 'too many sign-in attempts from one address are refused');
ok((await login('admin@example.com', PW)).s === 429, 'even with the right password, until the window passes');

await mail.close();
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exitCode = fails ? 1 : 0;
