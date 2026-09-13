/**
 * At-rest encryption for the HMRC agent's OAuth tokens.
 *
 * hmrc_agent_tokens holds one row that, in the wrong hands, is enough to
 * pull VAT data for every client the practice has appointed — a database
 * dump, a backup, a replica, or a future SQL-injection bug elsewhere would
 * otherwise hand that over as plain text. AES-256-GCM, keyed by
 * HMRC_TOKEN_ENCRYPTION_KEY, closes that off.
 *
 * Deliberately backward-compatible in both directions:
 *  - No key configured: encrypt/decrypt are a no-op, so an existing
 *    deployment (sandbox or otherwise) that has not set the variable yet
 *    keeps working exactly as before. `isEncryptionConfigured` lets the
 *    /status route say so, rather than the app silently running with a
 *    weaker posture than it looks like it has.
 *  - A key is configured, but a row was written before this existed: the
 *    stored value has no `enc:v1:` prefix, so it is read back as plain
 *    text rather than failing to decrypt. The next write re-encrypts it —
 *    no manual migration step.
 *
 * The key itself is not stored as a raw AES key: any string works
 * (`openssl rand -hex 32` is what .env.example recommends), and it is run
 * through SHA-256 to get a fixed 32-byte key. This defends against a
 * database compromise, which is the actual threat here — it is not meant
 * to resist someone who also has the key.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const PREFIX = 'enc:v1:';

function keyFrom(secret) {
  return createHash('sha256').update(secret, 'utf8').digest();
}

export function isEncryptionConfigured(env = process.env) {
  return Boolean(env.HMRC_TOKEN_ENCRYPTION_KEY?.trim());
}

/** Encrypts a token for storage. Passed through unchanged when no key is configured, or the value is nullish. */
export function encryptToken(plaintext, env = process.env) {
  if (plaintext === null || plaintext === undefined) return plaintext;
  const secret = env.HMRC_TOKEN_ENCRYPTION_KEY?.trim();
  if (!secret) return plaintext;
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, keyFrom(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

/**
 * Reverses `encryptToken`. A value with no `enc:v1:` prefix is assumed to
 * be a legacy plaintext row (or encryption is simply not in use) and is
 * returned as-is — this must never throw on ordinary, unencrypted data.
 */
export function decryptToken(stored, env = process.env) {
  if (stored === null || stored === undefined) return stored;
  if (!stored.startsWith(PREFIX)) return stored;
  const secret = env.HMRC_TOKEN_ENCRYPTION_KEY?.trim();
  if (!secret) {
    const err = new Error('hmrc_token_encryption_key_missing');
    err.code = 'encryption_key_missing';
    throw err;
  }
  const raw = Buffer.from(stored.slice(PREFIX.length), 'base64');
  const iv = raw.subarray(0, IV_LENGTH);
  const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = raw.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, keyFrom(secret), iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}
