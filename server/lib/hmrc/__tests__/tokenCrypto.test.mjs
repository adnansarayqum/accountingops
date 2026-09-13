import { describe, expect, it } from 'vitest';
import { decryptToken, encryptToken, isEncryptionConfigured } from '../tokenCrypto.mjs';

const key = { HMRC_TOKEN_ENCRYPTION_KEY: 'a-long-random-value-thats-not-your-password-1234567890' };

describe('isEncryptionConfigured', () => {
  it('is true only when a non-blank key is set', () => {
    expect(isEncryptionConfigured(key)).toBe(true);
    expect(isEncryptionConfigured({})).toBe(false);
    expect(isEncryptionConfigured({ HMRC_TOKEN_ENCRYPTION_KEY: '   ' })).toBe(false);
  });
});

describe('encryptToken / decryptToken', () => {
  it('round-trips a token through encryption', () => {
    const stored = encryptToken('super-secret-access-token', key);
    expect(stored).not.toContain('super-secret-access-token');
    expect(stored.startsWith('enc:v1:')).toBe(true);
    expect(decryptToken(stored, key)).toBe('super-secret-access-token');
  });

  it('produces different ciphertext for the same plaintext each time (a fresh IV), but both still decrypt', () => {
    const a = encryptToken('same-value', key);
    const b = encryptToken('same-value', key);
    expect(a).not.toBe(b);
    expect(decryptToken(a, key)).toBe('same-value');
    expect(decryptToken(b, key)).toBe('same-value');
  });

  it('passes a value straight through, unencrypted, when no key is configured', () => {
    expect(encryptToken('plain-value', {})).toBe('plain-value');
    expect(decryptToken('plain-value', {})).toBe('plain-value');
  });

  it('reads a legacy plaintext row as-is even once a key is configured, since it carries no prefix', () => {
    expect(decryptToken('a-token-written-before-encryption-existed', key)).toBe('a-token-written-before-encryption-existed');
  });

  it('passes null and undefined straight through either way', () => {
    expect(encryptToken(null, key)).toBeNull();
    expect(encryptToken(undefined, key)).toBeUndefined();
    expect(decryptToken(null, key)).toBeNull();
    expect(decryptToken(undefined, key)).toBeUndefined();
  });

  it('refuses to decrypt an encrypted value once the key is gone, rather than returning garbage', () => {
    const stored = encryptToken('secret', key);
    expect(() => decryptToken(stored, {})).toThrow();
  });

  it('refuses to decrypt with the wrong key, rather than returning garbage', () => {
    const stored = encryptToken('secret', key);
    expect(() => decryptToken(stored, { HMRC_TOKEN_ENCRYPTION_KEY: 'a-completely-different-key-value-here' })).toThrow();
  });

  it('refuses tampered ciphertext — the auth tag catches it', () => {
    const stored = encryptToken('secret', key);
    const tampered = stored.slice(0, -4) + (stored.slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA');
    expect(() => decryptToken(tampered, key)).toThrow();
  });
});
