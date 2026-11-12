// Tests for multiple vehicles. Start the server on an EMPTY database with ADMIN_USERNAME=admin
// and ADMIN_PASSWORD=adminpass123, then:
//   BASE=http://localhost:3000 node server/test/vehicles.test.mjs
const B = process.env.BASE || 'http://localhost:3000';
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
async function call(method, path, body, token) {
  const r = await fetch(B + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  return { s: r.status, j };
}
const uuid = () => crypto.randomUUID();
const now = new Date().toISOString();
const later = (ms) => new Date(Date.now() + ms).toISOString();

const admin = (await call('POST', '/api/auth/login', { username: 'admin', password: 'adminpass123' })).j.token;

// A user created with a vehicle starts with it in their list.
await call('POST', '/api/users', { username: 'dave', password: 'davepass1', vehicle: ' Ford Focus AB12 CDE ' }, admin);
await call('POST', '/api/users', { username: 'joanne', password: 'jopass123' }, admin);
const dave = (await call('POST', '/api/auth/login', { username: 'dave', password: 'davepass1' })).j.token;
const jo = (await call('POST', '/api/auth/login', { username: 'joanne', password: 'jopass123' })).j.token;
let r = await call('POST', '/api/sync', { cursor: 0 }, dave);
ok(r.s === 200 && r.j.vehicles.length === 1 && r.j.vehicles[0].name === 'Ford Focus AB12 CDE', 'vehicle given at account creation becomes the first vehicle');
const focus = r.j.vehicles[0].id;
const epoch = r.j.epoch;
ok((await call('POST', '/api/sync', { cursor: 0 }, jo)).j.vehicles.length === 0, 'a user created without a vehicle has none');

// Add a second vehicle and use both.
const van = uuid(), t1 = uuid(), t2 = uuid(), t3 = uuid(), f1 = uuid();
r = await call('POST', '/api/sync', { epoch, cursor: r.j.cursor,
  vehicles: [
    { id: van, name: 'Transit van XY70 ZZZ', updatedAt: now },
    { id: uuid(), name: '   ', updatedAt: now },
    { id: 'nope', name: 'Bad id', updatedAt: now }],
  trips: [
    { id: t1, tripDate: '2026-11-02', miles: 12, vehicleId: focus, updatedAt: now },
    { id: t2, tripDate: '2026-11-03', miles: 30, vehicleId: van, updatedAt: now },
    { id: t3, tripDate: '2026-11-04', miles: 5, updatedAt: now },
    { id: uuid(), tripDate: '2026-11-04', miles: 5, vehicleId: 'not-a-uuid', updatedAt: now }],
  fuel: [{ id: f1, purchaseDate: '2026-11-03', amountPence: 6000, vehicleId: van, updatedAt: now }] }, dave);
ok(r.j.vehicles.length === 1 && r.j.vehicles[0].id === van, 'new vehicle stored and echoed');
ok(r.j.rejected.filter((x) => x.kind === 'vehicle').length === 2, 'vehicle with a blank name or bad id rejected');
ok(r.j.rejected.filter((x) => x.kind === 'trip').length === 1, 'journey with a malformed vehicle id rejected');
const byId = (list, id) => list.find((x) => x.id === id);
ok(byId(r.j.trips, t1).vehicleId === focus && byId(r.j.trips, t2).vehicleId === van, 'journeys keep their vehicle');
ok(byId(r.j.trips, t3).vehicleId === null, 'journey without a vehicle is allowed');
ok(r.j.fuel[0].vehicleId === van, 'fuel keeps its vehicle');

// A second device sees the lot.
r = await call('POST', '/api/sync', { epoch, cursor: 0 }, dave);
ok(r.j.vehicles.length === 2 && byId(r.j.trips, t2).vehicleId === van && r.j.fuel[0].vehicleId === van, 'second device pulls vehicles and assignments');
let cursor = r.j.cursor;

// A device that predates vehicles edits a journey without sending vehicleId: the assignment survives.
r = await call('POST', '/api/sync', { epoch, cursor, trips: [{ id: t2, tripDate: '2026-11-03', miles: 31, updatedAt: later(1000) }] }, dave);
ok(byId(r.j.trips, t2).miles === 31 && byId(r.j.trips, t2).vehicleId === van, 'edit from an older app keeps the vehicle');
// ...while an explicit null clears it, and a new id moves it.
r = await call('POST', '/api/sync', { epoch, cursor: r.j.cursor, trips: [{ id: t2, tripDate: '2026-11-03', miles: 31, vehicleId: null, updatedAt: later(2000) }] }, dave);
ok(byId(r.j.trips, t2).vehicleId === null, 'vehicle can be cleared');
r = await call('POST', '/api/sync', { epoch, cursor: r.j.cursor, trips: [{ id: t2, tripDate: '2026-11-03', miles: 31, vehicleId: focus, updatedAt: later(3000) }] }, dave);
ok(byId(r.j.trips, t2).vehicleId === focus, 'journey can be moved to another vehicle');

// Rename, then a stale rename loses; delete is a tombstone that keeps the name.
r = await call('POST', '/api/sync', { epoch, cursor: r.j.cursor, vehicles: [{ id: van, name: 'Transit (pool van)', updatedAt: later(5000) }] }, dave);
r = await call('POST', '/api/sync', { epoch, cursor: r.j.cursor, vehicles: [{ id: van, name: 'stale', updatedAt: now }] }, dave);
r = await call('POST', '/api/sync', { epoch, cursor: 0 }, dave);
ok(byId(r.j.vehicles, van).name === 'Transit (pool van)', 'last rename wins; stale rename ignored');
r = await call('POST', '/api/sync', { epoch, cursor: r.j.cursor, vehicles: [{ id: van, name: 'Transit (pool van)', deleted: true, updatedAt: later(9000) }] }, dave);
ok(r.j.vehicles[0].deleted === true && r.j.vehicles[0].name === 'Transit (pool van)', 'delete syncs as a tombstone');

// Isolation.
await call('POST', '/api/sync', { cursor: 0, vehicles: [{ id: focus, name: 'hijacked', updatedAt: later(99999) }] }, jo);
r = await call('POST', '/api/sync', { epoch, cursor: 0 }, dave);
ok(byId(r.j.vehicles, focus).name === 'Ford Focus AB12 CDE', "another user can't rename your vehicle");
ok((await call('POST', '/api/sync', { epoch, cursor: 0 }, jo)).j.vehicles.length === 0, "vehicles are private to each user");

console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exitCode = fails ? 1 : 0;
