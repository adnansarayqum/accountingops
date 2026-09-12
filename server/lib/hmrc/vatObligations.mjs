/**
 * Mapping HMRC's VAT obligations onto something this app can use.
 *
 * `GET /organisations/vat/{vrn}/obligations` returns each VAT period a
 * business is obliged to file, with the statutory due date HMRC themselves
 * hold. That is the point of the whole integration: this app currently
 * tracks no VAT deadlines at all for imported clients, and a hand-keyed one
 * goes stale the moment HMRC change a stagger.
 *
 * Their shape (from the published OpenAPI spec):
 *   { obligations: [ { start, end, due, status, periodKey, received? } ] }
 * where status is "O" (open) or "F" (fulfilled), dates are YYYY-MM-DD, and
 * periodKey is four alphanumeric characters that occasionally contain "#".
 *
 * Pure and synchronous — the client that actually makes the call lives in
 * client.mjs, so every rule here is testable against fixtures.
 */

/** HMRC's single-letter status codes. */
const OPEN = 'O';
const FULFILLED = 'F';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Normalises one obligation. Returns null for anything missing a field the
 * app needs — a period with no due date can't become a deadline, and
 * inventing one would be worse than skipping it.
 */
export function mapObligation(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const { start, end, due, status, periodKey, received } = raw;
  if (!ISO_DATE.test(start ?? '') || !ISO_DATE.test(end ?? '') || !ISO_DATE.test(due ?? '')) return null;
  if (typeof periodKey !== 'string' || !periodKey.trim()) return null;
  return {
    periodStart: start,
    periodEnd: end,
    dueDate: due,
    // HMRC's period key is the handle for every later call about this
    // period (submitting the return, retrieving it), so it is kept as-is,
    // "#" and all, rather than normalised into something tidier.
    periodKey: periodKey.trim(),
    fulfilled: status === FULFILLED,
    receivedOn: ISO_DATE.test(received ?? '') ? received : null,
  };
}

/**
 * Every usable obligation from a response, earliest period first. HMRC say
 * the list is already sorted by start date; sorting again costs nothing and
 * means the app doesn't depend on that staying true.
 */
export function mapObligations(body) {
  const list = Array.isArray(body?.obligations) ? body.obligations : [];
  return list
    .map(mapObligation)
    .filter((o) => o !== null)
    .sort((a, b) => a.periodStart.localeCompare(b.periodStart) || a.periodEnd.localeCompare(b.periodEnd));
}

/** Just the ones still to file — what a deadline list actually wants. */
export function openObligations(body) {
  return mapObligations(body).filter((o) => !o.fulfilled);
}

/**
 * Whether a VRN is well-formed. HMRC define it as nine digits; checking
 * here means a typo in a client record never becomes an upstream call, and
 * never puts a malformed value into a URL path.
 */
export function isValidVrn(vrn) {
  return typeof vrn === 'string' && /^\d{9}$/.test(vrn.trim());
}

/**
 * A VAT number as a practice writes it ("GB 123 4567 89") reduced to the
 * nine digits HMRC want. Returns null when what's left isn't a VRN, rather
 * than a half-stripped string.
 */
export function normaliseVrn(value) {
  if (typeof value !== 'string') return null;
  const digits = value.replace(/[^0-9]/g, '');
  return /^\d{9}$/.test(digits) ? digits : null;
}

/**
 * The status query parameter. HMRC make `from`/`to` mandatory *unless*
 * status is "O", which is the one case where this app wants everything
 * outstanding regardless of date — so asking for open obligations
 * deliberately sends no date range.
 */
export function obligationsQuery({ status, from, to } = {}) {
  const params = new URLSearchParams();
  if (status === 'open') {
    params.set('status', OPEN);
    return params.toString();
  }
  if (status === 'fulfilled') params.set('status', FULFILLED);
  // Outside the open-only case a range is required, so a caller that gives
  // neither gets an explicit error rather than a 400 from HMRC.
  if (!ISO_DATE.test(from ?? '') || !ISO_DATE.test(to ?? '')) {
    throw new Error('a from and to date are required unless asking only for open obligations');
  }
  params.set('from', from);
  params.set('to', to);
  return params.toString();
}

/**
 * HMRC's error bodies are `{ code, message }` with a documented code set.
 * Mapping them to this app's own vocabulary keeps upstream wording out of
 * the UI and makes the ones worth acting on distinguishable: a client who
 * has not authorised us is a very different problem from a bad VRN.
 */
export function mapErrorCode(status, code) {
  if (status === 401) return 'not_authorised';
  if (status === 403) {
    // HMRC use 403 both for "this agent has no authority for this client"
    // and for a client who is insolvent or otherwise blocked.
    if (code === 'CLIENT_OR_AGENT_NOT_AUTHORISED') return 'client_not_authorised';
    if (code === 'VRN_INVALID') return 'invalid_vrn';
    return 'forbidden';
  }
  if (status === 404) return 'not_found';
  if (status === 400) return code === 'VRN_INVALID' ? 'invalid_vrn' : 'bad_request';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'upstream_error';
  return 'unknown_error';
}
