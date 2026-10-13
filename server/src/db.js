import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Return DATE columns as plain 'YYYY-MM-DD' strings (no timezone shifting).
pg.types.setTypeParser(1082, (v) => v);
// Return NUMERIC as JS numbers (values here are small: miles and pence).
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

export const query = (text, params) => pool.query(text, params);

export async function migrate() {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const sql = fs.readFileSync(path.join(dir, 'schema.sql'), 'utf8');
  await pool.query(sql);
}

export async function withTx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
