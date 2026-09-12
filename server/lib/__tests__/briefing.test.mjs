import { describe, expect, it } from 'vitest';
import { composeBriefing, isValidEmail, localParts, shouldSendNow } from '../briefing.mjs';

const today = '2026-09-14'; // a Monday

const snapshot = {
  clients: [
    { id: 'cl_a', name: 'Acme Ltd' },
    { id: 'cl_b', name: 'Bright Ltd' },
    { id: 'cl_c', name: 'Calm Ltd' },
  ],
  jobs: [
    { id: 'j1', clientId: 'cl_a', name: '2025 Annual Accounts', status: 'waiting_for_records', waitingOn: 'client', dueDate: '2026-09-11' },
    { id: 'j2', clientId: 'cl_b', name: 'VAT Return 2026 Q2', status: 'in_progress', waitingOn: 'accountant', dueDate: '2026-09-17' },
    { id: 'j3', clientId: 'cl_c', name: '2025 Self Assessment', status: 'ready_to_file', waitingOn: 'nothing', dueDate: '2026-10-30' },
    { id: 'j4', clientId: 'cl_a', name: '2024 Annual Accounts', status: 'filed', waitingOn: 'nothing', dueDate: '2025-12-31', filedAt: '2025-12-01T00:00:00Z' },
  ],
  communications: [
    { id: 'c1', clientId: 'cl_a', direction: 'outbound', sentAt: '2026-09-05T09:00:00Z', responseStatus: 'awaiting' },
    { id: 'c2', clientId: 'cl_b', direction: 'outbound', sentAt: '2026-09-05T09:00:00Z', responseStatus: 'awaiting' },
    { id: 'c3', clientId: 'cl_b', direction: 'inbound', sentAt: '2026-09-06T09:00:00Z' },
  ],
};

describe('composeBriefing', () => {
  it('leads with the counts and lists each section with days', () => {
    const { subject, body, counts } = composeBriefing(snapshot, today, { appUrl: 'https://ops.example' });
    expect(subject).toBe('Monday briefing: 1 overdue, 1 due this week, 1 ready to file');
    expect(counts).toEqual({ overdue: 1, dueThisWeek: 1, waitingClients: 1, ready: 1, silent: 1 });
    expect(body).toContain('OVERDUE\n  - Acme Ltd — 2025 Annual Accounts (3 days overdue)');
    expect(body).toContain('DUE THIS WEEK\n  - Bright Ltd — VAT Return 2026 Q2 (3 days)');
    expect(body).toContain('READY TO FILE\n  - Calm Ltd — 2025 Self Assessment');
    expect(body).toContain("CLIENTS WHO HAVEN'T REPLIED\n  - Acme Ltd — 9 days since we last chased");
    expect(body).toContain('https://ops.example/briefing');
  });

  it('does not count a client who replied after the chase as silent', () => {
    const { body } = composeBriefing(snapshot, today);
    const silentSection = body.slice(body.indexOf("CLIENTS WHO HAVEN'T REPLIED"));
    expect(silentSection).toContain('Acme Ltd');
    expect(silentSection).not.toContain('Bright Ltd');
    expect(body).toMatch(/Silent 5\+ days: 1/);
  });

  it('leaves filed jobs out entirely', () => {
    const { body } = composeBriefing(snapshot, today);
    expect(body).not.toContain('2024 Annual Accounts');
  });

  it('says so plainly when there is nothing pressing', () => {
    const quiet = { clients: [{ id: 'cl_a', name: 'Acme Ltd' }], jobs: [{ id: 'j', clientId: 'cl_a', name: 'X', status: 'in_progress', waitingOn: 'accountant', dueDate: '2026-12-31' }], communications: [] };
    const { subject, body } = composeBriefing(quiet, today);
    expect(subject).toBe('Monday briefing: 0 overdue, 0 due this week, 0 ready to file');
    expect(body).toContain('Nothing pressing');
  });

  it('caps long lists rather than sending a novel', () => {
    const many = { clients: [{ id: 'cl_a', name: 'Acme Ltd' }], jobs: Array.from({ length: 14 }, (_, i) => ({ id: `j${i}`, clientId: 'cl_a', name: `Job ${i}`, status: 'in_progress', waitingOn: 'accountant', dueDate: '2026-09-01' })), communications: [] };
    const { body } = composeBriefing(many, today);
    expect(body).toContain('…and 4 more');
  });

  it('always tells the reader how to stop it', () => {
    expect(composeBriefing(snapshot, today).body).toContain('Turn them off in Settings');
  });

  it('is the same email for the same input', () => {
    expect(composeBriefing(snapshot, today)).toEqual(composeBriefing(snapshot, today));
  });
});

describe('shouldSendNow', () => {
  const tz = 'Europe/London';
  // 14 Sep 2026 is a Monday; London is UTC+1 (BST).
  const at = (isoUtc) => new Date(isoUtc);

  it('sends on a weekday from the send hour, once', () => {
    expect(shouldSendNow({ now: at('2026-09-14T06:05:00Z'), timezone: tz, lastSentOn: null })).toEqual({ send: true, date: '2026-09-14' }); // 07:05 local
    expect(shouldSendNow({ now: at('2026-09-14T06:05:00Z'), timezone: tz, lastSentOn: '2026-09-14' })).toEqual({ send: false, date: '2026-09-14' });
  });

  it('waits until the send hour in the practice’s own timezone, not the server’s', () => {
    // 06:30 UTC is 07:30 in London — past seven. 05:30 UTC is 06:30 — not yet.
    expect(shouldSendNow({ now: at('2026-09-14T05:30:00Z'), timezone: tz, lastSentOn: null }).send).toBe(false);
    expect(shouldSendNow({ now: at('2026-09-14T06:30:00Z'), timezone: tz, lastSentOn: null }).send).toBe(true);
  });

  it('catches up later in the day if the server was asleep at seven', () => {
    expect(shouldSendNow({ now: at('2026-09-14T15:00:00Z'), timezone: tz, lastSentOn: '2026-09-11' }).send).toBe(true);
  });

  it('never sends at the weekend', () => {
    expect(shouldSendNow({ now: at('2026-09-12T08:00:00Z'), timezone: tz, lastSentOn: null }).send).toBe(false); // Saturday
    expect(shouldSendNow({ now: at('2026-09-13T08:00:00Z'), timezone: tz, lastSentOn: null }).send).toBe(false); // Sunday
  });

  it('respects a different send hour', () => {
    expect(shouldSendNow({ now: at('2026-09-14T06:30:00Z'), timezone: tz, lastSentOn: null, sendHour: 9 }).send).toBe(false);
    expect(shouldSendNow({ now: at('2026-09-14T08:30:00Z'), timezone: tz, lastSentOn: null, sendHour: 9 }).send).toBe(true);
  });

  it('reads the local date correctly across midnight', () => {
    // 23:30 UTC on the 14th is 00:30 on the 15th in London.
    expect(localParts(at('2026-09-14T23:30:00Z'), tz)).toMatchObject({ date: '2026-09-15', hour: 0, weekday: 'Tue' });
  });
});

describe('isValidEmail', () => {
  it('accepts an ordinary address and rejects the rest', () => {
    expect(isValidEmail('adnan@example.co.uk')).toBe(true);
    expect(isValidEmail('nope')).toBe(false);
    expect(isValidEmail('a@b')).toBe(false);
    expect(isValidEmail('')).toBe(false);
    expect(isValidEmail(42)).toBe(false);
  });
});
