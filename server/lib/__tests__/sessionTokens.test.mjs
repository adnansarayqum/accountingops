import { describe, expect, it } from 'vitest';
import { hashSessionToken } from '../sessionTokens.mjs';

describe('hashSessionToken', () => {
  it('is deterministic for the same token', () => {
    const token = 'abc123';
    expect(hashSessionToken(token)).toBe(hashSessionToken(token));
  });

  it('differs for different tokens', () => {
    expect(hashSessionToken('token-a')).not.toBe(hashSessionToken('token-b'));
  });

  it('never contains the original token, and looks like a hex digest', () => {
    const token = 'super-secret-session-token';
    const hash = hashSessionToken(token);
    expect(hash).not.toContain(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
