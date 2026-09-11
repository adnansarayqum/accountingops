/**
 * Password hashing. scrypt is built into Node — no extra dependency, no
 * external service, and it's a memory-hard KDF (meaningfully harder to
 * brute-force offline than a plain salted hash).
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const KEY_LENGTH = 64;

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, KEY_LENGTH).toString('hex');
  return { hash, salt };
}

export function verifyPassword(password, hash, salt) {
  const candidate = scryptSync(password, salt, KEY_LENGTH);
  const expected = Buffer.from(hash, 'hex');
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

/** Human-typeable random password for accounts with no configured temp password. */
export function generateTempPassword() {
  return randomBytes(9).toString('base64').replace(/[+/=]/g, '').slice(0, 10);
}
