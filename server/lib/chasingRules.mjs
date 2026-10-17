/**
 * The chasing rules, for the server. A port of src/domain/rules/chasing.ts
 * (and completeness.ts, and daysUntil from domain/dates.ts) — the server runs
 * as plain Node and cannot import the TypeScript, and the automatic
 * reminders (automation.mjs) must decide exactly what the Chasing page would.
 *
 * Two copies of a rule can drift, so server/lib/__tests__/chasingRules.test.mjs
 * runs this and the TypeScript original over every job in the fixture practice,
 * for every channel, and fails when they disagree. Change one, change both.
 *
 * The one deliberate difference: assessChasing takes `extraSent`, the number
 * of automatic reminders the server has sent that the practice's snapshot does
 * not yet record (a tab applies them when it next opens). With it at 0 the
 * result is identical to the original.
 */

const DAY_MS = 86_400_000;

/** Whole days from `from` to `to`, both YYYY-MM-DD (positive when `to` is later). */
export function daysBetween(from, to) {
  const [ay, am, ad] = from.slice(0, 10).split('-').map(Number);
  const [by, bm, bd] = to.slice(0, 10).split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / DAY_MS);
}

export const daysUntil = (due, today) => daysBetween(today, due);

export function computeCompleteness(items) {
  const required = items.filter((i) => i.required);
  const received = required.filter((i) => i.status === 'received');
  const missing = required.filter((i) => i.status !== 'received');
  const requested = required.filter((i) => i.status === 'requested');
  const total = required.length;
  const percent = total === 0 ? 100 : Math.round((received.length / total) * 100);
  return { total, received: received.length, missing, requested, percent, complete: missing.length === 0 };
}

/** The next step in the sequence based on how many reminders have already gone out. */
export function nextReminderStep(job, sequence, remindersSent, today) {
  if (!sequence) return null;
  const step = sequence.steps[Math.min(remindersSent, sequence.steps.length - 1)];
  if (!step) return null;
  const daysLeft = daysUntil(job.dueDate, today);
  return { step, overdue: daysLeft <= step.daysBeforeDue };
}

export function assessChasing(job, items, comms, sequence, today, extraSent = 0) {
  const jobItems = items.filter((i) => i.jobId === job.id);
  const completeness = computeCompleteness(jobItems);
  const reminders = comms
    .filter((c) => c.jobId === job.id && c.direction === 'outbound' && c.reminderStage)
    .sort((a, b) => b.sentAt.localeCompare(a.sentAt));
  const sent = reminders.length + extraSent;
  const base = { remindersSent: sent, lastReminderAt: reminders[0]?.sentAt };

  if (job.status === 'filed') {
    return { ...base, required: false, reason: 'Job is filed.', kind: 'none', outstanding: [], overdueStep: false };
  }
  if (job.chasingPaused) {
    return { ...base, required: false, reason: 'Chasing paused by the practice.', kind: 'none', outstanding: completeness.missing, overdueStep: false };
  }
  if (job.status === 'waiting_client_approval' && job.waitingOn === 'client') {
    const step = nextReminderStep(job, sequence, sent, today);
    return { ...base, required: true, reason: 'Client approval outstanding.', kind: 'approval', outstanding: [], nextStep: step?.step, overdueStep: step?.overdue ?? false };
  }
  if (job.status === 'waiting_for_records' && job.waitingOn === 'client' && !completeness.complete) {
    const step = nextReminderStep(job, sequence, sent, today);
    return {
      ...base,
      required: true,
      reason: `${completeness.missing.length} document${completeness.missing.length === 1 ? '' : 's'} still needed.`,
      kind: 'documents',
      outstanding: completeness.missing,
      nextStep: step?.step,
      overdueStep: step?.overdue ?? false,
    };
  }
  if (completeness.complete && job.status === 'waiting_for_records') {
    return { ...base, required: false, reason: 'All documents received — no further chasing required.', kind: 'none', outstanding: [], overdueStep: false };
  }
  if (job.status === 'waiting_for_records' && !completeness.complete) {
    return { ...base, required: false, reason: `Outstanding items are with the practice, not the client (waiting on ${job.waitingOn.replace(/_/g, ' ')}).`, kind: 'none', outstanding: completeness.missing, overdueStep: false };
  }
  return { ...base, required: false, reason: 'Nothing outstanding from the client.', kind: 'none', outstanding: [], overdueStep: false };
}

const firstName = (contact) => contact.name.split(' ')[0];

function listWords(items) {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** A human, specific reminder that references what has been received and what is still outstanding. */
export function draftReminder({ client, contact, job, items, channel, step, sender, practiceName, today }) {
  const jobItems = items.filter((i) => i.jobId === job.id && i.required);
  const received = jobItems.filter((i) => i.status === 'received').map((i) => i.label.toLowerCase());
  const missing = jobItems.filter((i) => i.status !== 'received').map((i) => i.label.toLowerCase());
  const daysLeft = daysUntil(job.dueDate, today);
  const tone = step?.tone ?? 'standard';
  const stage = step?.label ?? 'Ad hoc reminder';

  const thanks = received.length > 0 ? `Thanks for sending your ${listWords(received)}. ` : '';
  let ask;
  if (job.status === 'waiting_client_approval') {
    ask = `Your ${job.name.toLowerCase()} are ready for your approval. Could you review and confirm so we can file them?`;
  } else if (missing.length > 0) {
    ask = `We're still waiting for your ${listWords(missing)} before we can complete your ${job.name.toLowerCase()}.`;
  } else {
    ask = `Just checking in on your ${job.name.toLowerCase()}.`;
  }

  let urgency = '';
  if (daysLeft < 0) urgency = ' The filing deadline has now passed, so this is urgent.';
  else if (tone === 'urgent' || daysLeft <= 7) urgency = ` The deadline is in ${daysLeft} day${daysLeft === 1 ? '' : 's'}, so we'd be grateful if you could send these as soon as possible.`;
  else if (tone === 'firm') urgency = ` The deadline is ${daysLeft} days away and we want to leave enough time to do a thorough job.`;
  else urgency = " There's no rush yet, but sending these over when you get a moment keeps everything on track.";

  const greeting = channel === 'email' ? `Hi ${firstName(contact)},\n\n` : `Hi ${firstName(contact)}, `;
  const signOff = channel === 'email' ? `\n\nBest wishes,\n${sender.name}\n${practiceName}` : ` — ${sender.name}, ${practiceName}`;
  const body = channel === 'sms' ? `${greeting}${ask}${urgency} Reply here or email us. — ${practiceName}` : `${greeting}${thanks}${ask}${urgency}${signOff}`;

  const recipient = channel === 'email' ? (contact.email ?? '') : channel === 'whatsapp' ? (contact.whatsapp ?? contact.phone ?? '') : (contact.phone ?? '');

  return {
    channel,
    recipient,
    subject: channel === 'email' ? `${client.name} — ${job.name}: ${missing.length > 0 ? 'documents still needed' : 'quick update'}` : undefined,
    body,
    documentsRequested: jobItems.filter((i) => i.status !== 'received').map((i) => i.label),
    stage,
  };
}

/** Which reminder sequence a service uses — src/domain/rules/attention.ts sequenceIdFor. */
export function sequenceIdFor(serviceCode) {
  switch (serviceCode) {
    case 'vat':
    case 'mtd_income_tax':
      return 'seq_vat';
    case 'payroll':
    case 'bookkeeping_review':
      return 'seq_payroll';
    case 'self_assessment':
      return 'seq_sa';
    case 'confirmation_statement':
      return 'seq_cs';
    default:
      return 'seq_accounts';
  }
}
