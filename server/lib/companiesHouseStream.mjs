/**
 * Companies House streaming API — protocol handling.
 *
 * The streaming API (https://stream.companieshouse.gov.uk) pushes every
 * change to the *entire* UK register down one long-lived connection, as
 * newline-delimited JSON. That is the opposite trade to the REST API this
 * app already uses: no per-client polling and no rate limit to pace around,
 * but a firehose to filter. We keep a set of the practice's own company
 * numbers and discard everything else.
 *
 * Everything in this file is pure and synchronous except `readStream`,
 * which is a generator over an already-open response body. The connection
 * manager that owns reconnects lives in companiesHouseStreamListener.mjs,
 * so the protocol rules below can be tested without a socket.
 *
 * Key facts this encodes, from the Companies House docs:
 *  - auth is HTTP Basic, streaming key as username and empty password, and
 *    the streaming key is NOT interchangeable with the REST key;
 *  - a blank line is a heartbeat and must be ignored;
 *  - every event carries `event.timepoint`, and reconnecting with the last
 *    successfully processed timepoint is what makes the stream resumable;
 *  - 429 means back off for at least a minute, and 416 means the timepoint
 *    is too old (or we're consuming too slowly) and must be dropped.
 */

export const STREAM_BASE_URL = 'https://stream.companieshouse.gov.uk';

/** The company profile stream: name, address, accounting dates, status. */
export const COMPANY_PROFILE_PATH = '/companies';

/** Companies House allows two concurrent connections per account; we only ever open one. */
export const MAX_CONNECTIONS = 2;

export function streamAuthHeader(key) {
  if (!key) return null;
  return `Basic ${Buffer.from(`${key}:`).toString('base64')}`;
}

export function streamUrl(timepoint) {
  const base = `${STREAM_BASE_URL}${COMPANY_PROFILE_PATH}`;
  // No timepoint means "start from now", which is what a first-ever connect
  // wants — replaying the backlog of the whole register would be pointless.
  return Number.isInteger(timepoint) && timepoint > 0 ? `${base}?timepoint=${timepoint}` : base;
}

/**
 * One parsed stream record, or null for anything we can't use: a heartbeat
 * (blank line), a partial line, or malformed JSON. A single bad line must
 * never take the connection down — the register is large and we would
 * rather skip one record than stop watching.
 */
export function parseStreamLine(line) {
  const trimmed = typeof line === 'string' ? line.trim() : '';
  if (!trimmed) return null;
  let record;
  try {
    record = JSON.parse(trimmed);
  } catch {
    return null;
  }
  const timepoint = record?.event?.timepoint;
  if (!Number.isInteger(timepoint)) return null;
  const companyNumber = companyNumberOf(record);
  if (!companyNumber) return null;
  return {
    companyNumber,
    timepoint,
    // 'changed' or 'deleted'. A deletion is a dissolved or removed company —
    // worth surfacing loudly, so it is kept rather than filtered out here.
    type: record.event?.type === 'deleted' ? 'deleted' : 'changed',
    publishedAt: typeof record.event?.published_at === 'string' ? record.event.published_at : null,
    // Dot-notation paths ("accounts.next_due", "company_status"). Optional:
    // an event may say only that something changed.
    fieldsChanged: Array.isArray(record.event?.fields_changed) ? record.event.fields_changed.filter((f) => typeof f === 'string') : [],
  };
}

/** A Companies House company number: up to ten letters and digits, nothing else. */
const COMPANY_NUMBER_PATTERN = /^[A-Za-z0-9]{1,10}$/;

/**
 * The company number for a record. `resource_id` is it for the company
 * profile stream; the resource_uri ("/company/01234567") is the fallback
 * for a record that omits it. Both are checked against the same
 * character set: `resource_id` is trusted content from Companies House,
 * but this value flows on to the watch-list match, gets stored, and is
 * returned to the browser (CompaniesHouseChangesCard) — a boundary worth
 * the same discipline the fallback already applied to itself.
 */
