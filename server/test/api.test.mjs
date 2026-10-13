// End-to-end API test. Start the server against an EMPTY database with ADMIN_PASSWORD=adminpass123, then:
//   BASE=http://localhost:3000 node server/test/api.test.mjs
const B = process.env.BASE || 'http://localhost:3000';
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
async function call(method, path, body, token) {
  const r = await fetch(B + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  return { s: r.status, j };
}
const uuid = () => crypto.randomUUID();

let r = await call('POST', '/api/auth/login', { username: 'admin', password: 'wrong' });
ok(r.s === 401, 'wrong password rejected');
r = await call('POST', '/api/auth/login', { username: 'ADMIN', password: 'adminpass123' });
ok(r.s === 200 && r.j.user.isAdmin, 'admin login (case-insensitive username)');
const admin = r.j.token;
ok((await call('POST', '/api/auth/signup', { username: 'x', password: 'y' })).s === 404, 'no sign-up endpoint');
ok((await call('GET', '/api/users')).s === 401, 'users list needs login');

r = await call('POST', '/api/users', { username: 'dave', password: 'davepass1', displayName: 'Dave', vehicle: 'Ford Focus AB12 CDE' }, admin);
ok(r.s === 201, 'admin creates user'); const daveId = r.j.user.id;
ok((await call('POST', '/api/users', { username: 'dave', password: 'davepass1' }, admin)).s === 409, 'duplicate username blocked');
ok((await call('POST', '/api/users', { username: 'x', password: 'short' }, admin)).s === 400, 'bad username/password validated');
const dave = (await call('POST', '/api/auth/login', { username: 'dave', password: 'davepass1' })).j.token;
ok((await call('GET', '/api/users', null, dave)).s === 403, 'non-admin cannot manage users');
const adminId = (await call('GET', '/api/auth/me', null, admin)).j.user.id;
ok((await call('PATCH', '/api/users/' + adminId, { isAdmin: false }, admin)).s === 400, 'cannot remove last admin');

// Sync: device A pushes rates and trips
const r1 = uuid(), r2 = uuid(), t1 = uuid(), t2 = uuid();
const now = new Date().toISOString();
r = await call('POST', '/api/sync', { cursor: 0, rates: [
  { id: r1, label: 'Diesel summer', pencePerMile: 45, startDate: '2026-09-01', endDate: '2026-09-30', updatedAt: now },
  { id: r2, label: 'Autumn', pencePerMile: 48.5, startDate: '2026-10-01', endDate: null, updatedAt: now },
  { id: uuid(), pencePerMile: 40, startDate: '2026-10-05', endDate: '2026-10-01', updatedAt: now }],
  trips: [
  { id: t1, tripDate: '2026-09-29', description: 'Site visit Cardiff', startOdometer: 1000, endOdometer: 1042.5, miles: 42.5, updatedAt: now },
  { id: t2, tripDate: '2026-10-02', description: 'Client Bristol', miles: 88, updatedAt: now },
  { id: 'nope', tripDate: '2026-10-02', miles: 5, updatedAt: now }] }, dave);
ok(r.s === 200 && r.j.reset === true, 'first sync returns reset (fresh device)');
ok(r.j.trips.length === 2 && r.j.rates.length === 2, 'valid rows stored and echoed');
ok(r.j.rejected.length === 2, 'invalid rows rejected (bad id, end before start)');
const epoch = r.j.epoch, cursorA = r.j.cursor;

// Device B pulls from scratch
r = await call('POST', '/api/sync', { epoch, cursor: 0 }, dave);
ok(r.j.trips.length === 2 && r.j.reset === false, 'second device pulls everything');
const cursorB = r.j.cursor;
ok((await call('POST', '/api/sync', { epoch, cursor: cursorB }, dave)).j.trips.length === 0, 'nothing new after cursor');

// Conflict: B edits later, A edits with older timestamp afterwards -> B wins
const later = new Date(Date.now() + 60000).toISOString();
await call('POST', '/api/sync', { epoch, cursor: cursorB, trips: [{ id: t2, tripDate: '2026-10-02', description: 'Client Bristol (return)', miles: 90, updatedAt: later }] }, dave);
r = await call('POST', '/api/sync', { epoch, cursor: cursorA, trips: [{ id: t2, tripDate: '2026-10-02', description: 'stale edit', miles: 1, updatedAt: now }] }, dave);
const t2row = r.j.trips.find((t) => t.id === t2);
ok(t2row && t2row.miles === 90 && t2row.description === 'Client Bristol (return)', 'last edit wins; stale edit ignored and corrected');

// Delete tombstone propagates
r = await call('POST', '/api/sync', { epoch, cursor: r.j.cursor, trips: [{ id: t1, tripDate: '2026-09-29', miles: 42.5, deleted: true, updatedAt: new Date(Date.now() + 120000).toISOString() }] }, dave);
ok(r.j.trips.some((t) => t.id === t1 && t.deleted), 'delete syncs as tombstone');

// Isolation: admin can't overwrite dave's row by reusing the id
await call('POST', '/api/sync', { cursor: 0, trips: [{ id: t2, tripDate: '2026-10-02', description: 'hijack', miles: 999, updatedAt: new Date(Date.now() + 999999).toISOString() }] }, admin);
r = await call('POST', '/api/sync', { epoch, cursor: 0 }, dave);
ok(r.j.trips.find((t) => t.id === t2).miles === 90, 'another user cannot overwrite your rows');
r = await call('POST', '/api/sync', { cursor: 0 }, admin);
ok(r.j.trips.every((t) => t.id !== t1), "admin sync doesn't see dave's trips");

// Password change bumps sessions
r = await call('POST', '/api/auth/password', { currentPassword: 'davepass1', newPassword: 'newdave123' }, dave);
ok(r.s === 200, 'password change');
ok((await call('GET', '/api/auth/me', null, dave)).s === 401, 'old sessions signed out after password change');
const dave2 = r.j.token;
ok((await call('PUT', '/api/auth/me', { vehicle: 'VW Golf XY70 ZZZ' }, dave2)).j.user.vehicle === 'VW Golf XY70 ZZZ', 'profile vehicle update');

// Disable user
await call('PATCH', '/api/users/' + daveId, { isActive: false }, admin);
ok((await call('POST', '/api/auth/login', { username: 'dave', password: 'newdave123' })).s === 401, 'disabled user cannot log in');
await call('PATCH', '/api/users/' + daveId, { isActive: true, password: 'resetpass9' }, admin);
const dave3 = (await call('POST', '/api/auth/login', { username: 'dave', password: 'resetpass9' })).j.token;
ok(!!dave3, 'admin re-enables and resets password');

// Backups
r = await call('POST', '/api/backups', {}, admin);
ok(r.s === 200 && r.j.results[0].status === 'ok', 'manual local backup: ' + JSON.stringify(r.j.results?.[0]?.error || r.j.results?.[0]?.location));
r = await call('POST', '/api/backups', { targets: ['s3'] }, admin);
ok(r.j.results[0].status === 'failed' && /S3_BUCKET/.test(r.j.results[0].error), 'S3 without config reports a clear error');
const list = await call('GET', '/api/backups', null, admin);
const good = list.j.backups.find((b) => b.status === 'ok');
const dl = await fetch(B + `/api/backups/${good.id}/download`, { headers: { authorization: 'Bearer ' + admin } });
const buf = Buffer.from(await dl.arrayBuffer());
ok(dl.status === 200 && buf.slice(0, 5).toString() === 'PGDMP', 'backup downloads as a pg_dump file');

// Change data, then restore
await call('POST', '/api/sync', { epoch, cursor: 0, trips: [{ id: uuid(), tripDate: '2026-10-10', miles: 5, description: 'after backup', updatedAt: new Date().toISOString() }] }, dave3);
ok((await call('POST', `/api/backups/${good.id}/restore`, { confirm: 'nope' }, admin)).s === 400, 'restore needs typed confirmation');
r = await call('POST', `/api/backups/${good.id}/restore`, { confirm: 'RESTORE' }, admin);
ok(r.s === 200, 'restore succeeded ' + JSON.stringify(r.j));
const dave4 = (await call('POST', '/api/auth/login', { username: 'dave', password: 'resetpass9' })).j.token;
r = await call('POST', '/api/sync', { epoch, cursor: 999999 }, dave4);
ok(r.j.reset === true && !r.j.trips.some((t) => t.description === 'after backup') && r.j.trips.length === 2, 'after restore devices get reset + restored data');
const list2 = await call('GET', '/api/backups', null, admin);
ok(list2.j.backups.some((b) => /before restore/.test(b.createdBy)) && list2.j.backups.some((b) => b.status === 'restored'), 'backup log survives restore incl. safety backup');

// Static / misc
ok((await call('GET', '/api/nothing')).s === 404, 'unknown api 404');
ok((await call('DELETE', '/api/users/' + adminId, null, admin)).s === 400, 'cannot delete yourself');
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
