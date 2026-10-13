import fsp from 'node:fs/promises';
import { query, withTx } from './db.js';
import { HttpError, createRouter, rateLimiter, sendFile, sendBytes } from './http.js';
import {
  authenticate, authenticateAdmin, hashPassword, verifyPassword, signToken, publicUser, DUMMY_HASH,
} from './auth.js';
import {
  runBackup, restoreBackup, fetchBackupFile, defaultTargets, s3Configured, BACKUP_DIR, backupSchedule,
} from './backup.js';

export const api = createRouter();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// A plain username or an email address.
const USERNAME_RE = /^[a-z0-9._@+-]{3,100}$/;
const str = (v, max = 100) => String(v ?? '').slice(0, max);
const checkPassword = (p) => {
  if (!p || String(p).length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
};

// ───────────────────────── Auth & profile ─────────────────────────
// There is deliberately no sign-up endpoint. Accounts are created by an admin.

const loginLimit = rateLimiter({ windowMs: 15 * 60 * 1000, limit: 20 });

api.post('/api/auth/login', async ({ body, ip }) => {
  loginLimit(ip);
  const username = str(body.username, 100).trim().toLowerCase();
  const password = String(body.password || '');
  if (!username || !password) throw new HttpError(400, 'Enter your username and password');
  const { rows } = await query('SELECT * FROM users WHERE username = $1', [username]);
  const user = rows[0];
  const ok = await verifyPassword(password, user?.password_hash || DUMMY_HASH);
  if (!user || !ok || !user.is_active) throw new HttpError(401, 'Wrong username or password');
  return { token: signToken(user), user: publicUser(user) };
});

api.get('/api/auth/me', async (req) => ({ user: publicUser(await authenticate(req)) }));

api.put('/api/auth/me', async (req) => {
  const me = await authenticate(req);
  const { rows } = await query(
    'UPDATE users SET display_name=$1, vehicle=$2, updated_at=now() WHERE id=$3 RETURNING *',
    [str(req.body.displayName ?? me.display_name), str(req.body.vehicle ?? me.vehicle), me.id]
  );
  return { user: publicUser(rows[0]) };
});

api.post('/api/auth/password', async (req) => {
  const me = await authenticate(req);
  if (!(await verifyPassword(String(req.body.currentPassword || ''), me.password_hash))) {
    throw new HttpError(400, 'Current password is wrong');
  }
  checkPassword(req.body.newPassword);
  if (String(req.body.newPassword) === String(req.body.currentPassword)) {
    throw new HttpError(400, 'Choose a new password that is different from the current one');
  }
  // Bumping token_version signs out every other device; this one gets a fresh token.
  const { rows } = await query(
    `UPDATE users SET password_hash=$1, token_version=token_version+1, must_change_password=false, updated_at=now()
     WHERE id=$2 RETURNING *`,
    [await hashPassword(String(req.body.newPassword)), me.id]
  );
  return { token: signToken(rows[0]), user: publicUser(rows[0]) };
});

// ───────────────────────── User administration ─────────────────────────

async function otherActiveAdmins(id) {
  const { rows } = await query('SELECT count(*)::int AS n FROM users WHERE is_admin AND is_active AND id <> $1', [id]);
  return rows[0].n;
}
async function findUser(id) {
  if (!UUID_RE.test(id)) throw new HttpError(404, 'User not found');
  const { rows } = await query('SELECT * FROM users WHERE id=$1', [id]);
  if (!rows[0]) throw new HttpError(404, 'User not found');
  return rows[0];
}

api.get('/api/users', async (req) => {
  await authenticateAdmin(req);
  const { rows } = await query(`
    SELECT u.*,
      (SELECT count(*)::int FROM trips t WHERE t.user_id=u.id AND NOT t.deleted) AS trip_count,
      (SELECT max(trip_date) FROM trips t WHERE t.user_id=u.id AND NOT t.deleted) AS last_trip
    FROM users u ORDER BY u.username`);
  return { users: rows.map((u) => ({ ...publicUser(u), tripCount: u.trip_count, lastTrip: u.last_trip })) };
});

api.post('/api/users', async (req) => {
  await authenticateAdmin(req);
  const b = req.body;
  const username = str(b.username, 100).trim().toLowerCase();
  if (!USERNAME_RE.test(username)) throw new HttpError(400, 'Use an email address or a username of letters, numbers and . _ -');
  checkPassword(b.password);
  try {
    const { rows } = await query(
      `INSERT INTO users (username, display_name, password_hash, is_admin, vehicle, must_change_password)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [username, str(b.displayName) || username, await hashPassword(String(b.password)), !!b.isAdmin, str(b.vehicle),
       b.mustChangePassword !== false]
    );
    return { status: 201, body: { user: publicUser(rows[0]) } };
  } catch (e) {
    if (e.code === '23505') throw new HttpError(409, 'That username is already taken');
    throw e;
  }
});

api.patch('/api/users/:id', async (req) => {
  const me = await authenticateAdmin(req);
  const u = await findUser(req.params.id);
  const b = req.body;
  const isAdmin = b.isAdmin === undefined ? u.is_admin : !!b.isAdmin;
  const isActive = b.isActive === undefined ? u.is_active : !!b.isActive;
  if (u.is_admin && u.is_active && (!isAdmin || !isActive) && (await otherActiveAdmins(u.id)) === 0) {
    throw new HttpError(400, 'There must always be at least one active admin');
  }
  if (u.id === me.id && !isActive) throw new HttpError(400, "You can't disable your own account");

  let hash = u.password_hash;
  let bump = 0;
  if (b.password) {
    checkPassword(b.password);
    hash = await hashPassword(String(b.password));
    bump = 1;
  }
  if (u.is_active && !isActive) bump = 1; // disabling signs them out everywhere

  const { rows } = await query(
    `UPDATE users SET display_name=$1, vehicle=$2, is_admin=$3, is_active=$4, password_hash=$5,
       token_version=token_version+$6, must_change_password = must_change_password OR $8,
       updated_at=now() WHERE id=$7 RETURNING *`,
    [str(b.displayName ?? u.display_name), str(b.vehicle ?? u.vehicle), isAdmin, isActive, hash, bump, u.id,
     !!b.password && u.id !== me.id]
  );
  return { user: publicUser(rows[0]) };
});

api.delete('/api/users/:id', async (req) => {
  const me = await authenticateAdmin(req);
  const u = await findUser(req.params.id);
  if (u.id === me.id) throw new HttpError(400, "You can't delete your own account");
  if (u.is_admin && u.is_active && (await otherActiveAdmins(u.id)) === 0) {
    throw new HttpError(400, 'There must always be at least one active admin');
  }
  await query('DELETE FROM users WHERE id=$1', [u.id]); // cascades to trips and rates
  return { ok: true };
});

// ───────────────────────── Sync ─────────────────────────

const MAX_BATCH = 2000;
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const isDate = (v) => typeof v === 'string' && DATE_RE.test(v) && !Number.isNaN(Date.parse(v));
const isoOrNull = (v) => { const t = Date.parse(v); return Number.isNaN(t) ? null : new Date(t).toISOString(); };
const finite = (v, max) => v === null || (Number.isFinite(v) && v >= 0 && v <= max);

function cleanTrip(t) {
  if (!t || !UUID_RE.test(t.id) || !isDate(t.tripDate)) return null;
  const miles = num(t.miles);
  const rate = num(t.rateOverridePence);
  const so = num(t.startOdometer);
  const eo = num(t.endOdometer);
  const updatedAt = isoOrNull(t.updatedAt);
  if (miles === null || !finite(miles, 100000) || !finite(rate, 100000) || !finite(so, 1e8) || !finite(eo, 1e8)) return null;
  if (!updatedAt) return null;
  return {
    id: t.id.toLowerCase(), tripDate: t.tripDate, description: str(t.description, 500),
    startOdometer: so, endOdometer: eo, miles, rateOverridePence: rate, deleted: !!t.deleted, updatedAt,
  };
}

function cleanRate(p) {
  if (!p || !UUID_RE.test(p.id) || !isDate(p.startDate)) return null;
  if (p.endDate && (!isDate(p.endDate) || p.endDate < p.startDate)) return null;
  const pence = num(p.pencePerMile);
  const updatedAt = isoOrNull(p.updatedAt);
  if (pence === null || !finite(pence, 100000) || !updatedAt) return null;
  return {
    id: p.id.toLowerCase(), label: str(p.label), pencePerMile: pence, startDate: p.startDate,
    endDate: p.endDate || null, deleted: !!p.deleted, updatedAt,
  };
}

function cleanFuel(f) {
  if (!f || !UUID_RE.test(f.id) || !isDate(f.purchaseDate)) return null;
  const amount = num(f.amountPence);
  const litres = num(f.litres);
  const odo = num(f.odometer);
  const updatedAt = isoOrNull(f.updatedAt);
  if (amount === null || !Number.isInteger(amount) || !finite(amount, 10_000_000)) return null;
  if (!finite(litres, 10000) || !finite(odo, 1e8) || !updatedAt) return null;
  const ids = Array.isArray(f.receiptIds) ? f.receiptIds : [];
  if (ids.length > 20 || !ids.every((x) => typeof x === 'string' && UUID_RE.test(x))) return null;
  return {
    id: f.id.toLowerCase(), purchaseDate: f.purchaseDate, amountPence: amount, litres, odometer: odo,
    description: str(f.description, 300), receiptIds: ids.map((x) => x.toLowerCase()), deleted: !!f.deleted, updatedAt,
  };
}

const fuelOut = (f) => ({
  id: f.id, purchaseDate: f.purchase_date, amountPence: f.amount_pence, litres: f.litres, odometer: f.odometer,
  description: f.description, receiptIds: f.receipt_ids || [], deleted: f.deleted,
  updatedAt: new Date(f.client_updated_at).toISOString(),
});

const tripOut = (t) => ({
  id: t.id, tripDate: t.trip_date, description: t.description, startOdometer: t.start_odometer,
  endOdometer: t.end_odometer, miles: t.miles, rateOverridePence: t.rate_override_pence,
  deleted: t.deleted, updatedAt: new Date(t.client_updated_at).toISOString(),
});
const rateOut = (p) => ({
  id: p.id, label: p.label, pencePerMile: p.pence_per_mile, startDate: p.start_date, endDate: p.end_date,
  deleted: p.deleted, updatedAt: new Date(p.client_updated_at).toISOString(),
});

/**
 * Two-way sync.
 *   Request: { epoch, cursor, trips: [...], rates: [...] }  — this device's unsynced changes
 *   Reply:   { epoch, reset, cursor, trips, rates, rejected } — everything changed on the server after `cursor`
 * Conflicts: the most recent edit wins (by the editing device's updatedAt). Deletes are tombstones
 * (deleted=true) so other devices find out. `reset` means the server was restored from a backup:
 * the device should throw away its synced copy and keep only what this reply contains.
 */
api.post('/api/sync', async (req) => {
  const me = await authenticate(req);
  const inTrips = Array.isArray(req.body.trips) ? req.body.trips : [];
  const inRates = Array.isArray(req.body.rates) ? req.body.rates : [];
  const inFuel = Array.isArray(req.body.fuel) ? req.body.fuel : [];
  if (inTrips.length + inRates.length + inFuel.length > MAX_BATCH) throw new HttpError(413, `Send at most ${MAX_BATCH} changes per sync`);
  let cursor = Math.max(0, Math.floor(Number(req.body.cursor) || 0));
  const rejected = [];

  const out = await withTx(async (c) => {
    // Serialise syncs per user so the pull cursor can never skip a row committed out of order.
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [me.id]);
    const { rows: [{ value: epoch }] } = await c.query("SELECT value FROM meta WHERE key='data_epoch'");
    const reset = req.body.epoch !== epoch;
    if (reset) cursor = 0;

    for (const raw of inRates) {
      const p = cleanRate(raw);
      if (!p) { rejected.push({ kind: 'rate', id: raw?.id ?? null }); continue; }
      await c.query(
        `INSERT INTO rate_periods (id,user_id,label,pence_per_mile,start_date,end_date,deleted,client_updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (id) DO UPDATE SET
           label=EXCLUDED.label, pence_per_mile=EXCLUDED.pence_per_mile, start_date=EXCLUDED.start_date,
           end_date=EXCLUDED.end_date, deleted=EXCLUDED.deleted, client_updated_at=EXCLUDED.client_updated_at,
           server_seq=nextval('sync_seq')
         WHERE rate_periods.user_id = EXCLUDED.user_id
           AND EXCLUDED.client_updated_at >= rate_periods.client_updated_at`,
        [p.id, me.id, p.label, p.pencePerMile, p.startDate, p.endDate, p.deleted, p.updatedAt]
      );
    }
    for (const raw of inTrips) {
      const t = cleanTrip(raw);
      if (!t) { rejected.push({ kind: 'trip', id: raw?.id ?? null }); continue; }
      await c.query(
        `INSERT INTO trips (id,user_id,trip_date,description,start_odometer,end_odometer,miles,rate_override_pence,deleted,client_updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (id) DO UPDATE SET
           trip_date=EXCLUDED.trip_date, description=EXCLUDED.description,
           start_odometer=EXCLUDED.start_odometer, end_odometer=EXCLUDED.end_odometer, miles=EXCLUDED.miles,
           rate_override_pence=EXCLUDED.rate_override_pence, deleted=EXCLUDED.deleted,
           client_updated_at=EXCLUDED.client_updated_at, server_seq=nextval('sync_seq')
         WHERE trips.user_id = EXCLUDED.user_id
           AND EXCLUDED.client_updated_at >= trips.client_updated_at`,
        [t.id, me.id, t.tripDate, t.description, t.startOdometer, t.endOdometer, t.miles,
         t.rateOverridePence, t.deleted, t.updatedAt]
      );
    }

    for (const raw of inFuel) {
      const f = cleanFuel(raw);
      if (!f) { rejected.push({ kind: 'fuel', id: raw?.id ?? null }); continue; }
      await c.query(
        `INSERT INTO fuel_purchases (id,user_id,purchase_date,amount_pence,litres,odometer,description,receipt_ids,deleted,client_updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)
         ON CONFLICT (id) DO UPDATE SET
           purchase_date=EXCLUDED.purchase_date, amount_pence=EXCLUDED.amount_pence, litres=EXCLUDED.litres,
           odometer=EXCLUDED.odometer, description=EXCLUDED.description, receipt_ids=EXCLUDED.receipt_ids,
           deleted=EXCLUDED.deleted, client_updated_at=EXCLUDED.client_updated_at, server_seq=nextval('sync_seq')
         WHERE fuel_purchases.user_id = EXCLUDED.user_id
           AND EXCLUDED.client_updated_at >= fuel_purchases.client_updated_at`,
        [f.id, me.id, f.purchaseDate, f.amountPence, f.litres, f.odometer, f.description,
         JSON.stringify(f.receiptIds), f.deleted, f.updatedAt]
      );
    }

    const trips = await c.query('SELECT * FROM trips WHERE user_id=$1 AND server_seq > $2 ORDER BY server_seq', [me.id, cursor]);
    const fuel = await c.query('SELECT * FROM fuel_purchases WHERE user_id=$1 AND server_seq > $2 ORDER BY server_seq', [me.id, cursor]);
    const rates = await c.query('SELECT * FROM rate_periods WHERE user_id=$1 AND server_seq > $2 ORDER BY server_seq', [me.id, cursor]);
    const next = Math.max(cursor, ...[...trips.rows, ...rates.rows, ...fuel.rows].map((x) => Number(x.server_seq)));
    return {
      epoch, reset, cursor: next,
      trips: trips.rows.map(tripOut), rates: rates.rows.map(rateOut), fuel: fuel.rows.map(fuelOut),
    };
  });
  return { ...out, rejected };
});

// ───────────────────────── Receipt files ─────────────────────────
// Uploaded separately from sync (photos are big). The id is chosen on the phone, so a retry is harmless.

const FILE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']);
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

api.put('/api/files/:id', async (req) => {
  const me = await authenticate(req);
  const id = String(req.params.id).toLowerCase();
  if (!UUID_RE.test(id)) throw new HttpError(400, 'Bad file id');
  const mime = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (!FILE_TYPES.has(mime)) throw new HttpError(415, 'Receipts must be a photo (JPEG, PNG, WebP, HEIC) or a PDF');
  const data = req.rawBody;
  if (!data?.length) throw new HttpError(400, 'Empty file');
  const { rows } = await query(
    `INSERT INTO receipt_files (id, user_id, mime, size_bytes, data) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (id) DO NOTHING RETURNING id`,
    [id, me.id, mime, data.length, data]
  );
  if (!rows.length) {
    const { rows: ex } = await query('SELECT user_id FROM receipt_files WHERE id=$1', [id]);
    if (ex[0]?.user_id !== me.id) throw new HttpError(409, 'File id already in use');
  }
  return { ok: true, id };
});

api.get('/api/files/:id', async (req, res) => {
  const me = await authenticate(req);
  const id = String(req.params.id).toLowerCase();
  if (!UUID_RE.test(id)) throw new HttpError(404, 'Not found');
  const { rows } = await query('SELECT mime, data FROM receipt_files WHERE id=$1 AND user_id=$2', [id, me.id]);
  if (!rows[0]) throw new HttpError(404, 'Receipt not found');
  sendBytes(res, rows[0].mime, rows[0].data);
  return undefined;
});

// ───────────────────────── Backups (admin) ─────────────────────────

let busy = false;
async function exclusive(fn) {
  if (busy) throw new HttpError(409, 'A backup or restore is already running');
  busy = true;
  try { return await fn(); } finally { busy = false; }
}
async function findBackup(id) {
  const { rows } = await query("SELECT * FROM backups WHERE id=$1 AND status='ok'", [Number(id) || 0]);
  if (!rows[0]) throw new HttpError(404, 'Backup not found');
  return rows[0];
}

api.get('/api/backups', async (req) => {
  await authenticateAdmin(req);
  const { rows } = await query('SELECT * FROM backups ORDER BY created_at DESC, id DESC LIMIT 100');
  return {
    config: {
      defaultTargets: defaultTargets(), s3: s3Configured(), localDir: BACKUP_DIR,
      schedule: backupSchedule(), keep: Number(process.env.BACKUP_KEEP || 30),
    },
    backups: rows.map((b) => ({
      id: b.id, filename: b.filename, target: b.target, location: b.location,
      sizeBytes: b.size_bytes === null ? null : Number(b.size_bytes), status: b.status, error: b.error,
      createdBy: b.created_by, createdAt: b.created_at,
    })),
  };
});

api.post('/api/backups', async (req) => {
  const me = await authenticateAdmin(req);
  let targets = Array.isArray(req.body.targets) ? req.body.targets.filter((t) => t === 'local' || t === 's3') : [];
  if (!targets.length) targets = defaultTargets();
  return exclusive(async () => ({ results: await runBackup({ targets, createdBy: me.username }) }));
});

api.get('/api/backups/:id/download', async (req, res) => {
  await authenticateAdmin(req);
  const b = await findBackup(req.params.id);
  const file = await fetchBackupFile(b);
  try {
    await sendFile(res, file.path, b.filename);
  } finally {
    if (file.temp) await fsp.unlink(file.path).catch(() => {});
  }
  return undefined; // response already sent
});

api.post('/api/backups/:id/restore', async (req) => {
  const me = await authenticateAdmin(req);
  if (req.body.confirm !== 'RESTORE') throw new HttpError(400, 'Type RESTORE to confirm');
  const b = await findBackup(req.params.id);
  return exclusive(async () => {
    // Safety net: snapshot the current data first so a restore can itself be undone.
    const pre = await runBackup({ targets: defaultTargets(), createdBy: `${me.username} (before restore)` });
    if (!pre.some((r) => r.status === 'ok')) throw new HttpError(500, 'Could not take a safety backup, restore cancelled');
    await restoreBackup(b);
    return { ok: true };
  });
});
