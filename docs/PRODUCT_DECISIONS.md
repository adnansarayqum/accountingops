# Product decisions

A running log of decisions that shape the product. Newest at the bottom.

### 1. It is an operations command centre, not a CRM or bookkeeping tool
Scope is deliberately: what's due, what's missing, what's blocked, chase it,
what next. No ledgers, tax computations, reconciliations, filings or payment
collection. This keeps the product explainable and focused.
*(Amended by #19: bank statement transactions are now read, categorised and
exported. Everything else here still holds.)*

### 2. Status and "waiting on" are separate fields
A job's lifecycle position and who holds the next move are different
questions. Conflating them produced impossible states in the PoC (e.g.
"waiting for records" that were actually with the accountant). Every rule and
screen uses both.

### 3. Explainable rules instead of a risk score
Accountants will not act on a number they can't defend to a client or a
partner. Every attention item states the rule that fired, the reasons, the
owner and one recommended action. Rules live in one file and are tested
against the fixture dataset (`src/testing/fixtures.ts`).

### 4. Chasing stops itself
Chasing eligibility is derived from completeness and `waitingOn`, never from a
flag someone has to remember to clear. Receiving the last document ends
chasing and moves the job on in the same mutation.

### 5. Reminders are specific
Drafts always list what was received and what is still outstanding, in the
client's preferred channel, at the tone of the current sequence step. "Please
send your documents" is not allowed.

### 6. AI suggests, humans confirm
The Smart Inbox never attaches a document on confidence alone. Confidence and
rationale are shown; the accountant confirms, changes or dismisses.

### 7. Identifiers are masked with a deliberate, audited reveal
Display masking is a UX convenience. Every reveal writes an audit event now so
the behaviour is established before real authorisation arrives.

### 8. Directors and PSCs are people, not client attributes
One person can be a director of several companies; identity verification is
per person-role. This models Companies House reality and avoids duplicating
verification state.

### 9. The fixture dataset's dates are relative to build time
`buildFixtureData(today)` (used by tests) generates every date relative to
whatever `today` it's called with, so it never goes stale. Period ends are
snapped to month ends (5 April for Self Assessment) so they read like real
statutory periods.

### 10. Recurrence is keyed, not date-added
The next job is generated from the obligation's last period end and period
length, and de-duplicated on (obligation, period key) — enforced by a unique
constraint in the schema. Statutory offsets are data on the obligation so
real rules can replace them.

### 11. One store, one derived view
All mutations go through the application store; all screens read one memoised
derived view. This is what makes cross-screen reactivity reliable and what a
server API will preserve.

### 12. Activity and audit are different things
Activity is editable, friendly and filterable. Audit is append-only with
before/after values and a correlation id. The UI shows both, side by side,
so the distinction is visible.

### 13. Multi-tenant shape, single practice today
`practiceId` on every record and row-level security in the schema, even
though this build only ever runs one practice. Frontend filtering is never
the tenant boundary.

### 14. Stay on React + Vite
No Next.js migration: no SEO need, and the Railway shape (static build +
Express + Postgres later) is simpler. Revisit only if server-rendered pages
become a requirement.

### 15. A new practice starts genuinely empty; sample data is test-only
Earlier builds auto-seeded a synthetic dataset on first load with an
in-app "reset" button. That's gone: `src/application/emptyState.ts` is the
only thing a fresh practice ever boots with (one owner, zero clients). The
old seed logic survives as `src/testing/fixtures.ts`, used exclusively by
the unit and e2e test suites — never loaded by the app itself.

### 16. Capacity is a simple, explainable load model
Remaining effort by status × estimate, against chargeable hours (60% of
contracted). Not a project-management tool; enough to answer "who is
overloaded next week?" and rebalance inline.

