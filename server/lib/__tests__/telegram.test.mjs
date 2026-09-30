import { describe, expect, it } from 'vitest';
import { generateLinkCode, hashLinkCode, isTelegramConfigured, LINK_CODE_BYTES, parseStartCommand, verifyWebhookSecret } from '../telegram.mjs';

describe('link codes', () => {
  it('are short uppercase hex, and never the same twice', () => {
    const a = generateLinkCode();
    expect(a).toMatch(new RegExp(`^[0-9A-F]{${LINK_CODE_BYTES * 2}}$`));
    expect(generateLinkCode()).not.toBe(a);
  });

  it('hash the same regardless of case or surrounding whitespace, so a hand-typed code still matches', () => {
    const code = generateLinkCode();
    const hash = hashLinkCode(code);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain(code.toLowerCase());
    expect(hashLinkCode(`  ${code.toLowerCase()} `)).toBe(hash);
    expect(hashLinkCode('OTHER12345')).not.toBe(hash);
  });
});

describe('verifyWebhookSecret', () => {
  const secret = 'a'.repeat(64);

  it('accepts only the exact secret', () => {
    expect(verifyWebhookSecret(secret, secret)).toBe(true);
    expect(verifyWebhookSecret(`${'a'.repeat(63)}b`, secret)).toBe(false);
  });

  it('rejects a different length without throwing', () => {
    expect(verifyWebhookSecret('short', secret)).toBe(false);
    expect(verifyWebhookSecret(`${secret}a`, secret)).toBe(false);
  });

  it('refuses everything when no header arrives or no secret is configured', () => {
    expect(verifyWebhookSecret(undefined, secret)).toBe(false);
    expect(verifyWebhookSecret('', secret)).toBe(false);
    expect(verifyWebhookSecret('', '')).toBe(false);
    expect(verifyWebhookSecret('anything', undefined)).toBe(false);
  });
});

describe('parseStartCommand', () => {
  it('reads the code from /start, with or without the bot-name suffix', () => {
    expect(parseStartCommand('/start ABC1234567')).toEqual({ code: 'ABC1234567' });
    expect(parseStartCommand('  /start   ABC1234567  ')).toEqual({ code: 'ABC1234567' });
    expect(parseStartCommand('/start@FarhanRaihanBot ABC1234567')).toEqual({ code: 'ABC1234567' });
    expect(parseStartCommand('/start ABC1234567 thanks')).toEqual({ code: 'ABC1234567' });
  });

  it('treats a bare /start as an open with no code yet', () => {
    expect(parseStartCommand('/start')).toEqual({ code: null });
  });

  it('ignores anything that is not /start', () => {
    for (const text of ['hello', '/help', 'start ABC', '/started', undefined, null, 42]) {
      expect(parseStartCommand(text)).toBeNull();
    }
  });
});

describe('isTelegramConfigured', () => {
  it('needs both the bot token and the webhook secret', () => {
    expect(isTelegramConfigured({})).toBe(false);
    expect(isTelegramConfigured({ TELEGRAM_BOT_TOKEN: 't' })).toBe(false);
    expect(isTelegramConfigured({ TELEGRAM_WEBHOOK_SECRET: 's' })).toBe(false);
    expect(isTelegramConfigured({ TELEGRAM_BOT_TOKEN: 't', TELEGRAM_WEBHOOK_SECRET: 's' })).toBe(true);
  });
});
