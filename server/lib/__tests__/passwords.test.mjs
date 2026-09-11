import { describe, expect, it } from 'vitest';
import { generateTempPassword, hashPassword, verifyPassword } from '../passwords.mjs';

describe('hashPassword / verifyPassword', () => {
  it('verifies the correct password against its own hash', () => {
    const { hash, salt } = hashPassword('correct horse battery staple');
    expect(verifyPassword('correct horse battery staple', hash, salt)).toBe(true);
  });

  it('rejects an incorrect password', () => {
    const { hash, salt } = hashPassword('correct horse battery staple');
    expect(verifyPassword('wrong password', hash, salt)).toBe(false);
  });

  it('never stores the password itself in the hash or salt', () => {
    const { hash, salt } = hashPassword('1234ABCD');
    expect(hash).not.toContain('1234ABCD');
    expect(salt).not.toContain('1234ABCD');
  });

  it('produces a different salt (and therefore hash) each time, even for the same password', () => {
    const a = hashPassword('same password');
    const b = hashPassword('same password');
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
    // Both still verify correctly against their own salt.
    expect(verifyPassword('same password', a.hash, a.salt)).toBe(true);
    expect(verifyPassword('same password', b.hash, b.salt)).toBe(true);
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
