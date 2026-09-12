import { createHash } from 'node:crypto';

/**
 * Session tokens are stored hashed, never raw — a database read (a backup,
 * a compromised replica, an operator with read access to Postgres but not
 * to the app) must not hand out a working session merely by reading a row.
 * The token itself is 256 bits from crypto.randomBytes, so a fast hash is
 * fine here: unlike a password, there is nothing a slow KDF would protect
 * against — nobody is going to brute-force a random 256-bit value from its
 * hash. Only the raw token in the cookie can ever produce a match.
 */
export function hashSessionToken(token) {
  return createHash('sha256').update(token).digest('hex');
}
