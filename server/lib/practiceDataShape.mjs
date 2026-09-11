/**
 * Structural check for a PracticeData snapshot before it overwrites the
 * shared one. The client is the only writer today, but the endpoint is one
 * PUT away from wiping every client for all three users, so a request that
 * is not recognisably a snapshot must be refused rather than stored.
 *
 * Deliberately shallow: the collections are checked to be arrays, not
 * validated row by row. Row-level validation belongs to the domain code in
 * src/, which is the source of truth for the shape; duplicating it here
 * would mean every new field needs two edits, and getting one wrong would
 * reject a perfectly good save (which, to the user, looks like data loss).
 *
 * Only `users` and `clients` are required. Every other collection is
 * checked when present so that an older snapshot which predates a newer
 * collection still round-trips — "existing data must still load" is the
 * rule that wins here.
 */
const REQUIRED_ARRAYS = ['users', 'clients'];

const KNOWN_ARRAYS = [
  ...REQUIRED_ARRAYS,
  'contacts',
  'identifiers',
  'people',
  'personRoles',
  'subscriptions',
  'obligations',
  'jobs',
  'requestItems',
  'documents',
  'communications',
  'reminderSequences',
  'approvals',
  'filings',
  'activities',
  'auditEvents',
  'inboxItems',
  'notifications',
  'onboardingCases',
  'mtdReadiness',
];

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Returns null when the snapshot is acceptable, otherwise a short machine-readable reason. */
export function validatePracticeData(data) {
  if (!isPlainObject(data)) return 'not_an_object';
  if (!isPlainObject(data.practice)) return 'practice_missing';
  if (typeof data.practice.id !== 'string' || data.practice.id.trim() === '') return 'practice_id_missing';
  for (const key of REQUIRED_ARRAYS) {
    if (!Array.isArray(data[key])) return `${key}_missing`;
  }
  for (const key of KNOWN_ARRAYS) {
    if (key in data && data[key] !== undefined && !Array.isArray(data[key])) return `${key}_not_an_array`;
  }
  return null;
}
