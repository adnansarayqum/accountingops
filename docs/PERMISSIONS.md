# Permissions and the server audit trail

Who may do what, enforced **on the server**. The single source of truth is
`server/lib/authorization.mjs`; `server/lib/__tests__/authorization.test.mjs`
holds this table as a literal and fails if the two disagree.

The role that counts is `practice_users.role` — the row behind the session
cookie, loaded by `requireAuth`. A `role` inside a request body or inside the
snapshot (`PracticeData.users[].role`) is display data and is never consulted
for authorisation.

## Roles

| Role | Meaning today |
| --- | --- |
| `owner` | Every seeded account (Adnan, Farhan, Raihan). Everything. |
| `manager` | Runs the practice day to day: ordinary work plus practice settings. |
| `accountant` | Ordinary accountancy work. |
| `admin` | Office administration. Treated like an accountant, **not** as a superuser — the name is ambiguous, so it gets the narrower reading. |
| anything else | Holds **nothing** (every guarded route answers 403). Fail closed. |

Nothing creates a non-owner today (all three seeded accounts are owners), so
this change only narrows what a future non-owner can do; it changes nothing
for the current team.

## Matrix

| Permission | Guards | owner | manager | accountant | admin |
| --- | --- | :-: | :-: | :-: | :-: |
| `data.read` | `GET /api/practice-data` | ✔ | ✔ | ✔ | ✔ |
| `data.write` | `PUT /api/practice-data` — clients, jobs, communications, everything that is not listed below | ✔ | ✔ | ✔ | ✔ |
| `history.read` | `GET /api/practice-data/history` (versions and who saved them — no client data) | ✔ | ✔ | ✔ | ✔ |
| `messages.send` | `POST /api/messages/send` | ✔ | ✔ | ✔ | ✔ |
| `hmrc.read` | `POST /api/hmrc/vat/:vrn/obligations` (uses the existing connection) | ✔ | ✔ | ✔ | ✔ |
| `practice.configure` | a `PUT` that changes `practice` — name, timezone, timing thresholds | ✔ | ✔ | — | — |
| `snapshot.restore` | `POST /api/practice-data/restore` — replaces the live practice with an earlier version | ✔ | — | — | — |
| `hmrc.connect` | `GET /api/hmrc/connect`, `GET /api/hmrc/callback`, `POST /api/hmrc/disconnect` | ✔ | — | — | — |
| `team.manage` | a `PUT` that adds, removes or re-roles a team member, or changes anyone's capacity/colour/name other than the caller's own name and initials | ✔ | — | — | — |
| `audit.read` | `GET /api/practice-data/security-audit` | ✔ | — | — | — |

Not in the matrix, because they are per-user or public by design: sign-in and
sign-out, `GET /api/auth/me`, changing your own password, your own briefing
settings, the Companies House proxy, client-portal links, `GET /api/hmrc/status`
and `GET /api/messages/status` (configuration state, no secrets).

Denials are `403 { "error": "forbidden", "permission": "<name>" }`, and are
recorded (below). An unauthenticated request is still `401` first.

## How it is enforced

- **Route guards** — `requirePermission(permission)` runs after `requireAuth`
  on each route above.
- **The snapshot is one document**, so "who may change practice settings or
  the team" is a question about what *differs* between the stored snapshot
  and the incoming one. `server/lib/snapshotGuards.mjs` computes that inside
  the write transaction (against the row it has locked, so a stale client
  cannot be judged against an old copy) and refuses the write with the
  permission it would have needed. Only `practice` and `users` are protected;
  `reminderSequences` deliberately is not (nothing edits it, and older
  snapshots have defaults filled in client-side — guarding it would refuse
  ordinary saves for changes the user never made).
- **Anyone may correct how they themselves are shown** (`name`, `initials` on
  their own row). Everything else about a team member is roster data.
- **The first save of an empty practice** may come from any role — there is
  nothing yet to protect — and is recorded as `snapshot.created`.
- **The UI mirrors this but never decides it.** `/api/auth/me` and the login
  response include `permissions` (computed from the same table); Settings
  hides restore, HMRC connect/disconnect, threshold editing and renaming a
  colleague when the role lacks them. A client that ignores this gets the 403.
  If the server predates `permissions`, the UI shows everything, as before.
- **If a forbidden change slips through the UI** (an out-of-date tab), the
  store drops it and reloads the stored practice, rather than retrying — every
  later save from that tab would otherwise carry the refused change too.

## The audit trail

Two different things, kept apart on purpose:

| | `PracticeData.auditEvents` | `security_audit_log` |
| --- | --- | --- |
| Written by | the browser, inside the snapshot | server code only |
| Trustworthy? | **No.** Anyone with a session can write, edit or delete these. A convenience activity trail (identifier reveals, job transitions…). | Yes: actor comes from the session, never from a request. |
| Mutable? | Yes | No: database triggers refuse `UPDATE`, `DELETE` and `TRUNCATE` for every role, including the application's. |

Guards on the client-written trail (`inspectClientAuditEvents`):

- A **new** event may only claim `source: "ui"`. `system` and `api` are what a
  server-originated record would say, so a write containing one is refused
  (`400 audit_event_source_forbidden`) and the attempt is recorded.
- Events attributed to a different user than the one signed in are **counted
  and reported** in the real trail (`snapshot.client_audit_actor_mismatch`),
  not refused — a rebase or a retention trim legitimately produces oddities.

What `security_audit_log` records (`action` → when):

| Action | When |
| --- | --- |
| `auth.login` | every sign-in success and failure (attempted username only — never the password) |
| `auth.password_changed`, `auth.logout_everywhere` | those operations |
| `authorization.denied` | any refusal above, with permission, method, path and what changed |
| `snapshot.restore` | a restore — written **in the same transaction** as the restore |
| `practice.settings_changed`, `practice.team_changed` | an allowed write that changed protected sections (field names; roles from→to; never names) |
| `snapshot.created` | the first save of an empty practice |
| `snapshot.write_rejected`, `snapshot.client_audit_actor_mismatch` | forged or suspicious client audit data |
| `hmrc.connect_started`, `hmrc.connected`, `hmrc.connect_failed`, `hmrc.connect_refused`, `hmrc.disconnected` | the HMRC connection lifecycle |
| `message.email_sent` | a **real** (non-simulated) send: provider, recipient *domain* only |

Failure behaviour: for operations that change the practice as a whole (restore,
settings/team changes, HMRC connect and disconnect) the record is written
first / in the same transaction and the operation does not go ahead if it
cannot be. For sign-in and email it is best-effort and logged loudly — a
failure to write the note must not make sign-in or sending unavailable.

Never stored, even if a caller passes them: keys containing `password`,
`token`, `secret`, `cookie`, `authorization`, `body` or `content`
(`scrubDetails` in `server/lib/securityAudit.mjs`).

Reading it: `GET /api/practice-data/security-audit?limit=100&action=<exact>`
(owner only, newest first, capped at 500). There is deliberately no route that
writes or edits it. For production, also grant the application's database role
only `INSERT` and `SELECT` on the table; the triggers are the backstop, not a
substitute for least-privilege grants.

## Known limits (Phase 1)

- Roles are coarse. Field-level rules (e.g. hiding identifiers from some
  roles) are not implemented; every role that can read the snapshot reads all
  of it.
- Because the practice is one JSON document, `data.write` is broad: an
  accountant's save can change any client record. The protection here is for
  the practice-wide tier only.
- There is no team-management UI; roles change by a database update to
  `practice_users.role`, which should itself be done deliberately (and is
  not audited by the app).
