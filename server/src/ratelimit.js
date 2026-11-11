// Fixed-window rate limiting, counted in the database so limits survive a restart and hold across replicas.
import { query } from './db.js';
import { HttpError } from './http.js';

const tooMany = () => new HttpError(429, 'Too many attempts. Try again in a few minutes.');

/** Count one attempt against `key`; returns how many there have been in the current window. */
export async function hit(key, windowMs) {
  const { rows } = await query(
    `INSERT INTO rate_limits (key, window_start, count) VALUES ($1, now(), 1)
     ON CONFLICT (key) DO UPDATE SET
       count = CASE WHEN rate_limits.window_start <= now() - make_interval(secs => $2) THEN 1 ELSE rate_limits.count + 1 END,
       window_start = CASE WHEN rate_limits.window_start <= now() - make_interval(secs => $2) THEN now() ELSE rate_limits.window_start END
     RETURNING count`,
    [key, windowMs / 1000]
  );
  return rows[0].count;
}

/** Count an attempt and refuse it once there have been more than `limit` in the window. */
export async function limitAttempts(key, { windowMs, limit }) {
  if ((await hit(key, windowMs)) > limit) throw tooMany();
}

/** Refuse without counting, for limits that only count failures (see hit). */
export async function refuseIfOver(key, { windowMs, limit }) {
  const { rows } = await query(
    'SELECT count FROM rate_limits WHERE key=$1 AND window_start > now() - make_interval(secs => $2)', [key, windowMs / 1000]);
  if (rows[0] && rows[0].count >= limit) throw tooMany();
}

export const clearAttempts = (key) => query('DELETE FROM rate_limits WHERE key=$1', [key]);