### 17. Companies House ships live; HMRC and accounting software do not
Three external integrations were on the table: company registry lookup,
HMRC (Making Tax Digital), and third-party accounting software (Xero,
QuickBooks, FreeAgent, Sage). Only Companies House is built as a live,
working connection — a free public API, no OAuth, no approval process,
read-only. HMRC requires the firm to become a recognised software vendor
and per-client OAuth agent authorisation, which is weeks of process on
HMRC's side, not code; it stays architected (the domain model already has
`WaitingOn = 'hmrc'` and a filing destination) but unconnected until that's
real. Accounting-software sync is not built at all: each vendor needs its
own OAuth registration, and pulling ledger data would cross into
bookkeeping, which decision #1 rules out. See `docs/INTEGRATIONS.md`.

### 18. External integration credentials never reach the browser
Every external API key lives only in a server-side proxy
(`server/routes/<provider>.mjs`), read from `process.env`, and the browser
talks only to this app's own `/api/<provider>/*` routes. The same proxy
router is mounted in `npm run dev`, `vite preview`, and production — not a
dev-only stub — so what's tested locally is what runs on Railway. Without a
credential configured, the feature falls back to a labelled sample dataset
rather than breaking.

### 19. Bank statement transactions are in scope — read, view, correct, export; not a ledger
Decision #1 ruled out bookkeeping. Ray, the practice's principal, asked for
the opposite on one point: when a client sends a bank statement on WhatsApp
or by email, he wants every transaction on it, viewable per client, with a
suggested category he can correct, a check for missing months, and a CSV he
can load into Xero or QuickBooks. That is worth reversing #1 for, narrowly.

What is now in scope: every line of a *shared bank statement*, read by a
model (Sonnet; the document-reading model stays Opus), stored in its own
tables (`bank_statements`, `bank_transactions`) rather than the practice
snapshot, shown per client, categorised against a fixed small chart that a
person can correct, checked (do the lines add up to the closing balance? is a
month missing between statements?), and exported as CSV.

What is still out: a ledger, double entry, reconciliation against invoices,
tax computation, anything that posts to or reads from Xero/QuickBooks/etc.
(#17 stands — the export is a file the accountant loads herself). Categories
are suggestions for the accountant's own bookkeeping, not accounts of record.

Safeguards that come with it: the model's lines are checked before storage
and anything it can't back up is dropped and counted rather than guessed; the
statement's own opening and closing balances are kept so a bad read shows
itself; only an account number's last four digits are stored; the data lives
in DB mode only and is sent to Anthropic like every other shared document (see
`docs/INTEGRATIONS.md`).

### 20. Automatic client reminders are opt-in, email-only, and never silent
Until now every message to a client was a person pressing Send. Ray asked
for the follow-ups to happen on their own: the deadline approaches, the
client is emailed. That is a real change — the app speaking to a client in
the practice's name with nobody watching — so it is bounded tightly.

It is **off** until an owner or manager switches it on in Settings → Automatic
reminders (a practice setting, so only `practice.configure` can change it, and
the change is audited). When on, the server sends a client the next step of
the reminder sequence the Chasing page already shows, and only when:

- the step is an **email** step and the client's main contact has an email
  address and doesn't prefer another channel — phone, WhatsApp and text steps
  are left on the Chasing page for a person;
- it is a weekday between 08:00 and 18:00 in the practice's timezone;
- the job is genuinely waiting on the client (the same `assessChasing` the
  Chasing page uses, ported to the server and held to the original by a
  parity test), not paused, not filed;
- at least 48 hours have passed since the last reminder, the deadline isn't
  more than 30 days gone, and the sequence hasn't run out — after which it is
  a person's move, shown in Settings as "left for you".

A step is sent **at most once**: it is claimed in a database table with a
unique (job, step) key before anything is sent, and a send whose outcome is
unknowable (connection lost mid-send) is never retried — a person is told.
Every send is recorded on the client's timeline flagged *Automatic*, counts
toward the sequence, and shows in the activity feed. Nothing is sent without a
real email provider; the simulated provider never "sends" automatically.
Settings can preview the exact emails first.

The server never writes the practice snapshot itself (that would bypass
permissions and the audit trail); it queues what it sent and the next open
tab records it, the same hand-off as portal uploads and shared documents.

