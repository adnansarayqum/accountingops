import { describe, expect, it } from 'vitest';
import { daysBetween, daysSince, formatDate, formatDateTime, formatSince, todayIso } from '../dates';

describe('daysSince', () => {
  it('counts a timestamp by its local calendar day, not its UTC day', () => {
    // One minute past local midnight: the same local day whatever the zone,
    // but in a zone ahead of UTC the UTC slice is still the day before.
    const justAfterMidnight = new Date(2026, 8, 10, 0, 1).toISOString();
    expect(daysSince(justAfterMidnight, '2026-09-11')).toBe(1);
    const justBeforeMidnight = new Date(2026, 8, 10, 23, 59).toISOString();
    expect(daysSince(justBeforeMidnight, '2026-09-11')).toBe(1);
  });

  it('takes a plain date as-is', () => {
    expect(daysSince('2026-09-08', '2026-09-11')).toBe(3);
  });

  it('uses the practice timezone when a timestamp crosses a calendar boundary', () => {
    const instant = '2026-09-10T23:30:00.000Z';
    expect(daysSince(instant, '2026-09-11', 'Europe/London')).toBe(0);
    expect(daysSince(instant, '2026-09-11', 'America/New_York')).toBe(1);
  });
});

describe('practice calendar dates', () => {
  it('derives today and displayed timestamps from the practice timezone', () => {
    const instant = new Date('2026-01-01T00:30:00.000Z');
    expect(todayIso('Europe/London', instant)).toBe('2026-01-01');
    expect(todayIso('America/New_York', instant)).toBe('2025-12-31');
    expect(formatDateTime(instant.toISOString(), 'America/New_York')).toBe('31 Dec 2025, 19:30');
    expect(formatDate(instant.toISOString(), { timeZone: 'Asia/Tokyo' })).toBe('1 Jan 2026');
  });

  it('counts calendar days correctly over both UK DST transitions', () => {
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2);
  });

  it('keeps browser-local behaviour when no timezone is supplied', () => {
    const local = new Date(2026, 4, 6, 12, 0, 0);
    expect(todayIso(undefined, local)).toBe('2026-05-06');
  });
});

const now = new Date('2026-09-11T12:00:00.000Z');
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('formatSince', () => {
  it('reads as "just now" under a minute', () => {
    expect(formatSince(ago(0), now)).toBe('just now');
    expect(formatSince(ago(59 * 1000), now)).toBe('just now');
  });

  it('counts minutes, then hours, then days', () => {
    expect(formatSince(ago(MINUTE), now)).toBe('1 minute ago');
    expect(formatSince(ago(45 * MINUTE), now)).toBe('45 minutes ago');
    expect(formatSince(ago(HOUR), now)).toBe('1 hour ago');
    expect(formatSince(ago(5 * HOUR), now)).toBe('5 hours ago');
    expect(formatSince(ago(DAY), now)).toBe('1 day ago');
    expect(formatSince(ago(3 * DAY), now)).toBe('3 days ago');
  });

  it('does not report a future timestamp as a negative age', () => {
    expect(formatSince(new Date(now.getTime() + 5 * MINUTE).toISOString(), now)).toBe('just now');
  });
});
