import { describe, expect, it } from 'vitest';
import { isValidVrn, mapErrorCode, mapObligation, mapObligations, normaliseVrn, obligationsQuery, openObligations } from '../vatObligations.mjs';

// The example body from HMRC's own published OpenAPI spec.
const HMRC_EXAMPLE = {
  obligations: [
    { start: '2017-01-01', end: '2017-03-31', due: '2017-05-07', status: 'F', periodKey: '18A1', received: '2017-05-06' },
    { start: '2017-04-01', end: '2017-06-30', due: '2017-08-07', status: 'O', periodKey: '18A2' },
  ],
};

describe('mapObligation', () => {
  it('maps HMRC’s fields onto the app’s, keeping the period key exactly as sent', () => {
    expect(mapObligation(HMRC_EXAMPLE.obligations[0])).toEqual({
      periodStart: '2017-01-01',
      periodEnd: '2017-03-31',
      dueDate: '2017-05-07',
      periodKey: '18A1',
      fulfilled: true,
      receivedOn: '2017-05-06',
    });
  });

  it('keeps a period key containing "#", which HMRC document as possible', () => {
    expect(mapObligation({ ...HMRC_EXAMPLE.obligations[1], periodKey: '#001' })?.periodKey).toBe('#001');
  });

  it('treats anything other than F as still to file', () => {
    expect(mapObligation(HMRC_EXAMPLE.obligations[1])?.fulfilled).toBe(false);
    expect(mapObligation({ ...HMRC_EXAMPLE.obligations[1], status: 'O' })?.fulfilled).toBe(false);
  });

  it('skips an obligation missing a date the app needs, rather than inventing one', () => {
    for (const bad of [{ due: undefined }, { start: undefined }, { end: '31/03/2017' }, { due: '' }]) {
      expect(mapObligation({ ...HMRC_EXAMPLE.obligations[0], ...bad })).toBeNull();
    }
  });

  it('skips an obligation with no period key, since every later call needs it', () => {
    expect(mapObligation({ ...HMRC_EXAMPLE.obligations[0], periodKey: '  ' })).toBeNull();
    expect(mapObligation({ ...HMRC_EXAMPLE.obligations[0], periodKey: undefined })).toBeNull();
  });

  it('has no received date when the return has not been filed', () => {
    expect(mapObligation(HMRC_EXAMPLE.obligations[1])?.receivedOn).toBeNull();
  });

  it('is null for nothing at all', () => {
    expect(mapObligation(null)).toBeNull();
    expect(mapObligation('nope')).toBeNull();
  });
});

describe('mapObligations', () => {
  it('maps a whole response', () => {
    expect(mapObligations(HMRC_EXAMPLE).map((o) => o.periodKey)).toEqual(['18A1', '18A2']);
  });

  it('orders by period start rather than trusting the upstream order', () => {
    const scrambled = { obligations: [HMRC_EXAMPLE.obligations[1], HMRC_EXAMPLE.obligations[0]] };
    expect(mapObligations(scrambled).map((o) => o.periodKey)).toEqual(['18A1', '18A2']);
  });

  it('drops unusable entries but keeps the rest', () => {
    expect(mapObligations({ obligations: [HMRC_EXAMPLE.obligations[0], { start: 'x' }] })).toHaveLength(1);
  });

  it('is empty for a body with no obligations, however malformed', () => {
    for (const body of [{}, null, { obligations: null }, { obligations: 'nope' }]) {
      expect(mapObligations(body)).toEqual([]);
    }
  });
});

describe('openObligations', () => {
  it('keeps only what is still to file', () => {
    expect(openObligations(HMRC_EXAMPLE).map((o) => o.periodKey)).toEqual(['18A2']);
  });
});

describe('VRN handling', () => {
  it('accepts exactly nine digits', () => {
    expect(isValidVrn('123456789')).toBe(true);
    expect(isValidVrn('12345678')).toBe(false);
    expect(isValidVrn('1234567890')).toBe(false);
    expect(isValidVrn('12345678A')).toBe(false);
  });

  it('reduces a VAT number as a practice writes it to the nine digits HMRC want', () => {
    expect(normaliseVrn('GB 123 4567 89')).toBe('123456789');
    expect(normaliseVrn('GB123456789')).toBe('123456789');
    expect(normaliseVrn('123456789')).toBe('123456789');
  });

  it('returns null rather than a half-stripped string when what is left is not a VRN', () => {
    expect(normaliseVrn('GB12345')).toBeNull();
    expect(normaliseVrn('not a vat number')).toBeNull();
    expect(normaliseVrn(undefined)).toBeNull();
  });
});

describe('obligationsQuery', () => {
  it('asks for open obligations with no date range, the one case HMRC allow it', () => {
    expect(obligationsQuery({ status: 'open' })).toBe('status=O');
  });

  it('sends the range when asking for anything other than open only', () => {
    expect(obligationsQuery({ status: 'fulfilled', from: '2026-01-01', to: '2026-12-31' })).toBe('status=F&from=2026-01-01&to=2026-12-31');
    expect(obligationsQuery({ from: '2026-01-01', to: '2026-12-31' })).toBe('from=2026-01-01&to=2026-12-31');
  });

  it('refuses to build a query HMRC would reject, instead of spending a call to find out', () => {
    expect(() => obligationsQuery({})).toThrow(/from and to date are required/);
    expect(() => obligationsQuery({ from: '2026-01-01' })).toThrow();
    expect(() => obligationsQuery({ status: 'fulfilled', from: 'nonsense', to: '2026-12-31' })).toThrow();
  });
});

describe('mapErrorCode', () => {
  it('separates a client who has not authorised us from a bad VRN — different problems, different fixes', () => {
    expect(mapErrorCode(403, 'CLIENT_OR_AGENT_NOT_AUTHORISED')).toBe('client_not_authorised');
    expect(mapErrorCode(403, 'VRN_INVALID')).toBe('invalid_vrn');
    expect(mapErrorCode(400, 'VRN_INVALID')).toBe('invalid_vrn');
  });

  it('maps the rest of the documented statuses', () => {
    expect(mapErrorCode(401, 'INVALID_CREDENTIALS')).toBe('not_authorised');
    expect(mapErrorCode(404, 'NOT_FOUND')).toBe('not_found');
    expect(mapErrorCode(429, 'TOO_MANY_REQUESTS')).toBe('rate_limited');
    expect(mapErrorCode(503, 'SERVER_ERROR')).toBe('upstream_error');
    expect(mapErrorCode(418, 'TEAPOT')).toBe('unknown_error');
  });
});
