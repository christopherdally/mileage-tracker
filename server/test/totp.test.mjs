import assert from 'node:assert/strict';
import { base32Encode, base32Decode, codeAt, verifyCode, currentStep, newSecret, otpauthUri } from '../src/totp.js';

// RFC 6238 appendix B test vectors (SHA-1), truncated to 6 digits.
const secret = base32Encode(Buffer.from('12345678901234567890'));
assert.equal(secret, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
assert.equal(base32Decode(secret).toString(), '12345678901234567890');
assert.equal(base32Decode('gezd gnbv-gy3t qojq').toString(), '1234567890');
for (const [seconds, code] of [[59, '287082'], [1111111109, '081804'], [1111111111, '050471'], [1234567890, '005924'], [2000000000, '279037'], [20000000000, '353130']]) {
  assert.equal(codeAt(secret, currentStep(seconds * 1000)), code);
}

const now = 1_700_000_000_000;
const step = currentStep(now);
assert.equal(verifyCode(secret, codeAt(secret, step), 0, now), step);
assert.equal(verifyCode(secret, ` ${codeAt(secret, step).slice(0, 3)} ${codeAt(secret, step).slice(3)} `, 0, now), step, 'spaces are ignored');
assert.equal(verifyCode(secret, codeAt(secret, step - 1), 0, now), step - 1, 'the previous 30 seconds still count');
assert.equal(verifyCode(secret, codeAt(secret, step + 1), 0, now), step + 1, 'so do the next');
assert.equal(verifyCode(secret, codeAt(secret, step - 2), 0, now), null, 'older codes do not');
assert.equal(verifyCode(secret, codeAt(secret, step), step, now), null, 'a code cannot be used twice');
assert.equal(verifyCode(secret, '12345', 0, now), null);
assert.equal(verifyCode(secret, 'abcdef', 0, now), null);
assert.equal(verifyCode(secret, undefined, 0, now), null);

assert.match(newSecret(), /^[A-Z2-7]{32}$/);
assert.notEqual(newSecret(), newSecret());
assert.equal(otpauthUri('ABC', 'jo@example.com'),
  'otpauth://totp/Mileage%20Tracker%3Ajo%40example.com?secret=ABC&issuer=Mileage%20Tracker&algorithm=SHA1&digits=6&period=30');
console.log('TOTP tests passed');
