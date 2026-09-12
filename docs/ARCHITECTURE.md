# Architecture

## Shape

A single TypeScript codebase, three layers, one direction of dependency:

```
pages / ui  ──►  application (store, selectors, assistant)  ──►  domain (types, rules)
                         │
                         └──►  persistence (PracticeRepository)
```

- **domain** — plain types and pure functions. No React, no storage, no dates
  from the wall clock (every rule takes `today`). This is where every business
  rule lives, and it is the only place they live.
- **application** — the Zustand store owns *all* mutations. Each mutation
  clones state, applies the change, applies domain rules for side effects
  (e.g. completeness → status transition), records activity + audit +
  notification, and persists through the repository. `selectors.ts` derives
  every cross-screen view (attention queue, job views, metrics, capacity) from
  data once per change, memoised.
- **pages / ui** — render derived views and call store actions. No business
  logic. No direct storage access.

### Why React + Vite, not Next.js (for now)

The product is an authenticated, single-tenant-per-session operations tool:
no SEO, no public pages, heavy client interactivity. Vite gives the fastest
iteration and a trivial Railway deployment (static build + Express). When a
server-side API arrives it mounts under `/api` in `server/` (or becomes its
own Railway service) without touching the UI. Migrating to Next.js would add
churn with no architectural payoff.

## Persistence boundary

`src/application/persistence/repository.ts` defines `PracticeRepository`
(`load / save / clear`). Three adapters exist, and `src/App.tsx` picks one
at start-up from `/health`:

- `HttpRepository` — the shared, server-backed mode. Used once a signed-in
  session exists (`DATABASE_URL` configured). Every save PUTs the whole
  `PracticeData` snapshot to `/api/practice-data`, which stores it as one
  JSONB row per practice (`practice_snapshots`, bootstrapped by
  `server/lib/db.mjs` on first use). The server checks the shape before
  storing (`server/lib/practiceDataShape.mjs`) and caps the body at 2 MB.
  On the client side, `src/domain/retention.ts` keeps the snapshot from
  growing without bound: the activity feed and audit log are capped at
  2,000 entries each and notifications at 500 (newest kept), audit entries
  older than the newest 500 keep their header but lose their before/after
  values (identity-related actions excepted), and any single before/after
  payload over 2 KB of JSON is replaced by a short summary. The caps apply
  after every change and to every snapshot on load, so one saved before
  they existed shrinks on its next save. Business records — clients, jobs,
  communications, documents, filings — are never trimmed.
- `LocalStorageRepository` — the browser-only mode, used when no database
  is configured. Versioned envelope; a schema bump discards stale
  snapshots. A refused write (quota, private window) throws so the store
  can say so.
- `MemoryRepository` — tests.

Two things the store does around every adapter (`src/application/store.ts`):
saves are serialised — one in flight, only the newest queued snapshot sent
behind it — and a load that fails leaves the store read-only (`loadFailed`)
with a retry banner, because the first save from a writable empty
stand-in would replace the real practice. `refresh()` re-reads the stored
snapshot when the tab regains focus and before the background Companies
House sync writes, so an idle tab doesn't carry on from a stale copy.

**The mode seam.** `/health` reports `database` (configured) and
`databaseReachable` (answered a ping just now) separately. No database is
the browser-only mode; a configured database that isn't answering — or a
server error from `/api/auth/me` — is an outage and shows a retry screen
(`src/pages/UnavailablePage.tsx`), never the browser-only mode, so nothing
gets typed into a local copy that would never reach the team.

**Versioned writes.** Every stored snapshot carries a version. `load()`
remembers it, `save()` sends it as `expectedVersion`, and the server refuses
a write built on an older version with **409** and the snapshot actually
stored (`server/routes/practiceData.mjs`, row-locked in one transaction).
The store then replays the unsaved mutations on top of that snapshot and
saves again — they are pure functions of the data, so both people's work
survives — and only after three lost races does it take the server's copy
and tell the user their last change wasn't saved. Every accepted write is
also kept in `practice_snapshot_history` (the last 50), listed under
Settings → Version history; a restore writes the chosen version as a *new*
version, so it is itself undoable.

The whole-aggregate snapshot is still an interim adapter — two people
editing the same record at the same moment replay by mutation, not by
field. The target is the per-entity, tenant-scoped API over
`db/schema.sql`; because components never touch storage, that swap stays
confined to this folder plus the store's actions.

## Business rules (all in `src/domain/rules/`)

| File | Rule |
| --- | --- |
| `completeness.ts` | Required-document completeness and % |
| `transitions.ts` | Allowed job transitions, default *waiting on*, auto-transition on completeness |
| `chasing.ts` | Chasing eligibility (stops when complete or not client-blocked), next sequence step, reminder drafting |
| `attention.ts` | Explainable red/amber rules with reasons + recommended action |
| `nextAction.ts` | Single source of "what happens next" per job |
| `recurrence.ts` | Next-period generation with duplicate prevention keyed on obligation + period |
| `capacity.ts` | Load per user by remaining effort vs chargeable hours |
| `metrics.ts` | Dashboard KPIs and efficiency stats |
| `readiness.ts` | MTD ITSA status; Companies House identity readiness |
| `responsiveness.ts` | Client behaviour bands and suggestions |
| `masking.ts` | Display masking of identifiers |

