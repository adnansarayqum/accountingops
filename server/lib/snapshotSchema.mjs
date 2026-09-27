/**
 * Runtime schema for the critical structures inside a PracticeData snapshot.
 *
 * The endpoint that accepts a snapshot is one PUT away from rewriting every
 * client's record for the whole practice, so "is an array" is not enough for
 * the parts other code makes decisions from: who is on the team and in what
 * role, what state a job is in, whether a client's AML rating is one the
 * compliance rules recognise, what an audit event claims to be.
 *
 * Design rules — the second is the one that makes this safe to ship:
 *
 * 1. Strict where a wrong value changes a decision. Enumerations (roles, job
 *    status, AML rating, channels…) must be members of the known set; numbers
 *    must be finite and, where a negative makes no sense, non-negative;
 *    ids must be non-empty strings.
 * 2. Lenient everywhere else. Unknown properties are kept (a newer client's
 *    fields must round-trip through an older server), a field is required
 *    only when the app cannot function without it, and a collection the
 *    server has no rule for is only checked to hold objects with an `id`.
 *    A save refused for a cosmetic reason reads to the user as lost work, so
 *    "existing data must still load" beats "as strict as possible".
 *
 * The enumerations below mirror the unions in src/domain/types.ts; the test
 * suite reads that file and fails when the two drift (see
 * server/lib/__tests__/snapshotSchema.test.mjs), so adding a status to the
 * client without teaching the server cannot ship unnoticed.
 *
 * Reasons are short, machine-readable and never echo the offending value:
 * `jobs[3].status_invalid`.
 */

export const ENUMS = Object.freeze({
  userRole: ['owner', 'manager', 'accountant', 'admin'],
  clientType: ['limited_company', 'sole_trader', 'landlord', 'partnership', 'individual'],
  clientLifecycle: ['onboarding', 'active', 'dormant', 'ceased'],
  amlRiskRating: ['low', 'standard', 'high'],
  channel: ['email', 'whatsapp', 'sms', 'phone', 'portal'],
  identifierKind: ['utr', 'nino', 'company_number', 'vat_number', 'paye_reference', 'accounts_office_ref', 'ch_auth_code', 'personal_code', 'gateway_credentials'],
  personRoleKind: ['director', 'psc', 'partner', 'proprietor'],
  identityVerificationStatus: ['verified', 'in_progress', 'not_started', 'expired'],
  serviceCode: ['annual_accounts', 'corporation_tax', 'vat', 'payroll', 'self_assessment', 'confirmation_statement', 'mtd_income_tax', 'bookkeeping_review'],
  jobStatus: ['waiting_for_records', 'ready_to_start', 'in_progress', 'internal_review', 'waiting_client_approval', 'ready_to_file', 'filed'],
  waitingOn: ['client', 'accountant', 'senior_review', 'hmrc', 'companies_house', 'approval', 'payment', 'nothing'],
  requestItemStatus: ['missing', 'requested', 'received'],
  communicationDirection: ['outbound', 'inbound'],
  approvalKind: ['internal', 'client'],
  approvalStatus: ['pending', 'approved', 'rejected'],
  auditSource: ['ui', 'system', 'api'],
  deliveryStatus: ['sent', 'handed_off', 'simulated'],
  filingDestination: ['HMRC', 'Companies House'],
  filingEvidenceStatus: ['simulated', 'pending', 'stored'],
  wipStatus: ['unbilled', 'invoiced', 'written_off'],
});

const MAX_ROWS = 100_000;
const MAX_ID = 200;
const MAX_TEXT = 200_000;

// --- primitive checks: each returns null when fine, else a short problem code ---

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

const idValue = (v) => (typeof v === 'string' && v.trim() !== '' && v.length <= MAX_ID ? null : 'invalid');
const text = (v) => (typeof v === 'string' && v.length <= MAX_TEXT ? null : 'invalid');
const bool = (v) => (typeof v === 'boolean' ? null : 'invalid');
const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? null : 'invalid');
const nonNegative = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? null : 'invalid');
const oneOf = (values) => (v) => (values.includes(v) ? null : 'invalid');
const anything = () => null;

