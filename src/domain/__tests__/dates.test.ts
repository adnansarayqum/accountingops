import { describe, expect, it } from 'vitest';
import { formatSince } from '../dates';

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