Every rule is deterministic, explainable and unit-tested.

## Status vs blocker

`Job.status` (where the work is in its lifecycle) and `Job.waitingOn` (who
holds the next move) are independent fields. Rules use both: a job can be
*waiting for records* while *waiting on the accountant* (e.g. Corporation Tax
waiting on approved accounts) and must not trigger client chasing.

## Cross-screen consistency

There is exactly one derived view (`computeDerived`) and it is recomputed
whenever `data` changes. Screens subscribe to it. There is no per-page cache
to invalidate and no manual refresh.

## Background automation

This build has no worker. The interfaces automation will need already exist
as pure functions that take `today`:

- deadline / recurring job generation → `generateNextJob`
- reminder scheduling → `assessChasing` + `nextReminderStep`
- overdue detection and briefing → `evaluateAttention`, `computeDashboardMetrics`
- document processing → the `InboxItem.suggestion` contract

A Railway worker service will run these on a schedule against PostgreSQL,
writing `reminder_attempts`, `risk_evaluations` and `notifications`. The
`db/schema.sql` tables for those already exist. Add the worker only when the
first real scheduled job needs it.

## Assistant

`src/application/assistant/tools.ts` is the complete tool surface:
`search_clients`, `get_client_identifier`, `get_attention_queue`,
`get_upcoming_jobs`, `get_missing_information`, `get_waiting_on_clients`,
`get_capacity`, `get_ready_to_file`. `router.ts` maps questions to tools
deterministically. A model is introduced by replacing the router with
tool-calling; the tools stay tenant-scoped and bounded. The database is never
serialised into a prompt. Identifier answers are masked; full reveal happens
only in the client record, where it is audited.

## External integrations

A live external integration follows one pattern, established by the
Companies House lookup (full detail in `docs/INTEGRATIONS.md`):

1. **A server-side proxy router** (`server/routes/<provider>.mjs`) is the
   only code allowed to read that provider's credentials from
   `process.env`. The browser calls this app's own `/api/<provider>/*`
   routes — never the third-party API directly — so a key never reaches
   client-side JavaScript.
2. **A pure mapper module** (`server/lib/<provider>Mappers.mjs`) translates
   the provider's JSON into this app's own slim shape. It has no network
   dependency, so it's unit-tested directly against fixture JSON.
3. **One router, two mount points, identical behaviour.** The production
   server (`server/index.mjs`) and the Vite dev/preview server
   (`vite.config.ts`, via a small plugin wrapping the router in a full
   `express()` app) mount the exact same router — `npm run dev` and Railway
   run the same code path, not a dev-only stub.
4. **A client-side wrapper** (`src/integrations/<provider>.ts`) calls the
   proxy and falls back to a clearly-labelled sample dataset
   (`source: 'sample'`) when the proxy reports the credential isn't
   configured, or the network call fails — so a missing key degrades the
   feature, it never breaks the page. Where a screen needs to say *why*
   there was no live answer (the import preview), a `lookup*` variant
   reports the outcome instead of substituting sample data.
5. **The proxy is not open.** When a database (and therefore logins) is
   configured, every lookup requires a signed-in session — the key is
   spent on the caller's behalf. Each caller is limited to sixty lookups a
   minute, company numbers and query length are validated before any
   upstream call, and only the proxy's own error codes are echoed back.

Companies House ships this way today: free key, no OAuth, read-only company
search and profile lookup, used to auto-fill company details during
onboarding. HMRC and accounting-software integrations are deliberately not
built the same way yet — they need vendor recognition, per-client OAuth, or
(for accounting software) would cross into bookkeeping, which is out of
scope. See `docs/INTEGRATIONS.md` for the full reasoning.

## Activity vs audit

`Activity` is a human feed and may be filtered or reworded. `AuditEvent` is
append-only: actor, action, entity, before, after, timestamp, source,
correlation id. In PostgreSQL the application role has no UPDATE/DELETE on
`audit_events`.

## Multi-tenancy

Every tenant-owned record carries `practiceId`. `db/schema.sql` enables
row-level security on every tenant table with a policy on
`current_setting('app.practice_id')`, which the API sets per transaction.
Front-end filtering is never the tenant boundary.

## Security posture and roadmap

Present today:

