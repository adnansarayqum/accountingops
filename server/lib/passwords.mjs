import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
const KEY_LENGTH = 64;

/**
 * Current cost parameters — one of the OWASP-recommended scrypt settings
 * (N=2^15, r=8, p=3: ~32 MB of memory and roughly 0.3 s on a small server;
 * see docs/ARCHITECTURE.md → Security posture). Raising these later is safe:
 * every stored hash carries the parameters it was made with, so old
 * passwords keep verifying and are re-hashed at the new cost on the next
 * successful sign-in (see `needsRehash`).
 */
export const HASH_PARAMS = Object.freeze({ N: 32768, r: 8, p: 3 });

/**
 * Parameters Node's scrypt uses when none are given — what every hash
 * stored before the parameterised format was introduced was derived with.
 * They are verified with exactly these so nobody is locked out.
 */
export const LEGACY_PARAMS = Object.freeze({ N: 16384, r: 8, p: 1 });

// Upper bounds a stored hash's parameters must stay under before we'll
// derive with them — a tampered row must not be able to make one login
// attempt eat gigabytes of memory or minutes of CPU.
const MAX_N = 2 ** 20;
const MAX_R = 32;
const MAX_P = 16;

const FORMAT_PREFIX = 'scrypt';

function maxmemFor({ N, r }) {
  // Node rejects the derivation when (approximately) 128 * N * r > maxmem;
  // give it twice the headroom so the estimate's slack never trips it.
  return 128 * N * r * 2;
}

function formatHash({ N, r, p }, salt, derived) {
  return [FORMAT_PREFIX, N, r, p, salt, derived.toString('hex')].join('$');
}

/**
 * Reads a stored hash back into its parts. Accepts both the current
 * self-describing format (`scrypt$N$r$p$salt$hex`) and the original plain
 * hex hash whose salt lived only in the `password_salt` column (derived
 * with Node's default parameters). Returns null for anything that is not a
 * usable hash, rather than throwing, so a corrupted row reads as "wrong
 * password" instead of a 500.
 */
export function parseStoredHash(hash, salt) {
  if (typeof hash !== 'string' || hash.length === 0) return null;
  if (!hash.startsWith(`${FORMAT_PREFIX}$`)) {
    if (typeof salt !== 'string' || salt.length === 0) return null;
    if (!/^[0-9a-f]+$/i.test(hash)) return null;
    return { params: { ...LEGACY_PARAMS }, salt, hash, legacy: true };
  }
  const parts = hash.split('$');
  if (parts.length !== 6) return null;
  const [, nText, rText, pText, storedSalt, hex] = parts;
  const N = Number(nText);
  const r = Number(rText);
  const p = Number(pText);
  const isPowerOfTwo = Number.isInteger(N) && N > 1 && (N & (N - 1)) === 0;
  if (!isPowerOfTwo || N > MAX_N) return null;
  if (!Number.isInteger(r) || r < 1 || r > MAX_R) return null;
  if (!Number.isInteger(p) || p < 1 || p > MAX_P) return null;
  if (!storedSalt || !/^[0-9a-f]+$/i.test(hex)) return null;
  return { params: { N, r, p }, salt: storedSalt, hash: hex, legacy: false };
}

/**
 * Async on purpose: the synchronous variant blocks the event loop for the
 * whole derivation, so a burst of login attempts would stall every other
 * request the server was handling. Returns the self-describing hash plus
 * the salt on its own, because the `password_salt` column is still
 * populated for every row (the salt is also embedded in the hash).
 */
export async function hashPassword(password, params = HASH_PARAMS) {
  const salt = randomBytes(16).toString('hex');
  const derived = await scryptAsync(password, salt, KEY_LENGTH, { ...params, maxmem: maxmemFor(params) });
  return { hash: formatHash(params, salt, derived), salt };
}

export async function verifyPassword(password, hash, salt) {
  const parsed = parseStoredHash(hash, salt);
  if (!parsed) return false;
  const expected = Buffer.from(parsed.hash, 'hex');
  if (expected.length !== KEY_LENGTH) return false;
  const candidate = await scryptAsync(password, parsed.salt, KEY_LENGTH, { ...parsed.params, maxmem: maxmemFor(parsed.params) });
  return timingSafeEqual(candidate, expected);
}

/**
 * True when a stored hash was made with anything other than the current
 * parameters (the legacy plain-hex format included), i.e. it should be
 * re-derived at the current cost the next time the password is known to be
 * correct. Unparseable hashes report false: there is no correct password to
 * re-hash them from.
 */
export function needsRehash(hash, salt) {
  const parsed = parseStoredHash(hash, salt);
  if (!parsed) return false;
  if (parsed.legacy) return true;
  return parsed.params.N !== HASH_PARAMS.N || parsed.params.r !== HASH_PARAMS.r || parsed.params.p !== HASH_PARAMS.p;
}

export function generateTempPassword() {
  return randomBytes(9).toString('base64').replace(/[+/=]/g, '').slice(0, 10);
}