export function companyNumberOf(record) {
  const id = record?.resource_id;
  if (typeof id === 'string' && COMPANY_NUMBER_PATTERN.test(id.trim())) return id.trim().toUpperCase();
  const uri = record?.resource_uri;
  if (typeof uri === 'string') {
    const match = /\/company\/([A-Za-z0-9]{1,10})/.exec(uri);
    if (match) return match[1].toUpperCase();
  }
  return null;
}

/**
 * Which of the practice's own clients an event is about, given the watched
 * set. Company numbers are compared upper-cased because a roster may hold
 * "sc123456" where the register says "SC123456".
 */
export function matchesWatched(event, watched) {
  return Boolean(event) && watched.has(event.companyNumber);
}

export function normaliseCompanyNumber(value) {
  return typeof value === 'string' && value.trim() ? value.trim().toUpperCase() : null;
}

/**
 * A change worth telling the practice about. Companies House republishes a
 * record whenever anything on it moves, including fields this app never
 * shows (links, image metadata). Those would turn "3 clients changed" into
 * noise nobody trusts, so only fields that map to something the app tracks
 * count as interesting.
 */
const INTERESTING_PREFIXES = [
  'accounts',
  'annual_return',
  'confirmation_statement',
  'company_name',
  'company_status',
  'date_of_cessation',
  'previous_company_names',
  'registered_office_address',
  'sic_codes',
  'type',
];

export function isInterestingChange(event) {
  if (!event) return false;
  // A deletion, or a change with no field list, is always worth a look.
  if (event.type === 'deleted' || event.fieldsChanged.length === 0) return true;
  return event.fieldsChanged.some((field) => INTERESTING_PREFIXES.some((prefix) => field === prefix || field.startsWith(`${prefix}.`)));
}

/**
 * How long to wait before reconnecting, by why the last connection ended.
 * These follow the Companies House guidance rather than one generic curve:
 * a 429 has a mandatory minimum wait, and reconnecting sooner risks the key.
 */
export const BACKOFF = {
  /** 429: rate limited. Their docs require at least a minute. */
  rateLimited: 60_000,
  /** 416: timepoint too old, or we fell too far behind. Reconnect promptly, without a timepoint. */
  timepointTooOld: 5_000,
  /** Any other HTTP error from the stream endpoint. */
  httpError: 10_000,
  /** A dropped socket or DNS failure — the common case, and the cheapest to retry. */
  network: 2_000,
  /** A clean end of stream (the server closed the connection normally). */
  ended: 1_000,
};

const MAX_BACKOFF_MS = 5 * 60 * 1000;

/**
 * Exponential backoff from the per-reason base, doubling per consecutive
 * failure and capped at five minutes, so a long outage settles into a slow
 * retry instead of hammering. `attempt` is 0 for the first retry.
 */
export function backoffMs(reason, attempt = 0) {
  const base = BACKOFF[reason] ?? BACKOFF.network;
  const exponent = Math.min(Math.max(attempt, 0), 10);
  return Math.min(base * 2 ** exponent, MAX_BACKOFF_MS);
}

/** What a given HTTP status from the stream endpoint means for the next connection. */
export function reasonForStatus(status) {
  if (status === 429) return 'rateLimited';
  if (status === 416) return 'timepointTooOld';
  return 'httpError';
}

/** A 416 means the stored timepoint is unusable — the next connect must start fresh. */
export function shouldDropTimepoint(reason) {
  return reason === 'timepointTooOld';
}

/**
 * Splits a chunk of stream text into complete lines, returning the trailing
 * partial line for the caller to prepend to the next chunk. Records are
 * newline-delimited and a chunk boundary lands mid-record often enough that
 * doing this wrong loses events at random.
 */
export function splitLines(buffer) {
  const parts = buffer.split('\n');
  const remainder = parts.pop() ?? '';
  return { lines: parts, remainder };
}
