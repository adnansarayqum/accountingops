import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
const KEY_LENGTH = 64;

/**
 * Async on purpose: the synchronous variant blocks the event loop for the
 * whole derivation (~50–100 ms), so a burst of login attempts would stall
 * every other request the server was handling. The cost parameters are
 * Node's defaults; raising them is a stored-format change (parameters must
 * be kept per hash so existing passwords still verify) and is tracked
 * separately.
 */
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const derived = await scryptAsync(password, salt, KEY_LENGTH);
  return { hash: derived.toString('hex'), salt };
}

export async function verifyPassword(password, hash, salt) {
  const candidate = await scryptAsync(password, salt, KEY_LENGTH);
  const expected = Buffer.from(hash, 'hex');
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

export function generateTempPassword() {
  return randomBytes(9).toString('base64').replace(/[+/=]/g, '').slice(0, 10);
}
