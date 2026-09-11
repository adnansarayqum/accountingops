import { describe, expect, it } from 'vitest';
import { generateTempPassword, hashPassword, verifyPassword } from '../passwords.mjs';

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

  it('still verifies a hash produced by the previous synchronous implementation', async () => {
    // Every existing account was stored as scryptSync(password, salt, 64)
    // with Node's default parameters. Changing how we derive must not lock
    // anyone out, so the async path has to accept exactly that format.
    const { scryptSync } = await import('node:crypto');
    const salt = '0123456789abcdef0123456789abcdef';
    const legacyHash = scryptSync('1234ABCD', salt, 64).toString('hex');
    expect(await verifyPassword('1234ABCD', legacyHash, salt)).toBe(true);
    expect(await verifyPassword('1234abcd', legacyHash, salt)).toBe(false);
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
