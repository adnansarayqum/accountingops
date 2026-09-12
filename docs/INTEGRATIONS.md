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

### Live change notifications (streaming API)

The REST endpoints above are pull: something has to ask, and asking about
every client on a schedule is what the rate limit is there to stop. The
**streaming API** is the other half — Companies House push every change to
the register down one long-lived connection, and the server filters that
firehose down to this practice's own company numbers.

**Turning it on** needs a *second* key: a streaming application has to be
registered as such at the same developer hub, and the REST and streaming
keys are not interchangeable. Set `COMPANIES_HOUSE_STREAM_API_KEY`, and
note it also needs `DATABASE_URL` — the listener has nowhere to record what
it saw otherwise, so the browser-only mode reports the feed off rather than
showing an integration that cannot work there.
`GET /api/companies-house/stream/status` reports whether both are in place.

**What it does, and deliberately does not do.** The listener records *that*
a client's register entry moved (`server/lib/companiesHouseStream*.mjs`).
It never writes to the practice snapshot. Every save is the whole practice
under an optimistic version check, so a background writer would race every
edit anyone is making; instead the change surfaces on the Clients page and
a person pulls it in with the same explicit refresh that already existed,
saved as one ordinary version. A dismissed change clears the notice and
changes no client data.

**What it filters.** Companies House republish a record whenever anything
on it moves, including fields this app never shows (links, image metadata).
Only fields that map to something tracked here — accounts and confirmation
statement dates, name, status, registered office, SIC codes, cessation —
count as a change worth reporting, so "3 clients changed" stays worth
reading. Deletions always count.

**Protocol rules it obeys**, all from the Companies House docs and all unit
tested without a socket: HTTP Basic with the streaming key as the username;
blank lines are heartbeats and are ignored; every event carries a
`timepoint` which is stored so a restart resumes rather than replays; a
`429` waits the mandatory minute before reconnecting; a `416` means the
stored timepoint is too old, so it is dropped and the gap is logged rather
than silently skipped; and a connection that goes quiet past the heartbeat
window is abandoned and remade — a socket that is open but finished never
resolves a read, so the idle timer has to race the read rather than be
checked between reads.

**Beyond the profile.** The client record also pulls active directors and
individual PSCs (`/api/companies-house/company/:number/people`), previous
company names, and refreshes automatically once a day per client, with a
"Synced … ago" line and a Refresh button on the client's Companies House
card. **Refresh all from Companies House** on the Clients page does every
limited company with a company number in one pass, paced under the proxy's
rate limit (`src/application/refreshAllClients.ts`; past 25 clients it
pauses, with a countdown on the button, before the next batch) and saved as
one change,
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
many people who have verified directly, so the manual path stays). Whatever
it did say is recorded on the role and shown under it on Readiness and the
client's Directors & PSCs card — "verified 4 Mar 2026", "verification
statement due by 28 Sep 2026", or "nothing published yet" — and a Needs
Attention item counts the statements the register is expecting and by
when. Each Readiness card links to the company's officers page on the
register for the authoritative view. People
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

## HMRC (Making Tax Digital) — built, sandbox-first, awaiting credentials

The VAT (MTD) integration is written and tested. What it is waiting on is
HMRC, not code: sandbox credentials are issued on registration, but
**production** credentials additionally require HMRC to review the
application's fraud prevention headers and approve it. That is weeks, on
their timeline.

**Why this matters to the practice.** The roster import creates accounts,
confirmation statement and corporation tax work. It creates nothing for
VAT, and VAT comes round four times a year. HMRC's *retrieve VAT
obligations* endpoint returns each filing period and the statutory due date
**they** hold, so a changed stagger corrects itself instead of going stale
in a spreadsheet.

**One authorisation, not one per client.** An earlier version of this
document said access was per-client OAuth; that is wrong, and worth
correcting because it changes the design. HMRC issue an OAuth token to the
*agent*: the practice signs in once with its agent services account and
grants this software access. The practice's authority over each individual
client is a separate relationship — clients are linked to the agent
services account — and HMRC check it themselves on every call. So
`hmrc_agent_tokens` holds one row, not one per client
(`server/lib/hmrc/tokenStore.mjs`).

**Fraud prevention headers are the gate.** HMRC require sixteen headers on
every call for this app's architecture ("web application via server") and
audit them before granting production credentials — an incomplete or
badly-formatted set is the most common reason an application is refused.
Several describe the *end user's* device (screen, window, timezone, browser
user agent, a stable device id) which a server cannot know, so the browser
collects them (`src/integrations/hmrcDeviceData.ts`) and posts them with
each request; the server adds its own half and formats the set
(`server/lib/hmrc/fraudPreventionHeaders.mjs`). That device id is a random
UUID identifying the browser — no name, no account, nothing derived from
practice data.

The client **refuses to call HMRC at all** with an incomplete set, naming
what is missing. HMRC would accept it in the sandbox and refuse the
application at approval time, which is the worst place to find out.

**Sandbox unless told otherwise.** `HMRC_ENVIRONMENT` has to say exactly
`production` to leave the sandbox — a typo must never point live traffic at
the real thing. Sandbox obligations are canned test scenarios selected with
a `Gov-Test-Scenario` header, not real deadlines, and the UI labels them as
such. That header is never sent at production, where it would be
meaningless.

**No sample-data fallback.** Companies House has one because approximating
a public register is harmless. A VAT deadline is not: a failed call reports
why (`not_connected`, `client_not_authorised`, `invalid_vrn`,
`fraud_headers_incomplete`) rather than showing a plausible date nobody
should act on.

**Turning it on:** register at <https://developer.service.hmrc.gov.uk/>,
subscribe the application to the VAT (MTD) API, and set `HMRC_CLIENT_ID`
and `HMRC_CLIENT_SECRET` (plus `HMRC_VENDOR_PUBLIC_IP` for the vendor
headers). `GET /api/hmrc/status` reports whether credentials are present,
which environment, and whether an agent account is connected — never the
tokens. Settings → HMRC connects and disconnects it.

Filing itself stays explicitly simulated (`FilingRecord.simulated: true`,
labelled in the UI). Reading obligations is a much smaller commitment than
submitting returns, and is where the value is.

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
