// Database backups with pg_dump to a local folder and/or any S3-compatible bucket.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { query } from './db.js';

const env = process.env;
export const BACKUP_DIR = path.resolve(env.BACKUP_DIR || '/backups');
const KEEP = Math.max(1, Number(env.BACKUP_KEEP || 30));

/** BACKUP_TARGET = local | s3 | both */
export function defaultTargets() {
  const t = (env.BACKUP_TARGET || 'local').toLowerCase();
  if (t === 'both') return ['local', 's3'];
  return [t === 's3' ? 's3' : 'local'];
}
export const s3Configured = () => !!env.S3_BUCKET;

// ── S3 (AWS, MinIO, Backblaze B2, Wasabi, Cloudflare R2…) ──
let s3mod;
let s3client;
async function s3() {
  if (!s3mod) {
    try {
      s3mod = await import('@aws-sdk/client-s3');
    } catch {
      throw new Error('S3 support is not installed (npm install @aws-sdk/client-s3)');
    }
    s3client = new s3mod.S3Client({
      region: env.S3_REGION || 'eu-west-2',
      endpoint: env.S3_ENDPOINT || undefined,
      forcePathStyle: env.S3_FORCE_PATH_STYLE === 'true',
      // Credentials: AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY, or an instance role.
    });
  }
  return { m: s3mod, c: s3client };
}
const s3Prefix = () => (env.S3_PREFIX ?? 'mileage-tracker/').replace(/^\/+/, '');

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { env: process.env });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('error', (e) => reject(e.code === 'ENOENT' ? new Error(`${cmd} is not installed on the server`) : e));
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.trim() || `${cmd} exited with ${code}`))));
  });
}

async function record(row) {
  await query(
    `INSERT INTO backups (filename,target,location,size_bytes,status,error,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [row.filename, row.target, row.location || '-', row.size ?? null, row.status, row.error ?? null, row.createdBy]
  );
}

async function pruneLocal() {
  const files = (await fsp.readdir(BACKUP_DIR)).filter((f) => /^mileage-.*\.dump$/.test(f)).sort();
  for (const f of files.slice(0, Math.max(0, files.length - KEEP))) {
    await fsp.unlink(path.join(BACKUP_DIR, f)).catch(() => {});
  }
}

async function pruneS3() {
  const { m, c } = await s3();
  const list = await c.send(new m.ListObjectsV2Command({ Bucket: env.S3_BUCKET, Prefix: s3Prefix() }));
  const keys = (list.Contents || []).map((o) => o.Key).filter((k) => /mileage-.*\.dump$/.test(k)).sort();
  const old = keys.slice(0, Math.max(0, keys.length - KEEP));
  if (old.length) {
    await c.send(new m.DeleteObjectsCommand({ Bucket: env.S3_BUCKET, Delete: { Objects: old.map((Key) => ({ Key })) } }));
  }
}

/** Dump the whole database (pg_dump custom format, compressed) and store it in each target. */
export async function runBackup({ targets = defaultTargets(), createdBy = 'schedule' } = {}) {
  // Millisecond timestamp plus a random suffix: names sort chronologically and can never collide.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23);
  const filename = `mileage-${stamp}-${crypto.randomBytes(3).toString('hex')}.dump`;
  const tmp = path.join(os.tmpdir(), filename);
  const results = [];

  try {
    await run('pg_dump', ['--format=custom', '--no-owner', '--no-privileges', '--file', tmp, env.DATABASE_URL]);
  } catch (e) {
    for (const target of targets) {
      const row = { filename, target, status: 'failed', error: e.message, createdBy };
      await record(row);
      results.push(row);
    }
    return results;
  }
  const size = (await fsp.stat(tmp)).size;

  for (const target of targets) {
    const row = { filename, target, size, createdBy };
    try {
      if (target === 'local') {
        await fsp.mkdir(BACKUP_DIR, { recursive: true });
        row.location = path.join(BACKUP_DIR, filename);
        await fsp.copyFile(tmp, row.location, fs.constants.COPYFILE_EXCL);
        await pruneLocal();
      } else if (target === 's3') {
        if (!s3Configured()) throw new Error('S3_BUCKET is not set');
        const { m, c } = await s3();
        const Key = s3Prefix() + filename;
        await c.send(new m.PutObjectCommand({
          Bucket: env.S3_BUCKET, Key, Body: fs.createReadStream(tmp), ContentLength: size,
          ContentType: 'application/octet-stream', ServerSideEncryption: env.S3_SSE || undefined,
        }));
        row.location = `s3://${env.S3_BUCKET}/${Key}`;
        await pruneS3();
      } else {
        throw new Error(`Unknown backup target "${target}"`);
      }
      row.status = 'ok';
    } catch (e) {
      row.status = 'failed';
      row.error = e.message;
    }
    await record(row);
    results.push(row);
  }
  await fsp.unlink(tmp).catch(() => {});
  return results;
}

