import { describe, expect, it } from 'vitest';
import { buildEmptyPracticeData, normalizePracticeData } from '../emptyState';
import { buildFixtureData } from '../../testing/fixtures';

describe('normalizePracticeData', () => {
  it('adds the default practice timezone to snapshots saved before timezone existed', () => {
    const current = buildEmptyPracticeData();
    const { timezone: _timezone, ...practice } = current.practice;
    const old = { ...current, practice };

    expect(normalizePracticeData(old as ReturnType<typeof buildEmptyPracticeData>).practice.timezone).toBe('Europe/London');
  });

  it('leaves a fully-shaped snapshot untouched', () => {
    const data = buildFixtureData('2026-09-11');
    expect(normalizePracticeData(data)).toBe(data);
  });

  it('fills a missing collection with an empty array, leaving the rest of the snapshot as-is', () => {
    const full = buildFixtureData('2026-09-11');
    const { wipEntries: _wipEntries, ...withoutWip } = full;
    const result = normalizePracticeData(withoutWip as typeof full);
    expect(result.wipEntries).toEqual([]);
    expect(result.timeEntries).toBe(full.timeEntries);
    expect(result.clients).toBe(full.clients);
  });

  it('fills every collection that is missing, not just one, using the same defaults a brand-new practice starts with', () => {
    const full = buildFixtureData('2026-09-11');
    const { wipEntries: _w, timeEntries: _t, onboardingCases: _o, ...gappy } = full;
    const result = normalizePracticeData(gappy as typeof full);
    const empty = buildEmptyPracticeData();
    expect(result.wipEntries).toEqual(empty.wipEntries);
    expect(result.timeEntries).toEqual(empty.timeEntries);
    expect(result.onboardingCases).toEqual(empty.onboardingCases);
  });

  it('never overwrites a collection that is present but empty', () => {
    const full = buildFixtureData('2026-09-11');
    const withEmptyWip = { ...full, wipEntries: [] };
    const result = normalizePracticeData(withEmptyWip);
    expect(result).toBe(withEmptyWip);
    expect(result.wipEntries).toBe(withEmptyWip.wipEntries);
  });
});
