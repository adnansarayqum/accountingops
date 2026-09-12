# External integrations

This document is the honest map of what connects to what: what genuinely
works today, what's architected but not connected, and what's deliberately
out of scope. Three categories were considered — company registry lookup,
HMRC, and third-party accounting software — and they are not equally
feasible, so they're treated differently.

## Messaging — email live (Postmark), WhatsApp by hand-off, SMS simulated

**What it does.** A reminder drafted from a job's actual outstanding items
leaves the app in one of three ways, chosen by channel and shown on the
send button and in Settings → Messaging:

- **Email** — sent through this app's own `/api/messages/send` by the
  provider named in `MESSAGING_EMAIL_PROVIDER`. `postmark` sends it for real
  (Postmark's message id is kept on the communication); the default,
  `simulated`, logs it and sends nothing — exactly what the app always did.
- **WhatsApp** — not sent by the app at all. Send opens WhatsApp on the
  accountant's own device (a `wa.me/<number>?text=<draft>` link) with the
  message filled in; they press send there. Logged as *handed off*.
  Business-initiated WhatsApp messages need Meta-approved templates and a
  verified business (days to weeks, per-template approval) and can't carry
  the free-text drafts this app writes — for three people sending a few
  dozen reminders, the hand-off is the honest fit.
- **SMS** — simulated. An alphanumeric UK sender (free, no registry) is
  one-way, so the draft's "reply here" wording would need to change first;
  a rented number (~$2.50/month) is the alternative. Not built until a
  sender is chosen.

**How to turn on live email:**

1. Create a Postmark server, verify the sender address (or the domain) the
   reminders will come from.
2. Set `MESSAGING_EMAIL_PROVIDER=postmark`, `POSTMARK_SERVER_TOKEN` and
   `MESSAGING_FROM_EMAIL` (optionally `MESSAGING_FROM_NAME`) in the
   environment. See `.env.example`.
3. Restart. `GET /api/messages/status` reports the provider and whether it's
   configured; Settings → Messaging shows the same.

**Architecture.** Same pattern as Companies House: the browser never holds
a provider credential. `server/lib/messaging/` has one adapter per provider
behind a tiny interface (`send({to, subject, body}) → {providerMessageId,
status}`), selected per channel by environment and defaulting to
`simulated`, so development and tests never need a provider. The route
validates the recipient, subject and body, requires a signed-in session
when a database is configured, limits each caller to thirty sends a minute,
and remembers each draft's idempotency key for ten minutes so a double
click or a replayed request can't send the same reminder twice. Every
communication records how it left (`deliveryStatus`, `providerName`,
`providerMessageId`), and the client record shows it.

**What this is not.** No inbound path yet — a client's reply doesn't
change `responseStatus` unless it arrives through the Smart Inbox — and no
delivery webhooks (bounces show up in Postmark's activity log, not here).
Both need a server-side store of their own rather than the whole-practice
snapshot; see the roadmap in `docs/ARCHITECTURE.md`.

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
so nobody mistakes it for a real company, and sample data is never recorded
against a client as though it came from the register.

**Who can use it.** When a database (and so sign-in) is configured, every
lookup requires a signed-in session — the key is spent on the caller's
behalf, and Companies House allows 600 requests per five minutes per key.
Each signed-in user gets sixty lookups a minute; the background refresh
(a handful of the stalest clients every half hour, from a visible tab only)
stays well inside that. In the browser-only mode there are no accounts, so
the per-address limit is the only guard.

**Beyond the profile.** The client record also pulls active directors and
individual PSCs (`/api/companies-house/company/:number/people`), previous
company names, and refreshes automatically once a day per client, with a
"Synced … ago" line and a Refresh button on the client's Companies House
card. **Refresh all from Companies House** on the Clients page does every
limited company with a company number in one pass, paced under the proxy's
rate limit (`src/application/refreshAllClients.ts`) and saved as one change,
for when the whole roster should be brought up to date now rather than
over the background sync's next few hours. Companies House writes the same person two ways ("SMITH, Jane" in the
officers list, "Mrs Jane Smith" in the PSC list); both are folded into
"Jane Smith" and matched as one person, with month/year of birth as the
tie-breaker (`src/domain/personNames.ts`). Each refresh also reads the
person's `identity_verification_details`: a date Companies House records
the verification against (an authorised agent's `identity_verified_on`, or
an appointment verification statement still in force) marks that role
**Verified** in Readiness, noted as "Confirmed by Companies House", and
clears the confirmation-statement warning in Needs Attention. It only ever
upgrades — a status the practice set by hand is kept, and Companies House
saying nothing is never read as "not verified" (it omits the details for
many people who have verified directly, so the manual path stays). People
recorded twice before
that folding existed (an import's "HASAN, Mohammad" next to a refresh's
"Mr Mohammad Hasan", each with a role at the same client) are listed under
Settings → Duplicate people and merged only on confirmation, as one
ordinary saved change (`src/domain/peopleMerge.ts`): roles the kept record
lacks move to it, roles both hold are combined keeping the furthest-along
verification, and namesakes at different clients or with different birth
months are never touched.

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
