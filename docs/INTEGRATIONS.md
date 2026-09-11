# External integrations

This document is the honest map of what connects to what: what genuinely
works today, what's architected but not connected, and what's deliberately
out of scope. Three categories were considered — company registry lookup,
HMRC, and third-party accounting software — and they are not equally
feasible, so they're treated differently.

## Companies House — live, working today

**What it does.** Type a company name while onboarding a client (New client
→ Client → "Look up on Companies House"). Pick a match and the form
auto-fills:

- Company name and number
- Registered office address
- Incorporation date
- SIC codes
- Accounting reference date → the client's year end
- Company status (active / dissolved / etc.), shown on the client record

**Why this one is easy.** Companies House publishes UK company data for
free, by design — it's a public register. The API needs a single free API
key (no OAuth, no approval process, no waiting) and every endpoint used
here is read-only.

**How to turn on live lookups:**

1. Register at <https://developer.company-information.service.gov.uk/> and
   create a REST API key (a few minutes, free).
2. Set `COMPANIES_HOUSE_API_KEY` in the environment (`.env` locally, a
   Railway variable in production). See `.env.example`.
3. Restart the app. `GET /api/companies-house/status` reports
   `{"configured": true}` once it's picked up.

**Without a key configured**, the same UI keeps working against a small
synthetic dataset (`src/integrations/companiesHouseMock.ts`), so onboarding
is never blocked. Every result is labelled "Sample data — not a live lookup"
so nobody mistakes it for a real company.

**Architecture.** The browser never talks to Companies House directly and
never sees the API key. It calls this app's own proxy
(`server/routes/companiesHouse.mjs`), which holds the key server-side, calls
the real API, and maps the response to a slim internal shape
(`server/lib/companiesHouseMappers.mjs`, unit-tested against fixture JSON).
The same Express router is mounted in production (`server/index.mjs`) and in
`npm run dev` / `npm run build && npm run preview` (via a small Vite plugin
in `vite.config.ts`) — one code path, not two.

```
Browser → CompanyLookup component → /api/companies-house/search
                                          │
                          server/routes/companiesHouse.mjs (holds the key)
                                          │
                        https://api.company-information.service.gov.uk
```

**What this is not.** It's a lookup, not a filing. Nothing is submitted to
Companies House. Confirmation statements and accounts are still filed
(simulated) the way the rest of the product already does.

## HMRC (Making Tax Digital) — architected, not connected

This is genuinely a different scale of problem, not a smaller version of
the Companies House integration:

- Your firm must register as a **recognised software vendor** with HMRC and
  pass their compliance process (fraud-prevention headers, a working
  sandbox integration, a production application review). This takes weeks
  and is on HMRC's timeline, not something that can be coded into
  existence.
- Access is **per-client OAuth 2.0**: each client must separately authorise
  your firm as their agent through HMRC's agent-services flow before you
  can call the API on their behalf. There's no single firm-wide key.
- VAT, Income Tax (ITSA) and Corporation Tax are **separate API products**
  with separate scopes and separate testing requirements.

None of that can be faked into a working integration without misrepresenting
what the product does. What exists instead:

- `WaitingOn = 'hmrc'` and `FILING_DESTINATION` already model HMRC as a
  destination in the domain layer (`src/domain/catalog.ts`).
- Filing stays explicitly simulated (`FilingRecord.simulated: true`,
  labelled in the UI) until real MTD access is in place.
- The natural next step, when your firm has HMRC vendor recognition, is a
  `server/routes/hmrc.mjs` proxy following the exact same pattern as
  Companies House: credentials never reach the browser, and each client's
  OAuth tokens would be stored server-side (see `docs/ARCHITECTURE.md`'s
  security roadmap for where encrypted token storage fits).

## Accounting software (Xero, QuickBooks, FreeAgent, Sage) — deliberately out of scope for now

Two separate reasons, not one:

1. **Feasibility.** Each vendor needs its own OAuth app registration and
   review process — four separate integrations, not one.
2. **Product scope.** Pulling ledger or transaction data from these systems
   is bookkeeping, which this product is deliberately not (see
   `docs/PRODUCT_DECISIONS.md`, decision #1). The moment this reads a bank
   feed or a chart of accounts, it has become a different product.

If a real need shows up later, the right shape is narrow and read-only —
e.g. "does a client with this name already exist in Xero?" for onboarding
deduplication — not a ledger sync. No code exists for this today.

## Security notes

- API keys live only in environment variables read server-side
  (`process.env.*` inside `server/`); they are never sent to the browser,
  never logged, and never appear in a proxy response (see the "never leaks
  the Authorization header" test in
  `server/routes/__tests__/companiesHouse.test.mjs`).
- The proxy pattern generalises: any future external integration gets its
  own router under `/api/<provider>`, its own credential(s) from the
  environment, its own mapper module, and its own tests — the browser only
  ever talks to this application.
