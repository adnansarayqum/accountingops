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
 *
 * One deliberate exception to "shallow": a client's AML risk rating and
 * rolling turnover. These aren't just wrong-shape risks like everything
 * else here — a rating outside the known set makes the AML review rule
 * (src/domain/rules/aml.ts) fall through to reporting the client as
 * "current" when it can't recognise the rating, which is a compliance
 * false negative, not a cosmetic one. That rule also guards against it
 * defensively, but a snapshot arriving with garbage in these two fields
 * (a hand-built request bypassing the app's own store actions, not
 * something the UI can produce) is refused here rather than stored and
 * silently misread. `AML_RATINGS` must be kept in sync with the
 * `AmlRiskRating` union in src/domain/types.ts.
 */
const AML_RATINGS = ['low', 'standard', 'high'];

function isValidAmlRating(value) {
  return value === undefined || value === null || AML_RATINGS.includes(value);
}

function isValidTurnover(value) {
  return value === undefined || value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0);
}

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
  if (Array.isArray(data.clients)) {
    for (const client of data.clients) {
      if (!isPlainObject(client)) return 'client_not_an_object';
      if (!isValidAmlRating(client.amlRiskRating)) return 'client_aml_rating_invalid';
      if (!isValidTurnover(client.rolling12MonthTurnover)) return 'client_turnover_invalid';
    }
  }
  return null;
}
