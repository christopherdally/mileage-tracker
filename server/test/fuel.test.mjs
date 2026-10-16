// Tests for email logins, forced password change, fuel sync and receipt files.
// Start the server on an EMPTY database with ADMIN_PASSWORD set and ADMIN_USERNAME unset, then:
//   BASE=http://localhost:3000 ADMIN_PASSWORD=... node server/test/fuel.test.mjs
const B = process.env.BASE || 'http://localhost:3000';
const PW = process.env.ADMIN_PASSWORD;
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
async function call(method, path, body, token, raw) {
  const headers = token ? { authorization: 'Bearer ' + token } : {};
  let payload;
  if (raw) { headers['content-type'] = raw.type; payload = raw.data; }
  else if (body) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  const r = await fetch(B + path, { method, headers, body: payload });
  const buf = Buffer.from(await r.arrayBuffer());
  let j; try { j = JSON.parse(buf.toString()); } catch { j = buf; }
  return { s: r.status, j, type: r.headers.get('content-type') };
}
const uuid = () => crypto.randomUUID();

let r = await call('POST', '/api/auth/login', { username: 'Admin@Example.com', password: PW });
ok(r.s === 200 && r.j.user.username === 'admin@example.com' && r.j.user.isAdmin, 'first admin is the email address (case-insensitive)');
ok(r.j.user.mustChangePassword === true, 'first admin must change password');
let tok = r.j.token;
ok((await call('POST', '/api/auth/password', { currentPassword: PW, newPassword: PW }, tok)).s === 400, 'cannot "change" to the same password');
r = await call('POST', '/api/auth/password', { currentPassword: PW, newPassword: 'my-own-secret-99' }, tok);
ok(r.s === 200 && r.j.user.mustChangePassword === false, 'password changed, flag cleared');
tok = r.j.token;
ok((await call('POST', '/api/auth/login', { username: 'admin@example.com', password: PW })).s === 401, 'initial password no longer works');

r = await call('POST', '/api/users', { username: 'jo.bloggs+work@example.co.uk', password: 'tempPass123' }, tok);
ok(r.s === 201 && r.j.user.mustChangePassword === true, 'admin can create an email-address user; must change password');

// Receipt upload
const fileId = uuid();
const jpeg = Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9', 'hex');
ok((await call('PUT', `/api/files/${fileId}`, null, null, { type: 'image/jpeg', data: jpeg })).s === 401, 'upload needs login');
ok((await call('PUT', `/api/files/${fileId}`, null, tok, { type: 'text/html', data: Buffer.from('<x>') })).s === 415, 'non-receipt file type refused');
r = await call('PUT', `/api/files/${fileId}`, null, tok, { type: 'image/jpeg', data: jpeg });
ok(r.s === 200, 'receipt photo uploaded');
ok((await call('PUT', `/api/files/${fileId}`, null, tok, { type: 'image/jpeg', data: jpeg })).s === 200, 'retrying the same upload is harmless');
r = await call('GET', `/api/files/${fileId}`, null, tok);
ok(r.s === 200 && r.type === 'image/jpeg' && Buffer.compare(r.j, jpeg) === 0, 'receipt downloads byte-for-byte');
const big = Buffer.alloc(11 * 1024 * 1024);
// The server answers 413 straight away and closes; some clients see that as a dropped connection.
const bigRes = await call('PUT', `/api/files/${uuid()}`, null, tok, { type: 'image/jpeg', data: big }).catch(() => ({ s: 'closed' }));
ok(bigRes.s === 413 || bigRes.s === 'closed', 'oversized file refused');

// Other user can't read it
const jo = (await call('POST', '/api/auth/login', { username: 'jo.bloggs+work@example.co.uk', password: 'tempPass123' })).j.token;
ok((await call('GET', `/api/files/${fileId}`, null, jo)).s === 404, "another user can't see your receipt");
ok((await call('PUT', `/api/files/${fileId}`, null, jo, { type: 'image/jpeg', data: jpeg })).s === 409, "another user can't overwrite your receipt");

// Fuel sync
const f1 = uuid();
const now = new Date().toISOString();
r = await call('POST', '/api/sync', { cursor: 0, fuel: [
  { id: f1, purchaseDate: '2026-10-13', amountPence: 8999, litres: 61.2, odometer: 41300, description: 'Tesco Extra, Cardiff', receiptIds: [fileId], updatedAt: now },
  { id: uuid(), purchaseDate: '2026-10-13', amountPence: 12.5, updatedAt: now },
] }, tok);
ok(r.s === 200 && r.j.fuel.length === 1 && r.j.fuel[0].amountPence === 8999 && r.j.fuel[0].receiptIds[0] === fileId, 'fuel purchase synced with receipt link');
ok(r.j.rejected.length === 1, 'fractional pence rejected');
const epoch = r.j.epoch;
r = await call('POST', '/api/sync', { epoch, cursor: 0 }, jo);
ok(r.j.fuel.length === 0, "fuel is private to each user");
r = await call('POST', '/api/sync', { epoch, cursor: 0 }, tok);
ok(r.j.fuel[0].litres === 61.2 && r.j.fuel[0].description === 'Tesco Extra, Cardiff', 'second device pulls fuel');

console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