- **Authentication** for the three practice accounts (`server/routes/auth.mjs`):
  username + password, scrypt-hashed, in an `httpOnly` `SameSite=Lax` session
  cookie (14 days; `Secure` whenever the request arrived over TLS). Password
  hashes are self-describing (`scrypt$N$r$p$salt$hash`, `server/lib/passwords.mjs`)
  at an OWASP-recommended cost (N=2^15, r=8, p=3 — ~32 MB, ~0.3 s); a hash
  stored at an older cost, or in the original plain-hex format, still
  verifies with the parameters it was made with and is re-hashed at the
  current cost on the next successful sign-in, so raising the cost later is
  a one-line change that locks nobody out. Parameters read back from a row
  are bounds-checked before use, so a tampered row can't turn one sign-in
  into a multi-gigabyte derivation. Session
  tokens are stored **hashed** (`server/lib/sessionTokens.mjs`) — a database
  row alone can never authenticate as anyone; only the raw cookie value
  produces a matching hash. Accounts are seeded once at boot (production:
  `server/index.mjs`; dev/preview: once per server start in `vite.config.ts`
  — no longer self-healing on every request) from `*_TEMP_PASSWORD`
  variables, with a forced change on first sign-in **enforced server-side**:
  `requireAuth` — the shared guard in front of practice data, the Companies
  House proxy and messaging — refuses any request from a session still
  carrying `mustChangePassword` with `403 password_change_required`, so a
  temporary password (however it reached someone) can't be used to read or
  write practice data before it's replaced. An account with no `*_TEMP_PASSWORD`
  variable gets a random temporary password; it's logged to stdout only
  when `LOG_GENERATED_PASSWORDS=1` — a deploy platform's logs are often
  visible to more people than have credential access, so the default is a
  message saying an account needs setup, not the password itself. Ten
  attempts per username and sixty per address in fifteen minutes; unknown
  usernames cost a real verification so timing doesn't reveal which names
  exist. Changing a password (Settings → Your account) revokes every other
  session for that account, keeping only the one making the change signed
  in; **Sign out everywhere** revokes all of them, including the current one,
  for "I think someone else has access" without knowing which session that is.
- **Server-side persistence** of the whole practice snapshot behind that
  session, shape-checked and size-capped before it can overwrite the stored
  one (see *Persistence boundary*).
- **Headers on every response** (`server/lib/securityHeaders.mjs`): a
  Content-Security-Policy (self-only scripts — `index.html` carries no
  inline script), HSTS over TLS, `nosniff`, `X-Frame-Options: DENY`,
  referrer and permissions policies. The same middleware runs in `vite
  preview`, so the e2e suite exercises the real policy.
- Companies House proxy behind the login and rate-limited (see *External
  integrations*); masked identifiers with audited reveal; simulated sends
  and filings; tenant id on every record; no bodies or identifiers in
  server logs.

Known gaps, in the order they should close: the audit log lives inside the
client-authored snapshot, so "every reveal is audited" is forgeable by
anyone who can PUT a snapshot — the real fix is a server-side, append-only
table. Then, before wider use: RBAC (owner/manager/accountant/admin) with
field-level authorisation for identifiers, encryption at rest for
`client_identifiers.value_encrypted` (envelope keys in a KMS), object storage
with signed URLs for documents, redaction middleware for logs, retention and
deletion policies, secrets in Railway variables only.

## Railway

Services:

1. **web** — `npm ci && npm run build`, `npm start`, health check `/health`
   (`railway.json`). Serves the SPA; API mounts under `/api`. `/health`
   stays 200 even when the database is unreachable — the payload says so —
   because restarting a healthy container doesn't fix a database.
2. **postgres** — Railway plugin, referenced as `DATABASE_URL`. The three
   tables the interim snapshot adapter needs (`practice_snapshots`,
   `practice_users`, `practice_sessions`) are created on first use by
   `server/lib/db.mjs`; `db/schema.sql` is the target relational schema and
   is not applied yet. When it is, apply it via a migration tool
   (recommended: `node-pg-migrate` or Drizzle migrations) in a release
   command.
3. **worker** — added only when scheduled automation is real.

Configuration is environment-only (`.env.example`). The filesystem is never
used for persistent client files. Logs are single-line JSON. Shutdown is
graceful on SIGTERM.

## Testing

- **Domain / unit** (`src/domain/rules/__tests__`) — completeness, chasing
  (including stop-when-complete and not-client-blocked), transitions,
  recurrence and duplicate prevention, attention rules against the fixture
  dataset (`src/testing/fixtures.ts`), metrics, capacity.
- **Integration** (`src/application/__tests__`) — store workflows: reminder,
  inbox confirm, final document → ready, approvals, filing → next job once,
  reassignment, client creation, identifier reveal audit; assistant routing;
  persistence (serialised saves, read-only after a failed load, refresh);
  the mode seam in `auth.test.ts`.
- **Server** (`server/**/__tests__`) — routers over a real local HTTP
  server: headers, rate limits, shape validation, the Companies House
  proxy with `fetch` stubbed. The auth and practice-data suite needs a
  local Postgres (`DATABASE_URL`) and is skipped without one.
- **E2E** (`e2e/`) — two modes that must both stay green. Without
  `DATABASE_URL` (the default): a brand-new empty practice
  (`empty-practice.spec.ts`), the fixture's ten-scene journey on desktop
  and mobile (`scenario-journey.spec.ts`), a render-cleanly sweep of every
  screen (no console errors, no horizontal overflow), the outage screen
  (`persistence.spec.ts`), overlays, import, theme under the CSP. With
  `DATABASE_URL` and the `*_TEMP_PASSWORD` variables set for the Playwright
  web server: `auth.spec.ts` — sign in, forced change, shared data between
  two accounts. Run the two separately; the login suite wipes the test
  database between tests.
