import http from 'node:http';
import path from 'node:path';
import { migrate, query } from './db.js';
import { HttpError, readJson, readRaw, sendJson, serveStatic } from './http.js';
import { hashPassword } from './auth.js';
import { api, MAX_FILE_BYTES } from './api.js';
import { startBackupSchedule } from './backup.js';

const CLIENT_DIR = path.resolve(process.env.CLIENT_DIR || 'public');
const TRUST_PROXY = process.env.TRUST_PROXY === 'true';

function clientIp(req) {
  if (TRUST_PROXY) {
    const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (fwd) return fwd;
  }
  return req.socket.remoteAddress || 'unknown';
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;

  if (pathname === '/api/health') {
    await query('SELECT 1');
    return sendJson(res, 200, { ok: true });
  }

  if (pathname.startsWith('/api/')) {
    const m = api.match(req.method, pathname);
    if (!m) throw new HttpError(404, 'Not found');
    if (m.methodNotAllowed) throw new HttpError(405, 'Method not allowed');
    const ctx = { method: req.method, headers: req.headers, params: m.params, ip: clientIp(req), url };
    if (req.method === 'PUT' && pathname.startsWith('/api/files/')) {
      ctx.body = {};
      ctx.rawBody = await readRaw(req, MAX_FILE_BYTES);
    } else {
      ctx.body = await readJson(req);
    }
    const out = await m.handler(ctx, res);
    if (res.headersSent) return;
    if (out && out.status && out.body) return sendJson(res, out.status, out.body);
    return sendJson(res, 200, out ?? { ok: true });
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
  if (!serveStatic(CLIENT_DIR, req, res, pathname)) throw new HttpError(404, 'Not found');
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    if (res.headersSent) return res.destroy();
    // After refusing a large body, close the connection rather than reuse a half-read stream.
    if (err.status === 413) res.setHeader('Connection', 'close');
    if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message });
    console.error(err);
    sendJson(res, 500, { error: 'Something went wrong on the server' });
  });
});

async function bootstrapAdmin() {
  const { rows } = await query('SELECT count(*)::int AS n FROM users');
  if (rows[0].n > 0) return;
  const username = (process.env.ADMIN_USERNAME || 'cdallywales@gmail.com').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!password || password.length < 8) {
    console.warn('No users exist yet. Set ADMIN_PASSWORD (8+ characters) to create the first admin.');
    return;
  }
  // The first admin must choose their own password the first time they sign in.
  await query(
    'INSERT INTO users (username, display_name, password_hash, is_admin, must_change_password) VALUES ($1,$2,$3,true,true)',
    [username, process.env.ADMIN_NAME || 'Administrator', await hashPassword(password)]
  );
  console.log(`Created the first admin account "${username}". They will be asked to change the password on first sign-in.`);
}

async function main() {
  for (let i = 0; ; i++) {
    try { await migrate(); break; } catch (e) {
      if (i >= 30) throw e;
      console.log('Waiting for the database…');
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  await bootstrapAdmin();
  startBackupSchedule();
  // Tidy receipt files that no fuel entry points at any more (kept for a week in case a phone is mid-sync).
  const tidyReceipts = () => query(`
    DELETE FROM receipt_files r WHERE r.created_at < now() - interval '7 days'
      AND NOT EXISTS (SELECT 1 FROM fuel_purchases f WHERE NOT f.deleted AND f.receipt_ids ? r.id::text)`)
    .catch((e) => console.error('Receipt tidy-up failed:', e.message));
  tidyReceipts();
  setInterval(tidyReceipts, 24 * 3600 * 1000);
  const port = Number(process.env.PORT || 3000);
  server.listen(port, () => console.log(`Mileage Tracker listening on port ${port}`));
}

main().catch((e) => { console.error(e); process.exit(1); });
