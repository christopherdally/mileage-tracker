// Starts the server against a fresh, empty database for a test run, then cleans up.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = path.dirname(fileURLToPath(import.meta.url));
// The user must be allowed to create databases.
const adminUrl = process.env.TEST_DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:5432/postgres';

async function sql(text) {
  const c = new pg.Client({ connectionString: adminUrl });
  await c.connect();
  try { await c.query(text); } finally { await c.end(); }
}

async function waitForHealth(base, server) {
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error('The server stopped before it was ready');
    try { if ((await fetch(`${base}/api/health`)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('The server did not become ready');
}

/** Run a command, inheriting output. Resolves with its exit code. */
export const run = (cmd, args, env = {}) => new Promise((resolve) => {
  spawn(cmd, args, { stdio: 'inherit', env: { ...process.env, ...env } }).on('exit', (code) => resolve(code ?? 1));
});

/** Calls fn(baseUrl) with a server running on `port` against a new database called `db`. */
export async function withServer({ db, port, env = {}, clientDir = path.join(here, 'no-client') }, fn) {
  await sql(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
  await sql(`CREATE DATABASE ${db}`);
  const dbUrl = new URL(adminUrl);
  dbUrl.pathname = `/${db}`;
  const backups = fs.mkdtempSync(path.join(os.tmpdir(), 'mileage-test-'));
  const server = spawn(process.execPath, [path.join(here, '..', 'src', 'index.js')], {
    stdio: ['ignore', 'ignore', 'inherit'],
    env: {
      ...process.env, ADMIN_USERNAME: '', ...env, DATABASE_URL: dbUrl.href, PORT: String(port),
      JWT_SECRET: 'test-secret-test-secret-test-secret-test', BACKUP_DIR: backups, BACKUP_TIME: 'off', CLIENT_DIR: clientDir,
    },
  });
  try {
    const base = `http://127.0.0.1:${port}`;
    await waitForHealth(base, server);
    return await fn(base);
  } finally {
    server.kill();
    await new Promise((r) => (server.exitCode !== null ? r() : server.once('exit', r)));
    fs.rmSync(backups, { recursive: true, force: true });
    await sql(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`).catch(() => {});
  }
}
