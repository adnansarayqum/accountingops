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

const BASE_URL = 'https://api.company-information.service.gov.uk';

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

async function companiesHouseFetch(path) {
  const auth = authHeader();
  if (!auth) throw new ApiError(503, 'not_configured');
  let res;
  try {
    res = await fetch(`${BASE_URL}${path}`, { headers: { Authorization: auth, Accept: 'application/json' } });
  } catch {
    throw new ApiError(502, 'upstream_unreachable');
  }
  if (res.status === 404) throw new ApiError(404, 'not_found');
  if (res.status === 401 || res.status === 403) throw new ApiError(502, 'invalid_credentials');
  if (res.status === 429) throw new ApiError(429, 'rate_limited');
  if (!res.ok) throw new ApiError(502, `upstream_${res.status}`);
  return res.json();
}

const router = express.Router();

router.get('/search', async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (q.length < 2) return res.status(400).json({ error: 'query_too_short' });
  try {
    const data = await companiesHouseFetch(`/search/companies?q=${encodeURIComponent(q)}&items_per_page=8`);
    res.json(mapSearchResponse(data));
  } catch (err) {
    res.status(err.status ?? 500).json({ error: err.message ?? 'unknown_error' });
  }
});

router.get('/company/:number', async (req, res) => {
  const number = String(req.params.number ?? '').trim();
  if (!number) return res.status(400).json({ error: 'company_number_required' });
  try {
    const data = await companiesHouseFetch(`/company/${encodeURIComponent(number)}`);
    res.json(mapCompanyProfile(data));
  } catch (err) {
    res.status(err.status ?? 500).json({ error: err.message ?? 'unknown_error' });
  }
});

router.get('/company/:number/people', async (req, res) => {
  const number = String(req.params.number ?? '').trim();
  if (!number) return res.status(400).json({ error: 'company_number_required' });
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
    res.status(err.status ?? 500).json({ error: err.message ?? 'unknown_error' });
  }
});

router.get('/status', (_req, res) => {
  res.json({ configured: Boolean(process.env.COMPANIES_HOUSE_API_KEY) });
});

export default router;
