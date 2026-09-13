import { describe, expect, it } from 'vitest';
import { BACKOFF, backoffMs, companyNumberOf, isInterestingChange, matchesWatched, normaliseCompanyNumber, parseStreamLine, reasonForStatus, shouldDropTimepoint, splitLines, streamAuthHeader, streamUrl } from '../companiesHouseStream.mjs';

const record = (over = {}) => ({
  resource_kind: 'company-profile#company-profile',
  resource_uri: '/company/01234567',
  resource_id: '01234567',
  data: { company_name: 'Example Ltd' },
  event: { timepoint: 42, published_at: '2026-09-12T10:00:00', type: 'changed', fields_changed: ['accounts.next_due'] },
  ...over,
});

describe('streamAuthHeader', () => {
  it('sends the streaming key as the basic-auth username with an empty password', () => {
    expect(streamAuthHeader('a-streaming-api-key')).toBe(`Basic ${Buffer.from('a-streaming-api-key:').toString('base64')}`);
  });

  it('returns null with no key, so the caller can stay disconnected rather than send a bad header', () => {
    expect(streamAuthHeader('')).toBeNull();
    expect(streamAuthHeader(undefined)).toBeNull();
  });
});

describe('streamUrl', () => {
  it('resumes from a stored timepoint', () => {
    expect(streamUrl(187124872486)).toBe('https://stream.companieshouse.gov.uk/companies?timepoint=187124872486');
  });

  it('starts from now when there is no usable timepoint, rather than replaying the whole register', () => {
    for (const bad of [undefined, null, 0, -1, 1.5, 'nope']) {
      expect(streamUrl(bad)).toBe('https://stream.companieshouse.gov.uk/companies');
    }
  });
});

describe('parseStreamLine', () => {
  it('parses a change event', () => {
    expect(parseStreamLine(JSON.stringify(record()))).toEqual({
      companyNumber: '01234567',
      timepoint: 42,
      type: 'changed',
      publishedAt: '2026-09-12T10:00:00',
      fieldsChanged: ['accounts.next_due'],
    });
  });

  it('ignores a heartbeat, which arrives as a blank line', () => {
    expect(parseStreamLine('')).toBeNull();
    expect(parseStreamLine('   \n')).toBeNull();
  });

  it('skips a malformed line instead of throwing — one bad record must not end the connection', () => {
    expect(parseStreamLine('{ not json')).toBeNull();
    expect(parseStreamLine('null')).toBeNull();
  });

  it('skips a record with no usable timepoint, since it could not be resumed from', () => {
    expect(parseStreamLine(JSON.stringify(record({ event: { type: 'changed' } })))).toBeNull();
    expect(parseStreamLine(JSON.stringify(record({ event: { timepoint: 'x', type: 'changed' } })))).toBeNull();
  });

  it('keeps deletions — a dissolved client is the loudest thing the stream can tell us', () => {
    const parsed = parseStreamLine(JSON.stringify(record({ event: { timepoint: 7, type: 'deleted' } })));
    expect(parsed).toMatchObject({ type: 'deleted', companyNumber: '01234567', fieldsChanged: [] });
  });

  it('tolerates a missing fields_changed and non-string entries within it', () => {
    expect(parseStreamLine(JSON.stringify(record({ event: { timepoint: 1, type: 'changed' } })))?.fieldsChanged).toEqual([]);
    expect(parseStreamLine(JSON.stringify(record({ event: { timepoint: 1, type: 'changed', fields_changed: ['ok', 3, null] } })))?.fieldsChanged).toEqual(['ok']);
  });
});

describe('companyNumberOf', () => {
  it('prefers resource_id, upper-cased so a roster "sc123456" still matches', () => {
    expect(companyNumberOf({ resource_id: 'sc123456' })).toBe('SC123456');
  });

  it('falls back to the resource URI when the id is missing', () => {
    expect(companyNumberOf({ resource_uri: '/company/09876543' })).toBe('09876543');
  });

  it('returns null when neither identifies a company', () => {
    expect(companyNumberOf({ resource_uri: '/officers/abc' })).toBeNull();
    expect(companyNumberOf({})).toBeNull();
    expect(companyNumberOf(null)).toBeNull();
  });

  it('rejects a resource_id outside the character set a company number can actually have', () => {
    // resource_id is trusted content from Companies House, but it still
    // flows on to the watch-list match, gets stored, and is returned to the
    // browser — the same character discipline the resource_uri fallback
    // already applied to itself.
    expect(companyNumberOf({ resource_id: '01234567<script>' })).toBeNull();
    expect(companyNumberOf({ resource_id: 'one two three' })).toBeNull();
    expect(companyNumberOf({ resource_id: '12345678901' })).toBeNull(); // eleven characters, one too many
    expect(companyNumberOf({ resource_id: '' })).toBeNull();
  });

  it('falls back to the resource URI when resource_id is present but not a real company number', () => {
    expect(companyNumberOf({ resource_id: 'not a company number', resource_uri: '/company/09876543' })).toBe('09876543');
  });
});

