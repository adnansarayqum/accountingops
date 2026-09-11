# Domain model

Source of truth: `src/domain/types.ts`. Relational target: `db/schema.sql`.
Every tenant-owned entity carries `practiceId`.

## Practice
The tenant. Owns users, clients, services, jobs, communications, documents.
One practice per deployment today; the model is multi-tenant from day one.

## User
An accountant or admin in the practice, with a role and weekly capacity used
by the capacity rule.

## Client
A limited company, sole trader, landlord, partnership or individual. Has an
owner and backup owner, a primary contact, a preferred channel, a lifecycle
(onboarding → active) and transparent behaviour stats used for the
responsiveness band. **Not** a container for everything else — identifiers,
contacts, people, subscriptions, jobs and communications are separate
records that reference the client.

### Contact
People we write to. One is primary.

### ClientIdentifier
UTR, NI number, company number, VAT number, PAYE reference, Accounts Office
reference. Kept apart from the client so they can be encrypted, masked and
access-controlled independently. Company numbers are public and unmasked.

### Person / PersonRole
Directors, PSCs, partners and proprietors are **people**, linked to clients
through roles. Identity verification status, personal-code capture and
evidence status live on the role, not on the client — one person can hold
roles at several companies.

## Service
Catalogue entry (`SERVICES` in `catalog.ts`): name, frequency, default
document requirements, default effort, reminder sequence.

### ServiceSubscription
Which services a client has bought.

## Obligation
The recurring requirement — "Quarterly VAT", "Annual Accounts". Holds the last
period end and the statutory offsets used to compute the next period. Real
statutory rules replace the offsets later without touching jobs.

## Job
One concrete instance of an obligation for one period. Two independent
fields describe where it is:

- **status** — `waiting_for_records → ready_to_start → in_progress →
  internal_review → waiting_client_approval → ready_to_file → filed`
  (backward moves are allowed where sensible; `filed` is terminal).
- **waitingOn** — `client | accountant | senior_review | hmrc |
  companies_house | approval | payment | nothing`.

Also: assignee, reviewer, estimated hours, `statusChangedAt` (drives
staleness rules), `chasingPaused`.

## Information request (InformationRequestItem)
One required document on a job: `missing → requested → received`. Completeness
is computed from required items only. When the last one is received the job
leaves *waiting for records* automatically and chasing stops.

## Document
Metadata for a received file (bytes go to object storage). Linked to client
and optionally job; referenced by the request item it satisfied.

## Communication
Outbound (email/WhatsApp/SMS — simulated in demo) or inbound message. Stores
channel, recipient, body, reminder stage, documents requested, response
status. Reminder attempts are the scheduled/automated view of the same thing.

### ReminderSequence
Steps relative to the due date with channels and tone. Drafts always
reference what has been received and what is still outstanding.

## Blocker
Not a table — a **derived concept** from `waitingOn`, completeness, approvals
and person roles, expressed by the attention rules as reasons and a
recommended action. Keeping it derived means it can never go stale.

## Approval
Internal or client checkpoint on a job: pending/approved/rejected with
reviewer and note. Approving moves the job forward through the rule in the
store, never by editing status directly in the UI.

## FilingRecord
When, by whom, submission reference, destination (HMRC / Companies House),
evidence status. Always `simulated: true` in the demo and labelled as such.

## Activity vs AuditEvent
`Activity` — human feed. `AuditEvent` — append-only record with before/after
values, source and correlation id. Never the same thing.

## InboxItem
An incoming file plus a **suggestion** (client, job, document type, period,
extracted reference, confidence, rationale). Pending until a human confirms
or dismisses. Confirming creates the Document, satisfies the matching request
item, logs an inbound communication and triggers the completeness rule.

## Notification
Operational only: document attached, job ready, deadline approaching,
approval received, job reassigned.

## OnboardingCase / MtdReadiness
Lightweight checklist with stage; MTD ITSA facts evaluated by a transparent
rule into ready / action needed / review / not yet required.
