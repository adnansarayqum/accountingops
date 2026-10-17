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
when a database is configured, and limits each caller to thirty sends a
minute. Every communication records how it left (`deliveryStatus`,
`providerName`, `providerMessageId`), and the client record shows it.

**Real email fails closed.** A provider that really delivers mail (Postmark)
only runs in *authenticated, server-backed* mode — a database is configured,
so every request carries a signed-in user. With no database (the original
browser-only build, which has no login) a configured Postmark is refused with
`503 authenticated_mode_required`: nothing is sent, and nothing is silently
simulated either (the UI would then log a "sent" that never left).
`GET /api/messages/status` reports it as `configured: false` with that error.
The guard is enforced in the provider selector, in the Postmark adapter itself,
and in the route, so no caller can reach Postmark around it. The simulated
provider keeps working everywhere, exactly as before.

**Idempotency is durable when it matters.** One key per opened draft, so a
double click, a retry, a second tab or a restart can't send the same reminder
twice. For signed-in sends the key is *claimed* by an `INSERT` into
`email_send_claims` (`server/lib/emailClaims.mjs`), which PostgreSQL makes
atomic: of any number of simultaneous requests with one key, exactly one calls
the provider; the rest are answered `409 send_in_progress` or, once it has
finished, replay its result unchanged (`deduplicated: true`).

- **Scoped to the signed-in user** — someone else's identical key neither
  replays nor blocks yours.
- **Bound to the message** — the same key with different content is refused
  `422 idempotency_key_reused`, never answered with the wrong message's result.
- **Kept 24 hours**, then reusable.
- **Never guesses.** If Postmark returned an error the message was not
  accepted, so the claim is released and the same key may try again. If the
  outcome cannot be known (connection lost mid-send, a crash after claiming, a
  lease that ran out — the provider call itself times out at 20 s, the lease is
  120 s) the key is kept as `unknown` and answered `409 send_outcome_unknown`:
  a duplicate to a client is worse than asking a person to check Postmark's
  activity log and reopen the composer for a new key.
- **Browser-only simulated mode** keeps a ten-minute in-memory map. Nothing is
  sent there, so losing it on restart costs nothing.

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

**Token storage.** The agent's OAuth tokens are one row (`hmrc_agent_tokens`)
covering every client the practice has appointed, so it is worth protecting
as its own thing: set `HMRC_TOKEN_ENCRYPTION_KEY` and they are encrypted at
rest (AES-256-GCM), rather than sitting as plain text in a database that a
backup, replica, or unrelated bug could otherwise expose. `/api/hmrc/status`
reports `tokenEncryption: true/false` so this is visible rather than a
silent gap. Leaving it unset keeps working exactly as before — nothing is
required to connect HMRC in the first place.

Filing itself stays explicitly simulated (`FilingRecord.simulated: true`,
labelled in the UI). Reading obligations is a much smaller commitment than
submitting returns, and is where the value is.

## Accounting software (Xero, QuickBooks, FreeAgent, Sage) — deliberately out of scope for now

Two separate reasons, not one:

1. **Feasibility.** Each vendor needs its own OAuth app registration and
   review process — four separate integrations, not one.
