// Time-based one-time passwords (RFC 6238, the kind authenticator apps use): SHA-1, 6 digits, 30 seconds.
import crypto from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;

export function base32Encode(buf) {
  let bits = '';
  for (const b of buf) bits += b.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i < bits.length; i += 5) out += ALPHABET[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
  return out;
}

export function base32Decode(text) {
  let bits = '';
  for (const ch of String(text).toUpperCase().replace(/[^A-Z2-7]/g, '')) bits += ALPHABET.indexOf(ch).toString(2).padStart(5, '0');
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

export const newSecret = () => base32Encode(crypto.randomBytes(20));
export const currentStep = (now = Date.now()) => Math.floor(now / 1000 / STEP_SECONDS);

/** The 6-digit code for a time step. */
export function codeAt(secret, step) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = crypto.createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

/**
 * Check a typed code, allowing the previous and next 30 seconds for clock drift.
 * Returns the matching step, or null. Steps at or before `afterStep` are refused so a code can't be replayed.
 */
export function verifyCode(secret, code, afterStep = 0, now = Date.now()) {
  const typed = String(code ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(typed)) return null;
  const step = currentStep(now);
  for (const s of [step, step - 1, step + 1]) {
    if (s > afterStep && crypto.timingSafeEqual(Buffer.from(codeAt(secret, s)), Buffer.from(typed))) return s;
  }
  return null;
}

/** The link an authenticator app reads, usually from a QR code. */
export function otpauthUri(secret, account, issuer = 'Mileage Tracker') {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`;
}
