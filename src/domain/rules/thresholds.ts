import type { PracticeThresholds } from '../types';

/**
 * What every threshold was before Settings → Timing thresholds existed —
 * the values every rule already used, hardcoded. Nothing about behaviour
 * changes for a practice that never touches the new settings.
 */
export const DEFAULT_THRESHOLDS: PracticeThresholds = {
  dueSoonDays: 14,
  identityVerificationWindowDays: 45,
  staleJobDays: 14,
  reviewWaitDays: 7,
  approvalWaitDays: 10,
};

/**
 * Fills in a default for whatever a practice hasn't (or hadn't yet)
 * customised: `thresholds` may be a fully-populated object, a partial one
 * (only some fields ever saved), or absent entirely (a snapshot from
 * before this existed). Every call site gets a complete object either way.
 */
export function resolveThresholds(thresholds?: Partial<PracticeThresholds>): PracticeThresholds {
  return { ...DEFAULT_THRESHOLDS, ...thresholds };
}

export const MIN_THRESHOLD_DAYS = 1;
export const MAX_THRESHOLD_DAYS = 365;

/**
 * Keeps only well-formed values from a threshold patch — a whole number of
 * days, between `MIN_THRESHOLD_DAYS` and `MAX_THRESHOLD_DAYS` — dropping
 * anything else rather than letting a bad value (from a stray caller, or
 * a hand-edited request in the shared mode) corrupt what's stored. The
 * Settings form validates before ever calling this; this is the backstop.
 */
export function sanitizeThresholdPatch(patch: Partial<PracticeThresholds>): Partial<PracticeThresholds> {
  const clean: Partial<PracticeThresholds> = {};
  for (const key of Object.keys(patch) as (keyof PracticeThresholds)[]) {
    const value = patch[key];
    if (typeof value === 'number' && Number.isInteger(value) && value >= MIN_THRESHOLD_DAYS && value <= MAX_THRESHOLD_DAYS) clean[key] = value;
  }
  return clean;
}
