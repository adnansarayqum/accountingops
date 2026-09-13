import { describe, expect, it } from 'vitest';
import { formatDuration } from '../WorkRecordCards';

describe('formatDuration', () => {
  it('shows minutes alone under an hour', () => {
    expect(formatDuration(1)).toBe('1m');
    expect(formatDuration(45)).toBe('45m');
    expect(formatDuration(59)).toBe('59m');
  });

  it('shows whole hours alone with no stray "0m"', () => {
    expect(formatDuration(60)).toBe('1h');
    expect(formatDuration(180)).toBe('3h');
  });

  it('combines hours and minutes', () => {
    expect(formatDuration(95)).toBe('1h 35m');
    expect(formatDuration(150)).toBe('2h 30m');
  });

  it('handles zero', () => {
    expect(formatDuration(0)).toBe('0m');
  });
});
