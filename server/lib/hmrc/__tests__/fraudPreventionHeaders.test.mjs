import { describe, expect, it } from 'vitest';
import { buildFraudPreventionHeaders, CONNECTION_METHOD, encodeComponent, formatTimezone, isComplete, keyValue, keyValueList, missingHeaders, normaliseIp, REQUIRED_HEADERS } from '../fraudPreventionHeaders.mjs';

const device = {
  userAgent: 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36',
  deviceId: 'a1b2c3d4-0000-4000-8000-abcdefabcdef',
  timezone: 'UTC+01:00',
  screens: [{ width: 1920, height: 1080, 'scaling-factor': 1, 'colour-depth': 24 }],
  windowSize: { width: 1440, height: 900 },
};

const complete = () =>
  buildFraudPreventionHeaders({
    device,
    clientPublicIp: '203.0.113.7',
    clientPublicPort: 51234,
    vendorPublicIp: '198.51.100.4',
    forwarded: [{ by: '198.51.100.4', for: '203.0.113.7' }],
    productName: 'Accounting Operations Hub',
    vendorVersion: { 'accounting-operations-hub': '0.1.0' },
    licenseIds: { 'accounting-operations-hub': 'none' },
    userIds: { 'accounting-operations-hub': 'u_adnan' },
    multiFactor: [],
    now: () => new Date('2026-09-12T17:00:00.000Z'),
  });

describe('encoding', () => {
  it('percent-encodes keys and values but not the separators', () => {
    expect(keyValue({ 'my key': 'a value//with?chars' })).toBe('my%20key=a%20value%2F%2Fwith%3Fchars');
    expect(keyValue({ width: 1920, height: 1080 })).toBe('width=1920&height=1080');
  });

  it('drops a pair with no value rather than sending a malformed "key="', () => {
    expect(keyValue({ width: 1920, height: undefined, depth: '' })).toBe('width=1920');
  });

  it('comma-separates a list of structures, as for two screens or two hops', () => {
    expect(keyValueList([{ width: 1920, height: 1080 }, { width: 3000, height: 2000 }])).toBe('width=1920&height=1080,width=3000&height=2000');
  });

  it('renders an empty list as an empty string, not as a stray comma', () => {
    expect(keyValueList([])).toBe('');
    expect(keyValueList([{}, { a: 1 }])).toBe('a=1');
  });

  it('encodes a bare component', () => {
    expect(encodeComponent('Accounting Operations Hub')).toBe('Accounting%20Operations%20Hub');
  });
});

describe('formatTimezone', () => {
  it('formats as UTC±hh:mm from the offset JavaScript reports, which is inverted', () => {
    // Date#getTimezoneOffset returns -60 for UTC+1.
    expect(formatTimezone(-60)).toBe('UTC+01:00');
    expect(formatTimezone(0)).toBe('UTC+00:00');
    expect(formatTimezone(300)).toBe('UTC-05:00');
  });

  it('handles a half-hour offset', () => {
    expect(formatTimezone(-330)).toBe('UTC+05:30');
    expect(formatTimezone(-345)).toBe('UTC+05:45');
  });

  it('returns null for something that is not an offset, rather than "UTCNaN"', () => {
    expect(formatTimezone(undefined)).toBeNull();
    expect(formatTimezone('nope')).toBeNull();
  });
});

describe('normaliseIp', () => {
  it('unwraps an IPv4-mapped IPv6 address, which is what Node reports behind a proxy', () => {
    expect(normaliseIp('::ffff:203.0.113.7')).toBe('203.0.113.7');
  });

  it('leaves a real IPv4 or IPv6 address alone', () => {
    expect(normaliseIp('203.0.113.7')).toBe('203.0.113.7');
    expect(normaliseIp('2001:db8::1')).toBe('2001:db8::1');
  });

  it('returns null for nothing', () => {
    expect(normaliseIp('')).toBeNull();
    expect(normaliseIp(undefined)).toBeNull();
  });
});

describe('buildFraudPreventionHeaders', () => {
  it('produces every header HMRC require for a web app calling via its own server', () => {
    const headers = complete();
    expect(missingHeaders(headers)).toEqual([]);
    expect(isComplete(headers)).toBe(true);
    expect(Object.keys(headers).sort()).toEqual([...REQUIRED_HEADERS].sort());
  });

  it('names the connection method HMRC define for this architecture', () => {
    expect(complete()['Gov-Client-Connection-Method']).toBe(CONNECTION_METHOD);
    expect(CONNECTION_METHOD).toBe('WEB_APP_VIA_SERVER');
  });

  it('formats the device values the way the validator expects', () => {
    const headers = complete();
    expect(headers['Gov-Client-Screens']).toBe('width=1920&height=1080&scaling-factor=1&colour-depth=24');
    expect(headers['Gov-Client-Window-Size']).toBe('width=1440&height=900');
    expect(headers['Gov-Client-Timezone']).toBe('UTC+01:00');
    expect(headers['Gov-Client-Public-Port']).toBe('51234');
  });

  it('timestamps the client IP in ISO 8601 UTC', () => {
    expect(complete()['Gov-Client-Public-IP-Timestamp']).toBe('2026-09-12T17:00:00.000Z');
  });

  it('keeps an empty multi-factor list, which is the real answer when no MFA is in play', () => {
    const headers = complete();
    expect(headers['Gov-Client-Multi-Factor']).toBe('');
    expect(missingHeaders(headers)).toEqual([]);
  });

  it('carries a multi-factor entry through when there is one', () => {
    const headers = buildFraudPreventionHeaders({ ...{ device }, multiFactor: [{ type: 'TOTP', 'unique-reference': 'abc' }] });
    expect(headers['Gov-Client-Multi-Factor']).toBe('type=TOTP&unique-reference=abc');
  });

  it('unwraps a proxied client IP so HMRC get the address the user actually has', () => {
    const headers = buildFraudPreventionHeaders({ device, clientPublicIp: '::ffff:203.0.113.7' });
    expect(headers['Gov-Client-Public-IP']).toBe('203.0.113.7');
  });
});

describe('missingHeaders', () => {
  it('names exactly what is absent, so a partial set is never sent by accident', () => {
    const headers = buildFraudPreventionHeaders({ device: { deviceId: 'x' }, multiFactor: [] });
    const missing = missingHeaders(headers);
    expect(missing).toContain('Gov-Client-Screens');
    expect(missing).toContain('Gov-Client-Public-IP');
    expect(missing).toContain('Gov-Vendor-Version');
    expect(missing).not.toContain('Gov-Client-Device-ID');
    expect(missing).not.toContain('Gov-Client-Connection-Method');
    expect(isComplete(headers)).toBe(false);
  });

  it('agrees with what build produces — a header build drops must read as missing', () => {
    const headers = buildFraudPreventionHeaders({});
    // Only the two the server always knows survive an empty input.
    expect(Object.keys(headers).sort()).toEqual(['Gov-Client-Connection-Method', 'Gov-Client-Multi-Factor', 'Gov-Client-Public-IP-Timestamp'].sort());
    expect(missingHeaders(headers).length).toBe(REQUIRED_HEADERS.length - 3);
  });

  it('treats an explicitly empty string as missing for every header but multi-factor', () => {
    expect(missingHeaders({ ...complete(), 'Gov-Client-Device-ID': '' })).toEqual(['Gov-Client-Device-ID']);
  });
});
