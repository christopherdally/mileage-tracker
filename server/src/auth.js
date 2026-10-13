// Passwords: scrypt. Sessions: HMAC-SHA256 signed tokens (JWT format). No external packages.
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { query } from './db.js';
import { HttpError } from './http.js';

const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, keyB64] = parts;
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length,
    { N: Number(N), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 });
  return crypto.timingSafeEqual(key, expected);
}

// Used when a username doesn't exist, so a failed login takes the same time either way.
export const DUMMY_HASH = await hashPassword(crypto.randomBytes(16).toString('hex'));

function secret() {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 32) throw new Error('JWT_SECRET must be set to at least 32 characters');
  return s;
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const TTL_DAYS = Number(process.env.SESSION_DAYS || 60); // long so the app keeps working offline

export function signToken(user) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(JSON.stringify({ sub: user.id, v: user.token_version, iat: now, exp: now + TTL_DAYS * 86400 }));
  const sig = crypto.createHmac('sha256', secret()).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

function verifyToken(token) {
  const [h, p, s] = String(token).split('.');
  if (!h || !p || !s) return null;
  const expected = crypto.createHmac('sha256', secret()).update(`${h}.${p}`).digest();
  const given = Buffer.from(s, 'base64url');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function authenticate(req) {
  const header = req.headers.authorization || '';
  const payload = header.startsWith('Bearer ') ? verifyToken(header.slice(7)) : null;
  if (!payload) throw new HttpError(401, 'Please log in again');
  const { rows } = await query('SELECT * FROM users WHERE id = $1', [payload.sub]);
  const user = rows[0];
  if (!user || !user.is_active || user.token_version !== payload.v) throw new HttpError(401, 'Please log in again');
  return user;
}

export async function authenticateAdmin(req) {
  const user = await authenticate(req);
  if (!user.is_admin) throw new HttpError(403, 'Admins only');
  return user;
}

export function publicUser(u) {
  return {
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    isAdmin: u.is_admin,
    isActive: u.is_active,
    vehicle: u.vehicle,
    mustChangePassword: !!u.must_change_password,
    createdAt: u.created_at,
  };
}
