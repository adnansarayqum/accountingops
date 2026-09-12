import { describe, expect, it } from 'vitest';
import { RETENTION, applyRetention, trimAuditPayload } from '../retention';
import { buildEmptyPracticeData } from '../../application/emptyState';
import type { Activity, AuditEvent, Notification, PracticeData } from '../types';

function activity(n: number): Activity {
  return { id: `act_${n}`, practiceId: 'p', kind: 'note', message: `activity ${n}`, occurredAt: `2026-01-01T00:00:${String(n % 60).padStart(2, '0')}Z` } as Activity;
}
function notification(n: number): Notification {
  return { id: `ntf_${n}`, practiceId: 'p', title: `n${n}`, body: '', kind: 'job', createdAt: '2026-01-01T00:00:00Z', read: n % 2 === 0 };
}
function audit(n: number, overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    id: `aud_${n}`,
    practiceId: 'p',
    action: 'job.transition',
    entityType: 'job',
    entityId: `job_${n}`,
    before: { status: 'a' },
    after: { status: 'b' },
    occurredAt: '2026-01-01T00:00:00Z',
    source: 'ui',
    correlationId: `corr_${n}`,
    ...overrides,
  };
}
function data(overrides: Partial<PracticeData>): PracticeData {
  return { ...buildEmptyPracticeData(), ...overrides };
}
const range = <T,>(n: number, make: (i: number) => T): T[] => Array.from({ length: n }, (_, i) => make(i));

describe('applyRetention', () => {
  it('returns the very same object when nothing is over a cap', () => {
    const d = data({ activities: range(10, activity), auditEvents: range(10, audit), notifications: range(10, notification) });
    expect(applyRetention(d)).toBe(d);
  });

  it('keeps the newest activities and notifications (feeds are newest-first)', () => {
    const d = data({ activities: range(RETENTION.activities + 25, activity), notifications: range(RETENTION.notifications + 3, notification) });
    const out = applyRetention(d);
    expect(out).not.toBe(d);
    expect(out.activities).toHaveLength(RETENTION.activities);
    expect(out.activities[0].id).toBe('act_0');
    expect(out.activities.at(-1)!.id).toBe(`act_${RETENTION.activities - 1}`);
    expect(out.notifications).toHaveLength(RETENTION.notifications);
    expect(out.notifications[0].id).toBe('ntf_0');
    // The input is left as it was.
    expect(d.activities).toHaveLength(RETENTION.activities + 25);
  });

  it('caps the audit log and strips before/after from entries older than the detail window', () => {
    const d = data({ auditEvents: range(RETENTION.auditEvents + 10, audit) });
    const out = applyRetention(d);
    expect(out.auditEvents).toHaveLength(RETENTION.auditEvents);
    const recent = out.auditEvents[RETENTION.auditDetail - 1];
    expect(recent.before).toEqual({ status: 'a' });
    expect(recent.after).toEqual({ status: 'b' });
    const older = out.auditEvents[RETENTION.auditDetail];
    expect(older).not.toHaveProperty('before');
    expect(older).not.toHaveProperty('after');
    // Header survives intact, and the source entry was copied, not edited.
    expect(older).toMatchObject({ id: `aud_${RETENTION.auditDetail}`, action: 'job.transition', entityId: `job_${RETENTION.auditDetail}`, correlationId: `corr_${RETENTION.auditDetail}` });
    expect(d.auditEvents[RETENTION.auditDetail].before).toEqual({ status: 'a' });
  });

  it('keeps identity-related payloads for as long as the entry itself', () => {
    const events = range(RETENTION.auditDetail + 5, audit);
    events[RETENTION.auditDetail + 1] = audit(9001, { action: 'identifier.reveal', before: undefined, after: { kind: 'utr' } });
    events[RETENTION.auditDetail + 2] = audit(9002, { action: 'person_role.verification', before: { identityVerification: 'pending' }, after: { identityVerification: 'verified' } });
    const out = applyRetention(data({ auditEvents: events }));
    expect(out.auditEvents[RETENTION.auditDetail + 1].after).toEqual({ kind: 'utr' });
    expect(out.auditEvents[RETENTION.auditDetail + 2].before).toEqual({ identityVerification: 'pending' });
    expect(out.auditEvents[RETENTION.auditDetail + 3]).not.toHaveProperty('after');
  });

  it('summarises an over-long payload on a recent entry instead of keeping it verbatim', () => {
    const names = range(400, (i) => `Client number ${i} Limited`);
    const bulk = audit(1, { action: 'client.import', before: undefined, after: { count: 400, names } });
    const out = applyRetention(data({ auditEvents: [bulk, audit(2)] }));
    expect(out.auditEvents[0].after).toMatchObject({ truncated: true, keys: ['count', 'names'] });
    expect(JSON.stringify(out.auditEvents[0].after).length).toBeLessThan(200);
    expect(out.auditEvents[1]).toBe(out.auditEvents[1]);
    expect(out.auditEvents[1].after).toEqual({ status: 'b' });
  });

  it('is idempotent: applying it again changes nothing', () => {
    const d = data({ activities: range(RETENTION.activities + 1, activity), auditEvents: range(RETENTION.auditEvents + 1, audit) });
    const once = applyRetention(d);
    expect(applyRetention(once)).toBe(once);
  });
});

describe('trimAuditPayload', () => {
  it('leaves small values, undefined and null alone', () => {
    const small = { a: 1 };
    expect(trimAuditPayload(small)).toBe(small);
    expect(trimAuditPayload(undefined)).toBeUndefined();
    expect(trimAuditPayload(null)).toBeNull();
    expect(trimAuditPayload('x'.repeat(RETENTION.auditPayloadChars - 2))).toBe('x'.repeat(RETENTION.auditPayloadChars - 2));
  });

  it('describes what an over-long array, object or string was', () => {
    expect(trimAuditPayload(range(1000, (i) => i))).toMatchObject({ truncated: true, length: 1000 });
    expect(trimAuditPayload({ big: 'x'.repeat(5000), other: 1 })).toMatchObject({ truncated: true, keys: ['big', 'other'] });
    expect(trimAuditPayload('x'.repeat(5000))).toEqual({ truncated: true, chars: 5002 });
  });
});
