/**
 * Automatic client reminders: which reminders are due right now and may go
 * without anyone pressing Send. Pure — a snapshot and a clock in, a plan
 * out — so every rule below is tested without a database or a provider.
 *
 * "Due" is exactly what the Chasing page calls due (chasingRules.mjs is a
 * tested copy of its rules). Automation then adds the limits a person would
 * apply, and anything it won't send itself it hands back as `needsYou`:
 *
 *  - Opt-in: nothing at all unless the practice switched it on in Settings.
 *  - Email only, and only a step that includes email. A WhatsApp or SMS step
 *    is a conversation the accountant starts (WhatsApp can't be sent from a
 *    server without Meta-approved templates), so it is left for a person.
 *  - Only to the client's main contact, at an address that looks real, and
 *    only for a client who prefers email and is active.
 *  - Weekdays, 08:00–18:00 in the practice's time zone.
 *  - Never faster than every 48 hours for one job, never more steps than the
 *    sequence holds (after the last, the next call is a person's), and never
 *    for a job more than 30 days past its deadline.
 *  - The wording is the same draft the composer would have produced.
 */
import { localParts } from './briefing.mjs';
import { assessChasing, daysUntil, draftReminder, sequenceIdFor } from './chasingRules.mjs';

export const RULES = Object.freeze({
  firstHour: 8,
  lastHour: 18,
  minGapHours: 48,
  staleDays: 30,
  /** More than this in one pass means something is wrong; the rest wait for the next. */
  maxPerRun: 20,
});

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HOUR_MS = 3_600_000;

/** Why a reminder is left for a person, in words for the person. */
export const NEEDS_YOU = Object.freeze({
  sequence_finished: 'Every reminder in the sequence has been sent — the next move is yours.',
  long_overdue: 'The deadline passed more than a month ago — worth a call rather than another email.',
  not_an_email_step: 'This step is a WhatsApp or text message, which you send yourself.',
  prefers_other_channel: 'This client prefers a different channel than email.',
  no_email: 'There is no email address for this client’s main contact.',
});

/**
 * pending: Map of jobId → { count, lastSentAt } for reminders the server
 * sent that the snapshot does not record yet (they still count as sent).
 */
export function planReminders({ snapshot, now, pending = new Map() }) {
  const practice = snapshot?.practice ?? {};
  const timezone = practice.timezone || 'Europe/London';
  const { date: today, hour, weekday } = localParts(now, timezone);
  const plan = {
    enabled: practice.automation?.autoReminders === true,
    timezone,
    today,
    workingHours: weekday !== 'Sat' && weekday !== 'Sun' && hour >= RULES.firstHour && hour < RULES.lastHour,
    due: [],
    needsYou: [],
    /** Due, but sent too recently to send another yet. */
    waiting: [],
  };
  if (!plan.enabled) return plan;

  const clients = new Map((snapshot?.clients ?? []).map((c) => [c.id, c]));
  const users = snapshot?.users ?? [];
  const contacts = snapshot?.contacts ?? [];
  const items = snapshot?.requestItems ?? [];
  const comms = snapshot?.communications ?? [];
  const sequences = snapshot?.reminderSequences ?? [];

  const jobs = [...(snapshot?.jobs ?? [])].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  for (const job of jobs) {
    const client = clients.get(job.clientId);
    if (!client || client.lifecycle !== 'active') continue;
    const sequence = sequences.find((s) => s.id === sequenceIdFor(job.serviceCode));
    const extra = pending.get(job.id);
    const assessment = assessChasing(job, items, comms, sequence, today, extra?.count ?? 0);
    if (!assessment.required || !assessment.overdueStep || !assessment.nextStep) continue;

    const step = assessment.nextStep;
    const entry = { jobId: job.id, clientId: client.id, clientName: client.name, jobName: job.name, dueDate: job.dueDate, stage: step.label, stepNo: assessment.remindersSent };
    const leave = (code) => plan.needsYou.push({ ...entry, code, reason: NEEDS_YOU[code] });

    if (assessment.remindersSent >= sequence.steps.length) {
      leave('sequence_finished');
      continue;
    }
    if (daysUntil(job.dueDate, today) < -RULES.staleDays) {
      leave('long_overdue');
      continue;
    }
    if (!step.channels.includes('email')) {
      leave('not_an_email_step');
      continue;
    }
    if (client.preferredChannel !== 'email') {
      leave('prefers_other_channel');
      continue;
    }
    const contact = contacts.find((c) => c.clientId === client.id && c.isPrimary) ?? contacts.find((c) => c.clientId === client.id);
    const to = contact?.email?.trim();
    if (!contact || !to || !EMAIL.test(to) || to.length > 254) {
      leave('no_email');
      continue;
    }

    const lastSent = [assessment.lastReminderAt, extra?.lastSentAt].filter(Boolean).sort().at(-1);
    if (lastSent && now.getTime() - new Date(lastSent).getTime() < RULES.minGapHours * HOUR_MS) {
      plan.waiting.push(entry);
      continue;
    }

    const sender = users.find((u) => u.id === job.assigneeUserId) ?? users.find((u) => u.id === client.ownerUserId) ?? users[0] ?? { name: practice.name ?? 'The team' };
    const draft = draftReminder({ client, contact, job, items, channel: 'email', step, sender, practiceName: practice.name ?? '', today });
    plan.due.push({ ...entry, contactName: contact.name, to, subject: draft.subject, body: draft.body, documentsRequested: draft.documentsRequested, sender: sender.name });
  }
  return plan;
}