/** A real calendar date, YYYY-MM-DD. */
const isoDate = (v) => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return 'invalid';
  const [y, m, d] = v.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? null : 'invalid';
};

/** An ISO 8601 date-time the platform can parse. */
const isoDateTime = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) && !Number.isNaN(Date.parse(v)) ? null : 'invalid');

const arrayOf = (check) => (v) => {
  if (!Array.isArray(v)) return 'invalid';
  for (const item of v) if (check(item)) return 'invalid';
  return null;
};

const required = (check) => ({ check, required: true });
const optional = (check) => ({ check, required: false });

/** Checks a row against `fields`; `undefined` and `null` both count as absent for optional fields. */
function checkRow(row, fields) {
  if (!isObject(row)) return 'not_an_object';
  for (const [key, { check, required: mandatory }] of Object.entries(fields)) {
    const value = row[key];
    const absent = value === undefined || value === null;
    if (absent) {
      if (mandatory) return `${key}_missing`;
      continue;
    }
    if (check(value)) return `${key}_invalid`;
  }
  return null;
}

const ID = { id: required(idValue) };
const practiceId = { practiceId: optional(idValue) };

// --- the critical collections ---

const thresholds = (v) => {
  if (!isObject(v)) return 'invalid';
  for (const value of Object.values(v)) if (value !== undefined && value !== null && nonNegative(value)) return 'invalid';
  return null;
};

const SCHEMAS = Object.freeze({
  users: {
    ...ID,
    ...practiceId,
    name: required(text),
    role: required(oneOf(ENUMS.userRole)),
    initials: optional(text),
    weeklyCapacityHours: optional(nonNegative),
    colour: optional(text),
  },
  clients: {
    ...ID,
    ...practiceId,
    name: required(text),
    type: optional(oneOf(ENUMS.clientType)),
    lifecycle: optional(oneOf(ENUMS.clientLifecycle)),
    ownerUserId: optional(idValue),
    backupOwnerUserId: optional(idValue),
    primaryContactId: optional(idValue),
    preferredChannel: optional(oneOf(ENUMS.channel)),
    averageResponseDays: optional(nonNegative),
    amlRiskRating: optional(oneOf(ENUMS.amlRiskRating)),
    rolling12MonthTurnover: optional(nonNegative),
    sicCodes: optional(arrayOf((s) => (typeof s === 'string' ? null : 'invalid'))),
  },
  contacts: {
    ...ID,
    ...practiceId,
    clientId: required(idValue),
    name: optional(text),
    email: optional(text),
    isPrimary: optional(bool),
  },
  identifiers: {
    ...ID,
    ...practiceId,
    clientId: required(idValue),
    kind: required(oneOf(ENUMS.identifierKind)),
    value: required(text),
    sensitive: optional(bool),
  },
  personRoles: {
    ...ID,
    ...practiceId,
    personId: required(idValue),
    clientId: required(idValue),
    kind: required(oneOf(ENUMS.personRoleKind)),
    identityVerification: required(oneOf(ENUMS.identityVerificationStatus)),
    personalCodeCaptured: optional(bool),
  },
  jobs: {
    ...ID,
    ...practiceId,
    clientId: required(idValue),
    serviceCode: optional(oneOf(ENUMS.serviceCode)),
    status: required(oneOf(ENUMS.jobStatus)),
    waitingOn: required(oneOf(ENUMS.waitingOn)),
    periodStart: optional(isoDate),
    periodEnd: optional(isoDate),
    dueDate: optional(isoDate),
    assigneeUserId: optional(idValue),
    reviewerUserId: optional(idValue),
    estimatedHours: optional(nonNegative),
    statusChangedAt: optional(isoDateTime),
    chasingPaused: optional(bool),
  },
  requestItems: {
    ...ID,
    ...practiceId,
    jobId: required(idValue),
    status: required(oneOf(ENUMS.requestItemStatus)),
    required: optional(bool),
  },
  communications: {
    ...ID,
    ...practiceId,
    clientId: required(idValue),
    direction: required(oneOf(ENUMS.communicationDirection)),
    channel: required(oneOf(ENUMS.channel)),
    recipient: optional(text),
    body: optional(text),
    sentAt: optional(isoDateTime),
    simulated: optional(bool),
    deliveryStatus: optional(oneOf(ENUMS.deliveryStatus)),
  },
  approvals: {
    ...ID,
    ...practiceId,
    jobId: required(idValue),
    kind: required(oneOf(ENUMS.approvalKind)),
    status: required(oneOf(ENUMS.approvalStatus)),
  },
  filings: {
    ...ID,
    ...practiceId,
    jobId: required(idValue),
    destination: optional(oneOf(ENUMS.filingDestination)),
    evidenceStatus: optional(oneOf(ENUMS.filingEvidenceStatus)),
    simulated: optional(bool),
  },
  auditEvents: {
    ...ID,
    ...practiceId,
    actorUserId: optional(idValue),
    action: required((v) => (typeof v === 'string' && v.trim() !== '' && v.length <= 200 ? null : 'invalid')),
    entityType: required(text),
    entityId: required(text),
    occurredAt: required(isoDateTime),
    source: required(oneOf(ENUMS.auditSource)),
    correlationId: optional(text),
    before: optional(anything),
    after: optional(anything),
  },
  wipEntries: {
    ...ID,
    ...practiceId,
    clientId: required(idValue),
    amount: optional(finite),
    status: optional(oneOf(ENUMS.wipStatus)),
  },
  timeEntries: {
    ...ID,
    ...practiceId,
    clientId: required(idValue),
    userId: required(idValue),
    minutes: optional(nonNegative),
  },
  notifications: {
    ...ID,
    ...practiceId,
    read: optional(bool),
  },
});

