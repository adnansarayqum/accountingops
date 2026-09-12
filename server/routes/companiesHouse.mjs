/**
 * Companies House proxy. This is the ONLY layer allowed to hold the
 * Companies House API key — it is read from process.env and never sent to
 * the browser. The client calls these routes; it never calls Companies
 * House directly. Read-only public registry data (company search and
 * profile) — no filing, no submission, no identity verification.
 *
 * Mounted at /api/companies-house by both the production server
 * (server/index.mjs) and the Vite dev server (vite.config.ts), so the same
 * router runs unchanged in development and in production.
 */
import express from 'express';
import { mapCompanyProfile, mapOfficers, mapPscs, mapSearchResponse } from '../lib/companiesHouseMappers.mjs';
import { isDatabaseConfigured } from '../lib/db.mjs';
import { createRateLimiter } from '../lib/rateLimit.mjs';
import { requireAuth } from './auth.mjs';

const BASE_URL = 'https://api.company-information.service.gov.uk';

// Companies House company numbers are 8 characters (digits, or a two-letter
// prefix plus six digits); anything outside this can't be a real number and
// never needs to reach the upstream API.
const COMPANY_NUMBER = /^[A-Za-z0-9]{1,10}$/;
const MAX_QUERY_LENGTH = 100;

// Companies House's own allowance is 600 requests per five minutes per
// key. One signed-in user (or, with no database, one address) gets a tenth
// of that, so a runaway loop or a stolen session cannot exhaust the key.
const LOOKUPS_PER_MINUTE = 60;

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function authHeader() {
  const key = process.env.COMPANIES_HOUSE_API_KEY;
  if (!key) return null;
  // Companies House uses HTTP Basic auth with the API key as the username
  // and an empty password.
  return `Basic ${Buffer.from(`${key}:`).toString('base64')}`;
}

/** How long to wait on Companies House before giving up on one lookup — a hung upstream must not hang a whole refresh-all. */
const UPSTREAM_TIMEOUT_MS = 20_000;

async function companiesHouseFetch(path) {
  const auth = authHeader();
  if (!auth) throw new ApiError(503, 'not_configured');
  let res;
  try {
    res = await fetch(`${BASE_URL}${path}`, { headers: { Authorization: auth, Accept: 'application/json' }, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') throw new ApiError(504, 'upstream_timeout');
    throw new ApiError(502, 'upstream_unreachable');
  }
  if (res.status === 404) throw new ApiError(404, 'not_found');
  if (res.status === 401 || res.status === 403) throw new ApiError(502, 'invalid_credentials');
  if (res.status === 429) throw new ApiError(429, 'rate_limited');
  if (!res.ok) throw new ApiError(502, `upstream_${res.status}`);
  return res.json();
}

/**
 * Only messages we raised ourselves are safe to echo. Anything else (a
 * mapper choking on an unexpected upstream shape, say) is logged and
 * reported generically so internals never leak into a response.
 */
function sendError(res, err) {
  if (err instanceof ApiError) return res.status(err.status).json({ error: err.message });
  console.error(JSON.stringify({ level: 'error', at: new Date().toISOString(), source: 'companies_house', message: err?.message ?? String(err) }));
  res.status(500).json({ error: 'unknown_error' });
}

function parseCompanyNumber(req, res) {
  const number = String(req.params.number ?? '').trim();
  if (!number) {
    res.status(400).json({ error: 'company_number_required' });
    return null;
  }
  if (!COMPANY_NUMBER.test(number)) {
    res.status(400).json({ error: 'invalid_company_number' });
    return null;
  }
  return number;
}

const router = express.Router();

// Whether a key is set is not secret and the app decides which UI to show
// from it before any lookup, so this stays open; the lookups below don't.
router.get('/status', (_req, res) => {
  res.json({ configured: Boolean(process.env.COMPANIES_HOUSE_API_KEY) });
});

// With a database (and therefore logins) configured, every lookup spends
// the practice's API key on the caller's behalf — so the caller must be one
// of the practice's users. Without one there are no accounts to check
// against, and the app is a single-browser tool; the per-address limit
// below is the only guard in that mode.
router.use((req, res, next) => (isDatabaseConfigured() ? requireAuth(req, res, next) : next()));

export const lookupLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: LOOKUPS_PER_MINUTE,
  keyFor: (req) => req.user?.id ?? req.ip,
});
router.use(lookupLimiter);

router.get('/search', async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (q.length < 2) return res.status(400).json({ error: 'query_too_short' });
  if (q.length > MAX_QUERY_LENGTH) return res.status(400).json({ error: 'query_too_long' });
  try {
    const data = await companiesHouseFetch(`/search/companies?q=${encodeURIComponent(q)}&items_per_page=8`);
    res.json(mapSearchResponse(data));
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/company/:number', async (req, res) => {
  const number = parseCompanyNumber(req, res);
  if (!number) return;
  try {
    const data = await companiesHouseFetch(`/company/${encodeURIComponent(number)}`);
    res.json(mapCompanyProfile(data));
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/company/:number/people', async (req, res) => {
  const number = parseCompanyNumber(req, res);
  if (!number) return;
  try {
    const [officers, pscs] = await Promise.all([
      companiesHouseFetch(`/company/${encodeURIComponent(number)}/officers`),
      // Not every company has PSC data (older companies, or genuinely none) —
      // a 404 here just means no PSCs, not a failure of the whole lookup.
      companiesHouseFetch(`/company/${encodeURIComponent(number)}/persons-with-significant-control`).catch((err) => {
        if (err.status === 404) return { items: [] };
        throw err;
      }),
    ]);
    res.json({ directors: mapOfficers(officers), pscs: mapPscs(pscs), source: 'companies_house' });
  } catch (err) {
    sendError(res, err);
  }
});

export default router;
