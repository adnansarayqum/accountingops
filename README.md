# Farhan & Raihan Accounting Operations Hub

An operations layer for small UK accountancy practices. It is **not** bookkeeping,
tax or filing software. It answers, continuously:

> **Know what's due. Know what's missing. Know what's blocked. Chase it automatically. Know what to work on next.**

The accountant should not manage the software; the software manages the
accountant's attention.

## What it does

| Screen | Purpose |
| --- | --- |
| **Practice Today** | KPIs (due in 30 days, overdue, waiting on client, ready to file, on-time %), the top of the attention queue, operational efficiency, Smart Inbox and deadlines at a glance. |
| **Needs Attention** | Explainable operational rules (no opaque risk score). Every item shows *why* it fired, the blocker and a recommended one-click action. |
| **Clients** | Fast, forgiving search — name, contact, company number, UTR, VAT or PAYE reference — without exposing identifiers in results. |
| **Client record** | Identifiers (masked, audited reveal), services, obligations timeline, open jobs, information requests, communications, activity, directors/PSCs and a handover summary. |
| **Jobs / Job** | Status and *waiting on* tracked independently. Document checklist with completion %, approval checkpoints, simulated filing, communications, next action. |
| **Chasing** | Reminder sequences per service. Drafts reference the actual outstanding items. Chasing stops automatically when everything is received. |
| **Smart Inbox** | Incoming documents with suggested client/job/type/confidence. AI suggests, a human confirms; confirming attaches, updates the checklist and recalculates everything. |
| **Onboarding** | Lightweight lead → active checklist with stage tracking. Search Companies House by name to auto-fill company number, registered address and year end. |
| **Capacity** | Load per accountant for 7/30/60 days with inline reassignment. |
| **Readiness** | MTD for Income Tax and Companies House director/PSC identity verification. |
| **Briefing** | Morning summary with ranked priorities. |
| **Activity** | Human-readable feed, separate from the append-only audit log. |
| **Ask the Practice** | Deterministic answers from scoped application tools (an LLM can be introduced behind the same tools). |

Every mutation flows through one store and one set of domain rules, so a
document confirmed in the inbox updates the checklist, the job status, the
attention queue, the chasing list, capacity and the dashboard with no refresh.

## Local setup

```bash
npm install
npm run dev          # http://localhost:5173
```

A brand-new practice starts empty — one signed-in owner, zero clients — and
everything is stored in `localStorage`. Add your first client from **Clients
→ New client** to see the workflow in action. (There's also a rich
[test scenario](docs/TEST_SCENARIOS.md) used by the test suite, if you want
to see the product with realistic data without hand-entering it.)

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | Typecheck + production build to `dist/` |
| `npm start` | Express server serving `dist/` with `/health` (what Railway runs) |
| `npm run typecheck` | `tsc -b` |
| `npm run lint` | ESLint |
| `npm test` | Vitest unit + integration tests |
| `npm run test:e2e` | Playwright end-to-end (builds and serves the app itself) |
| `npm run check` | typecheck + lint + unit tests + build |

For Playwright in environments with a pre-installed browser, set
`PLAYWRIGHT_CHROMIUM_PATH=/path/to/chromium`.

## Environment variables

See [`.env.example`](.env.example). This build needs none to run. Railway injects
`PORT`. `DATABASE_URL`, object storage and messaging provider keys are
reserved for the server-side persistence and integration layers.

## Project layout

```
src/
  domain/          types, catalogue, dates, and rules/ (pure, tested business rules)
  application/     store (all mutations), selectors (derived views), persistence/, assistant/, emptyState.ts
  testing/         fixture dataset builder used by tests only (fixture-relative dates)
  ui/              layout (shell, sidebar, palette) and reusable components
  pages/           one file per screen
server/            Express web server for Railway
db/schema.sql      PostgreSQL schema with tenant isolation
docs/              architecture, domain model, product decisions, test scenario walkthrough
e2e/               Playwright specs
```

## Further reading

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — layers, persistence boundary, background automation, Railway, security.
- [docs/DOMAIN_MODEL.md](docs/DOMAIN_MODEL.md) — Practice, Client, Service, Obligation, Job, Request, Document, Communication, Blocker, Approval.
- [docs/PRODUCT_DECISIONS.md](docs/PRODUCT_DECISIONS.md) — the important decisions and why.
- [docs/TEST_SCENARIOS.md](docs/TEST_SCENARIOS.md) — the fixture dataset's story, scene by scene.
- [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md) — Companies House (live), HMRC and accounting software (why they're not).

## What's simulated

There is no live messaging or filing integration yet: sending a reminder and
marking a job as filed are both simulated and clearly labelled as such —
nothing leaves the application. Display masking of identifiers is a UX
convenience, not a security control — see the security section in
`docs/ARCHITECTURE.md`.