/** Collections the server has no field rules for: still rows with an id, so a scalar or an id-less blob cannot ride in. */
const ID_ONLY = ['people', 'subscriptions', 'obligations', 'documents', 'reminderSequences', 'activities', 'inboxItems', 'onboardingCases', 'mtdReadiness'];

const practiceSchema = {
  id: required(idValue),
  name: required((v) => (typeof v === 'string' && v.trim() !== '' && v.length <= 500 ? null : 'invalid')),
  timezone: optional((v) => {
    if (typeof v !== 'string') return 'invalid';
    try {
      new Intl.DateTimeFormat('en-GB', { timeZone: v });
      return null;
    } catch {
      return 'invalid';
    }
  }),
  thresholds: optional(thresholds),
};

/**
 * Returns null when the critical structures are sound, otherwise a reason
 * such as `jobs[3].status_invalid`. Structural presence of the collections
 * (an object, `users` and `clients` present, arrays where arrays belong) is
 * checked first by practiceDataShape.mjs; this assumes that has passed but
 * does not depend on it.
 */
export function validateSnapshotSchema(data) {
  if (!isObject(data)) return 'not_an_object';

  const practiceProblem = checkRow(data.practice, practiceSchema);
  if (practiceProblem) return `practice.${practiceProblem}`;

  for (const [collection, fields] of Object.entries(SCHEMAS)) {
    const rows = data[collection];
    if (rows === undefined || rows === null) continue;
    if (!Array.isArray(rows)) return `${collection}_not_an_array`;
    if (rows.length > MAX_ROWS) return `${collection}_too_large`;
    for (let i = 0; i < rows.length; i += 1) {
      const problem = checkRow(rows[i], fields);
      if (problem) return `${collection}[${i}].${problem}`;
    }
  }

  for (const collection of ID_ONLY) {
    const rows = data[collection];
    if (rows === undefined || rows === null) continue;
    if (!Array.isArray(rows)) return `${collection}_not_an_array`;
    if (rows.length > MAX_ROWS) return `${collection}_too_large`;
    for (let i = 0; i < rows.length; i += 1) {
      const problem = checkRow(rows[i], ID);
      if (problem) return `${collection}[${i}].${problem}`;
    }
  }

  // Two team members with one id would let one session masquerade as the other
  // in every actor field the app records.
  if (Array.isArray(data.users)) {
    const seen = new Set();
    for (const user of data.users) {
      if (seen.has(user.id)) return 'users_duplicate_id';
      seen.add(user.id);
    }
  }
  return null;
}
