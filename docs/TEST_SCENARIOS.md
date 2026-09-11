# Test scenario walkthrough — "Open app → see what needs attention → act → everything updates"

This is the scenario behind `src/testing/fixtures.ts`, the shared fixture
dataset unit tests and `e2e/scenario-journey.spec.ts` run against. It is not
loaded by the app itself — a real practice always starts empty (see
`src/application/emptyState.ts`) — but it's a useful walkthrough when you
want to see the product's behaviour end to end, e.g. for a live
demonstration: seed it by pasting the output of
`buildFixtureData(new Date().toISOString().slice(0, 10))` (from
`src/testing/fixtures.ts`) into `localStorage['practiceops.data']`
(wrapped as `{ version: SCHEMA_VERSION, savedAt, data }`) and reloading, or
just read along — every deadline below is relative to whatever date the
fixture is built with, so the story stays current.

The central client is **ABC Construction Ltd** (Dave Thompson, slow
responder, prefers WhatsApp). Annual Accounts due in 12 days, 4 of 6
documents received, two reminders ignored.

---

### Scene 1 — Practice Today
Open the app. Point at the five KPIs, then the *Needs attention* list.

> "Instead of opening five systems, you know immediately what needs attention.
> Nothing here is a mystery score — every item says why."

### Scene 2 — Needs Attention
Sidebar → **Needs Attention**. Find *ABC Construction Ltd*.

> "Due in 12 days. Two documents still missing: loan statement and director
> expenses. The client has ignored two reminders. Waiting on: client.
> Recommended action: send a WhatsApp reminder — because that's the channel
> Dave actually answers."

### Scene 3 — The client record
Click the client name.

> "Everything about this client in one place: UTR, company number, VAT, PAYE —
> masked until you deliberately reveal them, and every reveal is audited.
> Services, deadlines, open jobs, who owns it, who covers when they're away,
> and a handover box a colleague can read in ten seconds."

Reveal the UTR. Mention the audit log.

### Scene 4 — The accounts job
Click **2025 Annual Accounts** in *Open jobs*.

> "Bank statements, sales invoices, payroll, purchases — in. Loan statement and
> director expenses — still waiting. 67% complete. Chasing is active. Next in
> the sequence: email + WhatsApp at 14 days."

### Scene 5 — Send the reminder
Click **Send reminder**. WhatsApp is preselected.

> "The message is drafted from the job itself: it thanks Dave for what he sent
> and names exactly what's outstanding. No 'please send your documents'."

Click **Send WhatsApp**. Toast: *Reminder sent*. It appears at the top of the
job's communications, logged as simulated.

### Scene 6 — Smart Inbox
Sidebar → **Smart Inbox**. Top item: `ABC-Lloyds-Loan-Statement.pdf`.

> "The system suggests client, job and document type with a confidence and a
> reason. It never attaches anything on its own — I confirm."

Click **Confirm**. Toast: *Document attached… checklist and completion updated*.

### Scene 7 — Back to the job
Open the job (notification bell → *Document attached*, or Jobs → ABC).

> "83%. Loan statement received — the missing item is gone."

### Scene 8 — Complete the final item
Click **Mark received** on *Director expenses*.

> "100%. Watch the job: it has moved itself from *Waiting for records* to
> *Ready to start*, waiting on the accountant. Chasing stopped — no more
> reminders will go to Dave. Nobody had to remember to switch anything off."

### Scene 9 — Back to Practice Today
Sidebar → **Practice Today**.

> "ABC is no longer in the attention list. Waiting-on-client is down by one.
> Recent activity shows the whole chain. Chasing, Capacity, Briefing — all
> already updated. No refresh."

### Scene 10 — Ask the practice
Sidebar → **Ask the Practice** (or ⌘K and type a question).
Ask: **Which clients still need chasing this month?**

> "A useful answer from live practice data, through scoped tools — not the
> database poured into a chatbot. ABC isn't there any more."

Try also: *What is ABC Construction's UTR?* (masked, with a link to reveal) and
*Who is overloaded next week?*

---

### Optional extras (if there's time)

- **Ready-to-file workflow** — Jobs → *Khan Consulting Ltd VAT Return* →
  **Mark as filed**. A simulated submission reference is recorded, clearly
  labelled, and the next quarter's VAT job is created once.
- **Approval chasing** — *Brown Property Ltd* accounts have waited 11 days for
  client approval; chase it or record the approval and watch it become ready
  to file.
- **Readiness blocker** — *Greenfield Design Ltd*: confirmation statement due
  in 18 days, Olivia Greenfield not yet verified with Companies House.
- **Capacity** — switch to *Next 7 days*; Sarah and Priya are overloaded;
  reassign a job inline.
- **Search** — ⌘K and type a company number: the client is found without the
  number appearing in results.
- **Mobile** — resize the window; everything works as cards with a drawer.
