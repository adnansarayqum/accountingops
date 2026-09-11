# Product decisions

A running log of decisions that shape the product. Newest at the bottom.

### 1. It is an operations command centre, not a CRM or bookkeeping tool
Scope is deliberately: what's due, what's missing, what's blocked, chase it,
what next. No ledgers, tax computations, reconciliations, filings or payment
collection. This keeps the product explainable and the demo sharp.

### 2. Status and "waiting on" are separate fields
A job's lifecycle position and who holds the next move are different
questions. Conflating them produced impossible states in the PoC (e.g.
"waiting for records" that were actually with the accountant). Every rule and
screen uses both.

### 3. Explainable rules instead of a risk score
Accountants will not act on a number they can't defend to a client or a
partner. Every attention item states the rule that fired, the reasons, the
owner and one recommended action. Rules live in one file and are tested
against the demo dataset.

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

### 9. Demo dates are relative to today
The dataset is regenerated from "today" on reset, so the dashboard never goes
stale. Period ends are snapped to month ends (5 April for Self Assessment)
so they read like real statutory periods.

### 10. Recurrence is keyed, not date-added
The next job is generated from the obligation's last period end and period
length, and de-duplicated on (obligation, period key) — enforced by a unique
constraint in the schema. Statutory offsets are data on the obligation so
real rules can replace them.

### 11. One store, one derived view
All mutations go through the application store; all screens read one memoised
derived view. This is what makes the demo's cross-screen reactivity reliable
and what a server API will preserve.

### 12. Activity and audit are different things
Activity is editable, friendly and filterable. Audit is append-only with
before/after values and a correlation id. The UI shows both, side by side,
so the distinction is visible.

### 13. Multi-tenant now, single practice in demo
`practiceId` on every record and row-level security in the schema. Frontend
filtering is never the tenant boundary.

### 14. Stay on React + Vite for the demo
No Next.js migration before the demo: no SEO need, and the Railway shape
(static build + Express + Postgres later) is simpler. Revisit only if
server-rendered pages become a requirement.

### 15. Demo reset lives in Settings behind a confirmation
Deliberately away from anything used during the presentation.

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
credential configured, the feature falls back to a labelled synthetic
dataset rather than breaking, matching the product's existing demo-first
posture.
