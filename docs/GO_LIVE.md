# Go-live checklist and demo guide

Everything needed to take the app from "it passes its tests" to "a client can
watch Ray photograph a letter and see it filed". Do the sections in order; each
ends with something you can check with your own eyes. The reasoning behind each
setting lives in `.env.example`, `docs/INTEGRATIONS.md` and
`docs/PRODUCT_DECISIONS.md` — this page is the order to do things in.

## 0. What you need

| You need | For | Cost |
|---|---|---|
| A Railway project with the app and its Postgres plugin | Hosting, shared data, sign-in | Railway plan |
| An Anthropic API key | Reading photos/PDFs, filing them, reading bank statements | Pay per use |
| A Postmark account with a verified sender | Real reminder emails, and the briefing | Free tier to start |
| A Postmark **inbound** stream | "Forward an email to the app" | Included |
| A Companies House key (optional) | Live company lookup | Free |
| A phone with Chrome (Android) or Safari (iPhone) | The installed app | — |

Without the Anthropic key everything still works, but shared documents land in
Smart Inbox **unread** (no client guess, no extracted deadlines, no bank
transactions). Without Postmark, reminders are *simulated* — logged, nothing
sent — and **automatic reminders send nothing at all**.

## 1. Railway variables

Set these on the web service (Railway → service → Variables). The Postgres
plugin is referenced as `${{Postgres.DATABASE_URL}}`.

| Variable | Needed? | What it does |
|---|---|---|
| `DATABASE_URL` | **Yes** | Turns on shared mode: sign-in, shared data, everything below. Unset = a demo that lives in one browser. |
| `ADNAN_TEMP_PASSWORD`, `FARHAN_TEMP_PASSWORD`, `RAYHAN_TEMP_PASSWORD` | **Yes** (first deploy) | Temporary passwords, each changed at first sign-in. Remove after everyone has signed in. |
| `ANTHROPIC_API_KEY` | **Yes** for the headline feature | Reads and files shared documents. Never sent to the browser. |
| `INTAKE_MODEL` | No | Defaults to Opus, for accuracy on messy photos. |
| `TRANSACTIONS_MODEL`, `TRANSACTIONS_EFFORT` | No | Bank-statement transactions; default Sonnet, medium effort. |
| `MESSAGING_EMAIL_PROVIDER=postmark` | **Yes** for real emails | Without it reminders and the briefing are simulated. |
| `POSTMARK_SERVER_TOKEN` | With the line above | From the Postmark server's API Tokens tab. |
| `MESSAGING_FROM_EMAIL` | With the line above | A sender address you have **verified in Postmark**. |
| `MESSAGING_FROM_NAME` | No | Display name on reminders, e.g. `Farhan & Raihan`. |
| `POSTMARK_MESSAGE_STREAM` | No | Defaults to `outbound`. |
| `INBOUND_EMAIL_ADDRESS` | For email forwarding | The Postmark inbound address people forward to. Shown in Settings. |
| `INBOUND_EMAIL_USERNAME`, `INBOUND_EMAIL_PASSWORD` | For email forwarding | Long random values; Postmark sends them to the app as Basic auth. |
| `INBOUND_EMAIL_REQUIRE_SPF` | No | Leave unset (= 1). Only set `0` if forwarded mail is being wrongly refused. |
| `PUBLIC_APP_URL` | If you use a custom domain | The address clients' portal links should use. |
| `COMPANIES_HOUSE_API_KEY` | Optional | Live company lookup. |
| `BRIEFING_SEND_HOUR` | No | Hour for the weekday morning briefing (default 7). |
| `HMRC_*` | Not for go-live | HMRC is built sandbox-first and not part of this. |

Automatic reminders have no variable of their own — an owner or manager turns
them on in Settings (section 6).

**Check:** open `https://<your-app>/health` — it should say `ok` and that the
database is reachable. Then sign in as Ray (`rayhan`) with his temporary
password; the app makes him choose a new one.

## 2. Postmark, once

