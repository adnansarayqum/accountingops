/**
 * The HMRC Making Tax Digital HTTP client.
 *
 * Holds the OAuth credentials (never sent to the browser), selects the
 * sandbox or production host, sends the versioned Accept header HMRC use
 * for API versioning, attaches the fraud prevention headers, and maps their
 * error bodies onto this app's vocabulary.
 *
 * Two things it deliberately will not do:
 *  - call HMRC without a complete fraud prevention header set. They accept
 *    an incomplete set in the sandbox and refuse the application at approval
 *    time, which is the worst possible place to discover the problem;
 *  - fall back to sample data. Companies House has a sample mode because a
 *    public register is harmless to approximate; a VAT deadline is not.
 *    A failed call reports why.
 */
import { isComplete, missingHeaders } from './fraudPreventionHeaders.mjs';
import { mapErrorCode, mapObligations, obligationsQuery } from './vatObligations.mjs';

export const SANDBOX_BASE_URL = 'https://test-api.service.hmrc.gov.uk';
export const PRODUCTION_BASE_URL = 'https://api.service.hmrc.gov.uk';

/** HMRC select the API version from the Accept header, not the path. */
export const VAT_ACCEPT = 'application/vnd.hmrc.1.0+json';

const UPSTREAM_TIMEOUT_MS = 20_000;

export class HmrcError extends Error {
  constructor(code, status, detail) {
    super(code);
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

/** Sandbox unless HMRC_ENVIRONMENT says production — the safe way round. */
export function baseUrl(env = process.env) {
  return env.HMRC_ENVIRONMENT === 'production' ? PRODUCTION_BASE_URL : SANDBOX_BASE_URL;
}

export function isHmrcConfigured(env = process.env) {
  return Boolean(env.HMRC_CLIENT_ID && env.HMRC_CLIENT_SECRET);
}

/** True while pointed at the sandbox — the UI says so, because sandbox figures are not real deadlines. */
export function isSandbox(env = process.env) {
  return baseUrl(env) === SANDBOX_BASE_URL;
}

async function parseBody(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * One authenticated call. `accessToken` is the agent's OAuth token; the
 * caller is responsible for having refreshed it (see tokenStore.mjs).
 */
export async function hmrcFetch(path, { accessToken, fraudHeaders, testScenario, method = 'GET', env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (!isComplete(fraudHeaders)) {
    throw new HmrcError('fraud_headers_incomplete', 400, { missing: missingHeaders(fraudHeaders) });
  }
  const headers = {
    Accept: VAT_ACCEPT,
    Authorization: `Bearer ${accessToken}`,
    ...fraudHeaders,
  };
  // Sandbox-only: picks one of HMRC's canned scenarios. Sending it against
  // production would be meaningless, so it never leaves the sandbox.
  if (testScenario && isSandbox(env)) headers['Gov-Test-Scenario'] = testScenario;

  let res;
  try {
    res = await fetchImpl(`${baseUrl(env)}${path}`, { method, headers, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') throw new HmrcError('upstream_timeout', 504);
    throw new HmrcError('upstream_unreachable', 502);
  }

  const body = await parseBody(res);
  if (!res.ok) {
    throw new HmrcError(mapErrorCode(res.status, body?.code), res.status, { code: body?.code ?? null, correlationId: res.headers?.get?.('X-CorrelationId') ?? null });
  }
  return body;
}

/**
 * A client's VAT obligations. Defaults to open only, which is both what a
 * deadline list wants and the one case where HMRC don't require a date
 * range (see obligationsQuery).
 */
export async function fetchVatObligations(vrn, options = {}) {
  const query = obligationsQuery({ status: options.status ?? 'open', from: options.from, to: options.to });
  const body = await hmrcFetch(`/organisations/vat/${encodeURIComponent(vrn)}/obligations?${query}`, options);
  return mapObligations(body);
}
