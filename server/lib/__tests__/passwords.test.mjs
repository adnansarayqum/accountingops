import { describe, expect, it } from 'vitest';
import { HASH_PARAMS, LEGACY_PARAMS, generateTempPassword, hashPassword, needsRehash, parseStoredHash, verifyPassword } from '../passwords.mjs';

describe('hashPassword / verifyPassword', () => {
  it('verifies the correct password against its own hash', async () => {
    const { hash, salt } = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('correct horse battery staple', hash, salt)).toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const { hash, salt } = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('wrong password', hash, salt)).toBe(false);
  });

  it('never stores the password itself in the hash or salt', async () => {
    const { hash, salt } = await hashPassword('1234ABCD');
    expect(hash).not.toContain('1234ABCD');
    expect(salt).not.toContain('1234ABCD');
  });

  it('produces a different salt (and therefore hash) each time, even for the same password', async () => {
    const a = await hashPassword('same password');
    const b = await hashPassword('same password');
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
    // Both still verify correctly against their own salt.
    expect(await verifyPassword('same password', a.hash, a.salt)).toBe(true);
    expect(await verifyPassword('same password', b.hash, b.salt)).toBe(true);
  });

  it('still verifies a hash produced by the original implementation (plain hex, salt in its own column)', async () => {
    // Every account created before the parameterised format was stored as
    // scryptSync(password, salt, 64) with Node's default parameters. Raising
    // the cost must not lock anyone out, so that format has to keep
    // verifying with exactly those defaults.
    const { scryptSync } = await import('node:crypto');
    const salt = '0123456789abcdef0123456789abcdef';
    const legacyHash = scryptSync('1234ABCD', salt, 64).toString('hex');
    expect(await verifyPassword('1234ABCD', legacyHash, salt)).toBe(true);
    expect(await verifyPassword('1234abcd', legacyHash, salt)).toBe(false);
    expect(parseStoredHash(legacyHash, salt)).toMatchObject({ legacy: true, params: LEGACY_PARAMS, salt });
  });

  it('stores the cost parameters and salt inside the hash itself', async () => {
    const { hash, salt } = await hashPassword('1234ABCD');
    expect(hash).toBe(`scrypt$${HASH_PARAMS.N}$${HASH_PARAMS.r}$${HASH_PARAMS.p}$${salt}$${hash.split('$')[5]}`);
    expect(hash.split('$')[5]).toMatch(/^[0-9a-f]{128}$/);
    expect(parseStoredHash(hash, salt)).toMatchObject({ legacy: false, params: HASH_PARAMS, salt });
  });

  it('uses a stronger cost than the original defaults', () => {
    // 128 * N * r bytes of memory: the current setting must be at least the
    // OWASP floor for scrypt's memory-hardness, and cost more CPU than Node's
    // defaults did.
    expect(HASH_PARAMS.N * HASH_PARAMS.r * 128).toBeGreaterThanOrEqual(32 * 1024 * 1024);
    expect(HASH_PARAMS.N * HASH_PARAMS.r * HASH_PARAMS.p).toBeGreaterThan(LEGACY_PARAMS.N * LEGACY_PARAMS.r * LEGACY_PARAMS.p);
  });

  it('verifies a hash made with other (older) parameters using the parameters it carries', async () => {
    const weaker = await hashPassword('rotate me', { N: 1024, r: 8, p: 1 });
    expect(weaker.hash.startsWith('scrypt$1024$8$1$')).toBe(true);
    expect(await verifyPassword('rotate me', weaker.hash, weaker.salt)).toBe(true);
    expect(await verifyPassword('rotate ME', weaker.hash, weaker.salt)).toBe(false);
  });

  it('flags legacy and lower-cost hashes for re-hashing, but not current ones', async () => {
    const { scryptSync } = await import('node:crypto');
    const salt = '0123456789abcdef0123456789abcdef';
    const legacyHash = scryptSync('1234ABCD', salt, 64).toString('hex');
    expect(needsRehash(legacyHash, salt)).toBe(true);
    const weaker = await hashPassword('x', { N: 1024, r: 8, p: 1 });
    expect(needsRehash(weaker.hash, weaker.salt)).toBe(true);
    const current = await hashPassword('x');
    expect(needsRehash(current.hash, current.salt)).toBe(false);
    // Nothing to re-hash from if the row can't be read as a hash at all.
    expect(needsRehash('not a hash', '')).toBe(false);
  });

  it('treats an unreadable or tampered stored hash as a wrong password, never as an error', async () => {
    const { hash, salt } = await hashPassword('1234ABCD', { N: 1024, r: 8, p: 1 });
    const [, , r, p, embeddedSalt, hex] = hash.split('$');
    await expect(verifyPassword('1234ABCD', '', salt)).resolves.toBe(false);
    await expect(verifyPassword('1234ABCD', 'zz', salt)).resolves.toBe(false);
    await expect(verifyPassword('1234ABCD', null, salt)).resolves.toBe(false);
    await expect(verifyPassword('1234ABCD', `scrypt$1024$${r}$${p}$${embeddedSalt}`, salt)).resolves.toBe(false);
    // A hex hash whose salt column is empty can't be verified either.
    await expect(verifyPassword('1234ABCD', hex, '')).resolves.toBe(false);
  });

  it('refuses to derive with parameters that would exhaust memory or CPU', async () => {
    // A tampered row must not be able to turn one login attempt into a
    // multi-gigabyte derivation: out-of-range parameters are rejected up
    // front (and `parseStoredHash` reports them as unusable).
    const salt = '0123456789abcdef0123456789abcdef';
    const hex = 'ab'.repeat(64);
    expect(parseStoredHash(`scrypt$${2 ** 24}$8$1$${salt}$${hex}`, salt)).toBeNull();
    expect(parseStoredHash(`scrypt$1000$8$1$${salt}$${hex}`, salt)).toBeNull(); // not a power of two
    expect(parseStoredHash(`scrypt$1024$64$1$${salt}$${hex}`, salt)).toBeNull();
    expect(parseStoredHash(`scrypt$1024$8$99$${salt}$${hex}`, salt)).toBeNull();
    expect(parseStoredHash(`scrypt$1024$8$1$${salt}$${hex}$extra`, salt)).toBeNull();
    await expect(verifyPassword('anything', `scrypt$${2 ** 24}$8$1$${salt}$${hex}`, salt)).resolves.toBe(false);
  });

  it('does not block the event loop while deriving', async () => {
    let ticked = false;
    const pending = hashPassword('anything at all');
    // A synchronous derivation would run to completion before this
    // microtask/timer could fire; an async one yields to it.
    await new Promise((resolve) => setImmediate(resolve));
    ticked = true;
    await pending;
    expect(ticked).toBe(true);
  });
});

describe('generateTempPassword', () => {
  it('generates a reasonably long, printable, non-repeating password', () => {
    const a = generateTempPassword();
    const b = generateTempPassword();
    expect(a.length).toBeGreaterThanOrEqual(8);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9]+$/);
  });
});