1. **Sending.** Create a server, then verify the sender address or domain you
   put in `MESSAGING_FROM_EMAIL`. Copy the server's API token into
   `POSTMARK_SERVER_TOKEN`. Until the sender is verified Postmark refuses to
   send, and the app will say so rather than pretend.
2. **Receiving (email forwarding).** In the same Postmark account create an
   **Inbound** stream. Note its address (`<hash>@inbound.postmarkapp.com`, or a
   friendlier subdomain with an MX record) and set it as `INBOUND_EMAIL_ADDRESS`.
   Set the stream's webhook to
   `https://<INBOUND_EMAIL_USERNAME>:<INBOUND_EMAIL_PASSWORD>@<your-host>/api/intake/email/inbound`.
3. In the app, Settings → **Email documents in**: Ray lists the email addresses he
   forwards *from*. Anything else sent to that address is ignored — the address
   is public enough that anyone could try it.

**Check:** Settings → Messaging shows Postmark as the email provider. Send a
reminder to yourself from a client's page (use your own address on a test
client's contact).

## 3. Put the app on the phones

**Android (Ray's phone, if Android).** Open the app in Chrome, ⋮ menu →
*Install app*. "F&R Ops" now appears in the **share sheet** of WhatsApp and the
mail app. Share a photo or PDF from WhatsApp → F&R Ops → check the client it
picked → Done.

**iPhone.** Safari → Share → *Add to Home Screen*. Apple does not let web apps
appear in the share sheet, so sharing *in* from WhatsApp/Mail uses a Shortcut:
Settings → **Send from an iPhone** → *Create an upload key* (shown once —
copy it), then follow the steps listed there to build the Shortcut
(about five minutes, once). Add *Convert Image → JPEG* before the upload if
sharing straight from Photos (iPhones save HEIC, which can't be read).

**Either phone, no sharing needed.** The camera button in the app header
(**Add a document**): *Take a photo* for each page, optionally paste the
client's message, *Send*. This works the same on Android, iPhone and a laptop,
and is the simplest thing to show a client.

**Check:** photograph any printed letter with a client's name on it. Within a
minute or so the page says "Filing under *Client name*" (or offers a best guess
to confirm), and the document appears on that client and in Smart Inbox.

## 4. Load the real clients

Documents can only be filed under clients the app knows. Import the client list
(Clients → Import) or add them one by one (companies can be looked up by number
if you set the Companies House key). The AI matches on names and identifiers
(UTR, VAT number, company number), so the more of those that are filled in, the
better the guesses.

## 5. What happens to a document

```
photo / WhatsApp share / iPhone Shortcut / forwarded email
        │
        ▼   read by Claude (one request per share)
   which client? what is it? what does it say?
        │
        ├─ sure (≥85%) ─────────► filed on the client, attached to the right job
        └─ not sure ────────────► Smart Inbox, "To review" with a best guess
        │
        ▼
 Suggested updates  (a new deadline, a penalty, a missing UTR, a tick on a checklist…)
        │            nothing changes until a person presses Apply
        ▼
 Bank statements → every transaction read, categorised, gap-checked, CSV for Xero/QuickBooks
```

Filing is automatic; **changes to a client's record are proposed, never silent.**

## 6. Reminders to clients

Manual: Chasing → *Send reminder* writes a specific email ("still waiting for
your bank statements and loan statement") and sends it through Postmark.

Automatic (off until you choose): Settings → **Automatic reminders**.

1. Click **Preview what would be sent now** — it lists the exact emails and the
   jobs left for a person. Read a few.
2. Click **Turn on**. From then on, every ten minutes on weekdays 08:00–18:00
   (practice timezone) the server sends each client the next step of their
   sequence when it falls due — email steps only, to the main contact, at least
   48 hours apart, once per step.
3. Phone, WhatsApp and text steps are never sent for you; they stay on the
   Chasing page. Each automatic send shows on the client's timeline as
   *Automatic*, in the activity feed, and (as a toast) when you next open the app.

Requires Postmark (section 2). If something is sent but the connection drops
mid-send, the app tells you in Settings and does **not** retry — check
Postmark's activity log.

"The app also prompts me": the Dashboard and Attention page list what is
overdue or due soon; the morning briefing email (Settings → Account) sends the
same each weekday to Ray's address.

## 7. Demo script for a client (≈10 minutes)

1. **Install.** On the client's phone, open the app link → Add to Home Screen
   (iPhone) or Install app (Android). Mention it works like any app icon.
2. **Take a picture of a letter.** Tap the camera button → photograph a letter
   (use a made-up one on a test client; see below) → Send. Point out: *"it's
   already worked out whose it is."*
3. **See where it went.** Open the client: the document is on their record,
   with what it says. Open Smart Inbox → Suggested updates: *"it spotted a
   deadline and proposes the change; nothing happens until I tap Apply."*
4. **Share from WhatsApp** (Android) or the Shortcut (iPhone): send a bank
   statement photo → open the client's *Bank transactions* card → transactions,
   categories, "missing month" warning, *Export CSV*.
5. **Reminders.** Chasing → show a job waiting on a client → the drafted email
   → Send. Then Settings → Automatic reminders → Preview: *"this is what goes
   out on its own, Monday to Friday, only emails, only when due."*
6. **The morning view.** Briefing/Dashboard: overdue, due this week, who's gone
   quiet.

**Use a test client for the demo.** Create a client such as "Demo Bakery Ltd"
with a made-up UTR and your own email as the contact. Anything photographed
goes to Anthropic for reading, so don't demo with another client's real papers.
If automatic reminders are on during the demo, make sure no *real* client is
due that day or switch them off until afterwards.

## 8. Before you rely on it — what is verified and what is not

Verified by automated tests (about 1,300 unit tests plus browser tests): the
filing and matching rules, the permissions, the reminder rules and their
once-only guarantee, the bank-statement checks and CSV, the upload-key and
email-forwarding security checks, and that the screens work on a phone-sized
browser.

**Not yet exercised against the real thing — do each once, with your own data,
before trusting it:**

- **A real photo through the real AI.** The tests use a stand-in for the model.
  Section 3's "check" is the first real run; try a clear letter, a crumpled one,
  and a bank statement. Expect it to be unsure sometimes — that is what the
  Smart Inbox "To review" list is for.
- **The iPhone Shortcut.** Built from Apple's documented actions but never run
  on a real iPhone. If a step differs in your iOS version, the upload key and
  the *Add a document* button still work.
- **Real Postmark delivery and inbound.** The code speaks Postmark's formats and
  is tested against them; sender verification, SPF on forwarded mail, and
  spam-folder behaviour only show up with real mail.
- **Loading the CSV into Xero or QuickBooks.** The columns follow their import
  formats; import one statement into a test file first.
- **Automatic reminders over several days.** Run the preview for a week before
  switching on, and leave it on for a small group first.
- **Android sharing from WhatsApp.** Relies on Chrome's share-target feature;
  works once the app is *installed* (not just bookmarked).

## 9. If something looks wrong

| You see | Likely cause |
|---|---|
| Shared document lands in Smart Inbox with no summary | `ANTHROPIC_API_KEY` not set, or the call failed — check the service logs. |
| "F&R Ops" missing from the Android share sheet | Opened in a tab but not installed; install it from Chrome's menu. |
| Reminder says *simulated* | `MESSAGING_EMAIL_PROVIDER` isn't `postmark`, or the token is missing. |
| Postmark refuses to send | `MESSAGING_FROM_EMAIL` isn't a verified sender. |
| Forwarded email never appears | Sender not listed in Settings → Email documents in; or the webhook URL/credentials differ from the two `INBOUND_EMAIL_*` values; or SPF failed. |
| Automatic reminders "nothing can be sent yet" | Section 2 incomplete. |
| Automatic reminder sent but not on the timeline | It's recorded the next time the app is open in a tab; open it. |
| Can't sign in after a restart | Use `<NAME>_RESET_PASSWORD` once (see `.env.example`), then remove it. |

Rollback and backups: `docs/OPERATIONS.md`.