describe('matchesWatched', () => {
  it('keeps only the practice’s own companies out of the whole-register firehose', () => {
    const watched = new Set(['01234567', 'SC999999']);
    expect(matchesWatched(parseStreamLine(JSON.stringify(record())), watched)).toBe(true);
    expect(matchesWatched(parseStreamLine(JSON.stringify(record({ resource_id: '07777777' }))), watched)).toBe(false);
    expect(matchesWatched(null, watched)).toBe(false);
  });

  it('matches case-insensitively via the normalised form', () => {
    const watched = new Set([normaliseCompanyNumber(' sc999999 ')]);
    expect(matchesWatched(parseStreamLine(JSON.stringify(record({ resource_id: 'SC999999' }))), watched)).toBe(true);
  });
});

describe('isInterestingChange', () => {
  const evt = (fieldsChanged, type = 'changed') => ({ type, fieldsChanged });

  it('counts the fields this app actually tracks', () => {
    expect(isInterestingChange(evt(['accounts.next_due']))).toBe(true);
    expect(isInterestingChange(evt(['confirmation_statement.next_due']))).toBe(true);
    expect(isInterestingChange(evt(['company_status']))).toBe(true);
    expect(isInterestingChange(evt(['registered_office_address.postal_code']))).toBe(true);
  });

  it('ignores churn the app never shows, so "3 clients changed" stays trustworthy', () => {
    expect(isInterestingChange(evt(['links.self']))).toBe(false);
    expect(isInterestingChange(evt(['links.document_metadata', 'etag']))).toBe(false);
  });

  it('does not treat a prefix as a match for an unrelated field that merely starts with the same letters', () => {
    expect(isInterestingChange(evt(['accountsomething']))).toBe(false);
    expect(isInterestingChange(evt(['typeface']))).toBe(false);
  });

  it('treats a deletion, and a change with no field list, as always worth surfacing', () => {
    expect(isInterestingChange(evt(['links.self'], 'deleted'))).toBe(true);
    expect(isInterestingChange(evt([]))).toBe(true);
  });

  it('is false for nothing at all', () => {
    expect(isInterestingChange(null)).toBe(false);
  });
});

describe('backoff', () => {
  it('honours the one-minute minimum Companies House require after a 429', () => {
    expect(reasonForStatus(429)).toBe('rateLimited');
    expect(backoffMs('rateLimited', 0)).toBe(60_000);
    expect(backoffMs('rateLimited', 0)).toBeGreaterThanOrEqual(BACKOFF.rateLimited);
  });

  it('treats 416 as a stale timepoint and drops it for the next connect', () => {
    expect(reasonForStatus(416)).toBe('timepointTooOld');
    expect(shouldDropTimepoint('timepointTooOld')).toBe(true);
    expect(shouldDropTimepoint('network')).toBe(false);
  });

  it('maps any other status to a plain HTTP error', () => {
    expect(reasonForStatus(500)).toBe('httpError');
    expect(reasonForStatus(403)).toBe('httpError');
  });

  it('doubles per consecutive failure and caps at five minutes', () => {
    expect(backoffMs('network', 0)).toBe(2_000);
    expect(backoffMs('network', 1)).toBe(4_000);
    expect(backoffMs('network', 3)).toBe(16_000);
    expect(backoffMs('network', 99)).toBe(300_000);
    expect(backoffMs('rateLimited', 99)).toBe(300_000);
  });

  it('falls back to the network curve for an unknown reason', () => {
    expect(backoffMs('something-else', 0)).toBe(BACKOFF.network);
  });
});

describe('splitLines', () => {
  it('returns complete lines and holds the partial one back', () => {
    expect(splitLines('{"a":1}\n{"b":2}\n{"c":')).toEqual({ lines: ['{"a":1}', '{"b":2}'], remainder: '{"c":' });
  });

  it('holds everything back when no line is complete yet', () => {
    expect(splitLines('{"a"')).toEqual({ lines: [], remainder: '{"a"' });
  });

  it('reassembles a record split across two chunks', () => {
    const first = splitLines('{"resource_id":"012');
    const second = splitLines(first.remainder + '34567","event":{"timepoint":9,"type":"changed"}}\n');
    expect(parseStreamLine(second.lines[0])).toMatchObject({ companyNumber: '01234567', timepoint: 9 });
  });

  it('keeps heartbeat blank lines as lines, for the parser to discard', () => {
    expect(splitLines('\n\n{"a":1}\n')).toEqual({ lines: ['', '', '{"a":1}'], remainder: '' });
  });
});