/** Make a backup available as a local file (downloading it from S3 if needed). */
export async function fetchBackupFile(b) {
  if (b.target === 'local') {
    // Only ever read from inside the backup folder.
    const p = path.resolve(b.location);
    if (!p.startsWith(BACKUP_DIR + path.sep) || !fs.existsSync(p)) throw new Error('Backup file is no longer on disk');
    return { path: p, temp: false };
  }
  const match = /^s3:\/\/([^/]+)\/(.+)$/.exec(b.location);
  if (!match) throw new Error('Bad S3 location');
  const { m, c } = await s3();
  const obj = await c.send(new m.GetObjectCommand({ Bucket: match[1], Key: match[2] }));
  const tmp = path.join(os.tmpdir(), `restore-${Date.now()}-${path.basename(b.filename)}`);
  await pipeline(obj.Body, fs.createWriteStream(tmp));
  return { path: tmp, temp: true };
}

/** Replace the database contents with a backup, then tell devices to re-download. */
export async function restoreBackup(b) {
  const file = await fetchBackupFile(b);
  // The backup log lives in the same database; keep today's log rather than the restored (older) one.
  const { rows: log } = await query('SELECT * FROM backups ORDER BY id');
  try {
    await run('pg_restore', ['--clean', '--if-exists', '--no-owner', '--no-privileges', '--single-transaction',
      '--dbname', env.DATABASE_URL, file.path]);
    await query("UPDATE meta SET value = gen_random_uuid()::text WHERE key='data_epoch'");
    await query('TRUNCATE backups');
    for (const r of log) {
      await query(
        `INSERT INTO backups (id,filename,target,location,size_bytes,status,error,created_by,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [r.id, r.filename, r.target, r.location, r.size_bytes, r.status, r.error, r.created_by, r.created_at]
      );
    }
    await query("SELECT setval(pg_get_serial_sequence('backups','id'), GREATEST((SELECT max(id) FROM backups), 1))");
    await query('INSERT INTO backups (filename,target,location,status,created_by) VALUES ($1,$2,$3,$4,$5)',
      [b.filename, b.target, b.location, 'restored', 'restore']);
  } finally {
    if (file.temp) await fsp.unlink(file.path).catch(() => {});
  }
}

// ── Schedule: BACKUP_TIME=HH:MM (server local time, TZ env) runs daily. Empty or "off" disables. ──
export function backupSchedule() {
  const t = (env.BACKUP_TIME ?? '02:00').trim();
  return /^([01]?\d|2[0-3]):[0-5]\d$/.test(t) ? `daily at ${t}` : 'off';
}

export function startBackupSchedule() {
  const t = (env.BACKUP_TIME ?? '02:00').trim();
  if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(t)) {
    if (t && t !== 'off') console.warn(`BACKUP_TIME "${t}" is not HH:MM; scheduled backups are off.`);
    return;
  }
  const [h, mi] = t.split(':').map(Number);
  const scheduleNext = () => {
    const now = new Date();
    const next = new Date(now);
    next.setHours(h, mi, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    setTimeout(async () => {
      try {
        const results = await runBackup({ createdBy: 'schedule' });
        for (const r of results) console.log(`Scheduled backup to ${r.target}: ${r.status} ${r.location || ''} ${r.error || ''}`);
      } catch (e) {
        console.error('Scheduled backup failed:', e);
      }
      scheduleNext();
    }, next - now);
  };
  scheduleNext();
  console.log(`Scheduled backups: daily at ${t} (${env.TZ || 'server time'})`);
}


// User report PDFs are separate from rotating database dumps and never auto-pruned.
export async function putReportObject(Key, Body) {
  const { m, c } = await s3();
  await c.send(new m.PutObjectCommand({ Bucket: env.S3_BUCKET, Key, Body, ContentType: 'application/pdf', ServerSideEncryption: env.S3_SSE || undefined }));
}
export async function getReportObject(Key) {
  const { m, c } = await s3();
  const obj = await c.send(new m.GetObjectCommand({ Bucket: env.S3_BUCKET, Key }));
  return Buffer.from(await obj.Body.transformToByteArray());
}
export async function deleteReportObject(Key) {
  const { m, c } = await s3();
  await c.send(new m.DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key }));
}
export const reportObjectKey = (userId, id) => `${s3Prefix().replace(/\/?$/, '/')}reports/${userId}/${id}.pdf`;