2. **Product scope.** Pulling ledger or transaction data from these systems
   is bookkeeping, which this product is deliberately not (see
   `docs/PRODUCT_DECISIONS.md`, decisions #1 and #17). Reading the lines off a
   bank statement a client *sends* is in scope (#19) — it ends in a CSV file the
   accountant loads herself, never a connection to these systems.

If a real need shows up later, the right shape is narrow and read-only —
e.g. "does a client with this name already exist in Xero?" for onboarding
deduplication — not a ledger sync. No code exists for this today.

## Morning briefing by email — live, needs a database

The Briefing page is the best screen in the app for starting the day and
nobody sees it unless they open a tab and navigate there. So it is also an
email: overdue, due this week, ready to file, and clients who have gone
quiet after a chase, every weekday morning, per user, to an address each
account sets in Settings → Account.

It is a digest of facts, deliberately not a re-implementation of the
attention rules — those are `src/domain/rules` and the app's business; the
email links to the app for the *why*. `server/lib/briefing.mjs` composes it
from the stored snapshot and decides when (weekday, from the send hour in
the practice's own timezone, once a day, catching up later if the server
was asleep at seven); `briefingScheduler.mjs` owns the one-minute timer.
Delivery goes through the same email provider as reminders, so with
Postmark configured it is sent and without it is simulated and logged.
"Send me one now" in Settings avoids waiting until tomorrow for the first.

## Automatic client reminders — live, needs a database and a real email provider

Off by default. An owner or manager switches it on in Settings → Automatic
reminders (decision #20 in PRODUCT_DECISIONS.md has the reasoning and every
limit). When on, the server checks every ten minutes and emails each client
the next step of their reminder sequence when it falls due.

How it is built:

- `server/lib/chasingRules.mjs` is the server's copy of the chasing rules
  (`assessChasing`, `draftReminder`, the sequence choice). The server is plain
  Node and can't import the TypeScript, so a parity test runs both over every
  job in the fixture practice on several days and fails if they disagree.
  Change one, change both.
- `server/lib/automation.mjs` plans a pass from the stored snapshot: what is
  due, what is waiting for its day, what is left for a person and why.
  `automationRunner.mjs` sends, `automationScheduler.mjs` owns the ten-minute
  timer (not run in the first moments after a deploy).
- `auto_reminders` is the ledger. A step is *claimed* (unique on job + step)
  before the email goes, so a double tick, two server instances or a crash can
  never send it twice. If the provider definitely refused, the claim is freed;
  if the outcome is unknowable it is kept as *unknown* and reported in
  Settings — never silently retried.
- The server does not write the practice's data. `GET /api/automation/activity`
  queues what was sent; the next open tab (`useAutoReminderActivity`) records
  it as an ordinary communication flagged *Automatic* and acknowledges it.
  Until acknowledged, a sent reminder still counts toward the sequence, so the
  next step waits its 48 hours.
- Email only, to the client's main contact, through the same Postmark provider
  as manual reminders. Without `MESSAGING_EMAIL_PROVIDER=postmark` the card
  says nothing can be sent and the scheduler sends nothing.

Settings has **Preview what would be sent now** (the exact emails, and the
jobs left for a person) and **Send due reminders now** (rate-limited; audited
as `automation.run_now`). What is not covered: WhatsApp and SMS steps (a
person sends them), and a tab has to be opened for the record to appear on the
client's timeline — the email itself goes regardless.

## Client portal — live, needs a database

The practice's biggest number is *client-blocked jobs*, and until now the
app gave a client nowhere to unblock one: every document arrived by email,
every approval was typed in after a phone call. The portal is a per-job
link a client can act on with no account.

**Blast radius first.** A link is for one job, one client, one purpose
(upload *or* approve), and expires. The token is 32 random bytes; the
server keeps only its SHA-256, so the URL is shown exactly once at creation
and a lost link is revoked and remade. Every way a link can be wrong —
guessed, expired, revoked, already used — is the same 404, so probing
learns nothing. The public route is rate limited by address, and the
client's view is built server-side from the snapshot with only what the
client needs: no identifiers, no other jobs, no notes, no staff names
(`server/lib/portal.mjs` is the whole rule set, tested without a database).

**Uploads** are capped at 10 MB and twelve files per link, to a list of
document types a client plausibly sends (no executables), with the size
checked from the declared base64 length *before* the body is decoded. The
bytes live in Postgres for now — the documented target is object storage —
and only a signed-in user can read them back. **Approval** links are
single-use: the first decision wins and the link is dead afterwards, and a
name is required so the record says who approved.

**Nothing writes the practice snapshot from the public route.** A client's
upload or decision is queued (`portal_activity`), and the app applies it
through the same store actions an accountant uses (`markItemReceived`,
`recordApproval`), so completeness, auto-transitions and "approved → ready
to file" run exactly once, where they are defined
(`src/application/usePortalActivity.ts`). No confirmation step: these are
the client's own actions on their own job.

Without a database the router answers 503 and the Client link card on the
job page renders nothing, so the browser-only mode is unchanged.

## Telegram photo intake — retired

The first version of "photograph a letter and have it filed" was a Telegram
bot. Sharing into the installed app (below) does the same job for photos,
PDFs and text from WhatsApp or email, and replaced it — the bot's webhook,
account linking, Settings card and its own read-and-match step are gone,
and the `TELEGRAM_*` variables do nothing. Its matching rules live on in
`documentMatch.mjs`. One route stays, `GET /api/telegram/uploads/:id`
(signed in only), because Smart Inbox items and documents it filed still
link to their photos; its tables are kept, not dropped, so nothing it
stored is lost.

## Shared intake — documents shared into the app

Ray's ask from a client call: when clients send bank statements, letters or
details on WhatsApp or by email, share them into the app and have it file
them. `server/routes/intake.mjs` is the engine that phone sharing (and,
later, an iPhone Shortcut and a forwarding address) feed into; it is the
Telegram pipeline generalised, and replaced it.

**One share, one read.** `POST /api/intake/batches` takes any mix of up to
ten photos, PDFs and plain text (checked by their real bytes, not the label
they arrive with; 10 MB a file, 20 MB a share). Every part is stored first
(`intake_uploads`), then one Claude request reads the whole share
(`intakeReader.mjs`) — one request because only seeing all of it lets the
model tell five photos of one bank statement from five different letters.
It answers with the documents it found, each naming the parts that make it
up; `groupParts` makes sure every part lands in exactly one document even
if the model's answer doesn't. Typed text is fenced as content, never read
as instructions, and the answer is schema-bound either way.

**What leaves the server** is the shared files and text, plus each client's
name and non-sensitive identifiers — the same allow-list as Telegram
(`documentMatch.mjs`'s `buildRoster`), never credentials. Matching is the
same too: an identifier on the document that matches exactly one client
wins over the model's own pick; otherwise it files at 85% confidence or
above, and anything less is kept as a best guess for a person to confirm.

**Held for the share screen.** Each document is queued (`intake_activity`)
held back for ten minutes, so the share screen can say "Filing under X" and
let Ray correct it (`/activity/:id/assign`, only by whoever shared it, only
before the practice has it) or press Done (`/batches/:id/release`). An
abandoned share simply releases when the hold runs out — no scheduler. An
open tab then pulls it into Smart Inbox every minute (`useIntakeActivity`),
exactly like the client portal: filed documents arrive attached to
their client, the rest wait under To review, and every page stays one tap
away (`GET /api/intake/uploads/:id`, signed in only, served inline with
`nosniff`; text as `text/plain`). A bank statement from a client counts as
the client getting in touch; an HMRC or Companies House letter does not.

**Suggested updates, never silent ones.** The same read also pulls out what
each document *states*: a filing or payment deadline and what it's for, the
period end, a penalty and its appeal date, and — only from a client's own
message — a new email, phone, address or year end. The model copies facts;
it decides nothing. The server keeps only well-formed values
(`intakeReader.mjs` `sanitiseFacts`: real dates, a known service, a positive
amount, a ten-digit UTR, a GB VAT number) in `intake_activity.facts`. When the
document is attached to a client, the app compares those facts with its own
records (`src/domain/rules/proposals.ts`) and proposes only what differs:
move a job's due date (or add the job if there's none for that period),
record a penalty (a timeline note and a deadline notification), tick off a
checklist item the document satisfies, add a missing UTR or VAT number
(changing one already on file only on the client's own word, and never to
another client's number), update year end or the main contact's details,
or save the client's message as a note. They wait under **Suggested updates**
at the top of Smart Inbox; Apply re-checks each against the records as they
are now and goes through an audited action (`job.due_date`, `job.create`,
`penalty.record`, …); Dismiss drops it.

The same files shared twice in a week are recognised by their hashes and not
read (or paid for) again. Without `ANTHROPIC_API_KEY`, shares are still
stored and land in Smart Inbox unread. DB mode only, like the portal.

**Getting there from a phone.** The app is installable
(`public/manifest.webmanifest`, icons, `theme-color`). On **Android**, once
installed from Chrome, "F&R Ops" appears in WhatsApp's and the mail app's
share sheet: the manifest's `share_target` POSTs the files (and any text) to
`/share-target`, where the service worker (`public/sw.js`) catches them —
handled in the worker rather than the server, so no cross-app cookie or
multipart parsing question arises — parks them in Cache Storage and opens
`/share`. That page sends them to `POST /api/intake/batches`, shows "Filing
under X" or a best guess for each document with a client picker, and Done
releases the share; the parked copy is cleared once the server has it.
Files the server can't read (a voice note, a spreadsheet) are left out and
named. The worker intercepts nothing else and caches nothing, so a deploy
is never hidden behind a stale copy; `index.html`, `sw.js` and the manifest
are served `no-cache` (`server/lib/installable.mjs`). A share that somehow
reaches the server instead is redirected to `/share` with an explanation.
**iPhone** can install the app (Add to Home Screen) but Apple doesn't let
web apps be share targets — sharing in from an iPhone is a Shortcut.

**From inside the app.** On any phone or computer, the camera button in the
header ("Add a document") needs no share sheet at all: *Take a photo* opens
the back camera (`<input capture="environment">`; a desktop browser opens its
file picker), once per page, and *Choose photos or files* picks from the
phone. Pages stay in order, any can be removed, and a pasted client message
can go with them. It then opens the same `/share` page as a share from
WhatsApp — handed over in memory (`application/pendingShare.ts`) rather than
through the service worker's cache — so the reading, the "Filing under X"
check and the client picker are the same, and there is still only one way a
document gets in. Only offered with the signed-in server. A photo taken in
HEIC is converted by the phone's browser for this kind of picker; if one ever
arrives unconverted, the page names it as unreadable rather than losing it.

**The iPhone Shortcut and upload keys.** A Shortcut has no signed-in
session, so each person makes a personal **upload key** in Settings → "Send
from an iPhone" (`intake_tokens`; `frk_` + 256 random bits, shown once, only a
SHA-256 kept, at most five live per person). The Shortcut's one "Get Contents
of URL" action sends `Authorization: Bearer frk_…` and a multipart **Form**
(file fields, and an optional `text` field) to the same
`POST /api/intake/batches`. What a key can and can't do:

- It opens that one route and nothing else — not the activity queue, not the
  files, not the key routes (a key can't mint another). A bad or revoked key is
  refused outright, never falling back to a cookie sent alongside it.
- A multipart form is refused on a cookie alone (415): a multipart POST is a
  "simple" cross-site request, so only a key — which a browser never attaches
  by itself — may send one. The app itself keeps sending JSON.
- The bytes decide a file's type (the Shortcut labels files loosely, often
  `application/octet-stream`), then the same signature checks and limits as the
  JSON path apply, enforced while streaming (`busboy`). iPhone photos are HEIC
  by default and can't be read, so the setup says to add Convert Image → JPEG
  when sharing from Photos; WhatsApp already sends JPEG.
- It shares the per-user rate limit, and a flood of bad keys is limited by
  address. Nothing is held for a share screen: the document goes straight to
  Smart Inbox (`source: shortcut`, shown as "Shared from iPhone").
- The response carries a one-line `message` (where each document went, or
  what was wrong), which the Shortcut shows as a notification.
- Keys are revoked one at a time in Settings, and all at once on "sign out
  everywhere", a password change or an operator password reset.

The Shortcut itself is built by hand from the steps Settings lists — Apple
only accepts Shortcut files it has signed, so there is no file to download.

**Forwarding an email.** Forward any email — attachments and all — to the
practice's inbound address and it is read and filed like a share. Set up
once, in Postmark (the same account that sends reminders, or its own):

1. Create an **Inbound** stream (or a server with one) and note its inbound
   address (`<hash>@inbound.postmarkapp.com`), or point an MX record for a
   subdomain at Postmark to use a friendlier address. Set the address in
   `INBOUND_EMAIL_ADDRESS` so Settings can show it.
2. Set the stream's webhook URL to
   `https://<user>:<password>@<your-host>/api/intake/email/inbound` and put the
   same pair in `INBOUND_EMAIL_USERNAME` / `INBOUND_EMAIL_PASSWORD` (Postmark
   sends them as HTTP Basic). With either unset the route answers 503 and the
   Settings card says it isn't set up.
3. Each person lists the addresses they forward from in Settings → "Email
   documents in" (`intake_senders`; up to five, each belonging to one person).

What it does, and where it deliberately stops:

- **Believed only after four checks:** the webhook credentials, a sender that
  a user has listed, an SPF `pass` in the `Received-SPF` header Postmark adds
  (`INBOUND_EMAIL_REQUIRE_SPF=0` turns that one off), and the per-person limit
  of twenty a minute (429, so Postmark tries again later). An email that fails
  a check gets a 200 and is dropped — Postmark retries anything else, and a
  retry changes nothing — with the reason logged, never the content.
- **One email, one share:** every readable attachment (same types and limits
  as everywhere) plus the email's own text — sender, subject, date and body
  (HTML-only mail is reduced to text) — as a text part. Attachments that can't
  be read (a spreadsheet, a zip) are named in that text, so it's visible that
  something came with it; small inline images such as signature logos are
  ignored.
- **Answered at once, read afterwards:** Postmark gets its 200 as soon as the
  email passes the checks and the read carries on, so a long statement can't
  make Postmark time out and resend. Everything is stored before the read, a
  repeat is recognised by its hashes, and a failed read still lands in Smart
  Inbox unread. Documents go straight there (`source: email`, "Forwarded
  email"), with the same filing rules and suggested updates as any share.
- **Residual risk, stated plainly:** SPF checks the server that sent the
  message, not that its "From" is honest, so a determined spoofer who knew both
  the (unguessable) inbound address and a listed sender could get a document
  read and, if it matched a client confidently, filed. The address is the
  secret to protect; if it leaks, issue a new inbound address and update
  `INBOUND_EMAIL_ADDRESS`.

### Bank statement transactions

A shared document the read calls a **Bank statement** also has every
transaction read off it (`server/lib/bankStatement.mjs`), stored in
`bank_statements` / `bank_transactions` (DB mode only, outside the practice
snapshot) and served by `POST /api/bank/statements/query`. A statement is keyed
by its document's first upload id, so the app finds a client's statements
through the client's own documents; one document is read once however often it
is asked for, and a failed or lost read (older than 15 minutes) can be asked
for again (`POST /api/bank/statements/read`, ten a minute per person).

- **Model.** Sonnet (`TRANSACTIONS_MODEL`, default `claude-sonnet-5-5`; effort
  `TRANSACTIONS_EFFORT`, default `medium`) rather than the Opus that reads and
  sorts documents: transcribing lines is mechanical and statements are long.
  One streamed request per statement with every page, the JSON schema, and the
  same refusal fallbacks as the document read. Reads run one at a time through
  an in-process queue (20 waiting at most) so a burst of statements is not a
  burst of model requests. What is sent is the statement's pages — the
  account holder's name, balances and every line — so this is the most
  personal data the app sends Anthropic; nothing else is added.
- **Checked before it is stored.** A line with a bad date or amount is dropped
  and counted (`dropped_lines`) rather than guessed; categories outside the
  fixed list become "Other / unsure"; a period that is missing or backwards is
  taken from the lines; only the last four digits of an account number are
  kept. The statement's own opening and closing balances are stored so the app
  can show whether the lines add up. A statement too long for one answer
  (about a thousand lines) fails with a clear message rather than storing half.
- **Categories** are a small fixed chart (`BANK_CATEGORIES`) of suggestions for
  the accountant's bookkeeping, correctable per line
  (`PATCH /api/bank/transactions/:id`, marked as the person's own), never
  accounts of record.
- **Where it shows.** A client's page has a "Bank transactions" card linking to
  `/clients/:id/transactions`: the client's statements (reading… / adds up / off
  by £x / failed with a retry), the **checks**, the lines with a category a
  person can change, totals by category, and the export. The page finds the
  statements through the client's own bank-statement documents, and while one
  is being read it asks again every few seconds. A document the model typed
  differently can be changed to "Bank statement" in Smart Inbox; it then shows
  on this page with a "Read transactions" button.
- **Checks** are plain arithmetic, in `src/domain/rules/bankStatements.ts`: does
  opening balance plus every line come to the closing balance (to the penny);
  does any day between a statement and the next of the same account go
  uncovered (a missing month); do two statements overlap (lines then appear
  twice); does a statement open at a different balance than the last one closed
  at; were lines left out. Accounts are told apart by bank and last four digits.
- **Export** is a CSV the accountant loads herself — never a connection to
  Xero or QuickBooks. *Xero*: `*Date,*Amount,Payee,Description,Reference,Check
  Number` (day-first dates, signed amounts); *QuickBooks*: `Date,Description,
  Amount`; *Everything*: every field including the category and who set it. It
  exports the lines currently shown (so filter first to export one account or
  category). A description that starts with `=`, `+`, `-` or `@` is prefixed
  with an apostrophe so a spreadsheet can't run it as a formula; the layouts
  follow the products' documented bank-statement imports but have not been
  loaded into either one.

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
