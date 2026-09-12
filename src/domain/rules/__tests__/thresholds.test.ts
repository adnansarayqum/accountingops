import { describe, expect, it } from 'vitest';
import { DEFAULT_THRESHOLDS, MAX_THRESHOLD_DAYS, MIN_THRESHOLD_DAYS, resolveThresholds, sanitizeThresholdPatch } from '../thresholds';

describe('resolveThresholds', () => {
  it('returns the defaults when nothing is stored', () => {
    expect(resolveThresholds()).toEqual(DEFAULT_THRESHOLDS);
    expect(resolveThresholds(undefined)).toEqual(DEFAULT_THRESHOLDS);
  });

  it('fills in defaults for whatever a partial object is missing', () => {
    expect(resolveThresholds({ staleJobDays: 21 })).toEqual({ ...DEFAULT_THRESHOLDS, staleJobDays: 21 });
  });

  it('uses every field of a fully-populated object as-is', () => {
    const custom = { dueSoonDays: 5, identityVerificationWindowDays: 30, staleJobDays: 10, reviewWaitDays: 3, approvalWaitDays: 4 };
    expect(resolveThresholds(custom)).toEqual(custom);
  });
});

describe('sanitizeThresholdPatch', () => {
  it('keeps a whole number of days within range', () => {
    expect(sanitizeThresholdPatch({ dueSoonDays: 21 })).toEqual({ dueSoonDays: 21 });
    expect(sanitizeThresholdPatch({ staleJobDays: MIN_THRESHOLD_DAYS, approvalWaitDays: MAX_THRESHOLD_DAYS })).toEqual({ staleJobDays: MIN_THRESHOLD_DAYS, approvalWaitDays: MAX_THRESHOLD_DAYS });
  });

  it('drops anything not a whole number in range: zero, negative, non-integer, too large, NaN', () => {
    expect(sanitizeThresholdPatch({ dueSoonDays: 0 })).toEqual({});
    expect(sanitizeThresholdPatch({ dueSoonDays: -5 })).toEqual({});
    expect(sanitizeThresholdPatch({ dueSoonDays: 3.5 })).toEqual({});
    expect(sanitizeThresholdPatch({ dueSoonDays: MAX_THRESHOLD_DAYS + 1 })).toEqual({});
    expect(sanitizeThresholdPatch({ dueSoonDays: Number.NaN })).toEqual({});
  });

  it('keeps the good fields of a patch and drops only the bad ones', () => {
    expect(sanitizeThresholdPatch({ dueSoonDays: 10, staleJobDays: -1 })).toEqual({ dueSoonDays: 10 });
  });

  it('is a no-op for an empty patch', () => {
    expect(sanitizeThresholdPatch({})).toEqual({});
  });
});
