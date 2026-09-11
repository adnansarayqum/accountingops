import { daysUntil } from '../dates';
import type { Channel, Client, Communication, Contact, InformationRequestItem, Job, ReminderSequence, ReminderStep, User } from '../types';
import { computeCompleteness } from './completeness';

export interface ChasingAssessment {
  required: boolean;
  reason: string;
  /** What we are chasing for. */
  kind: 'documents' | 'approval' | 'none';
  outstanding: InformationRequestItem[];
  remindersSent: number;
  lastReminderAt?: string;
  nextStep?: ReminderStep;
  overdueStep: boolean;
}

/**
 * Chasing is required only when the client is genuinely holding things up:
 * missing required documents while waiting for records, or an outstanding
 * client approval. Once everything is received chasing stops automatically.
 */
export function assessChasing(
  job: Job,
  items: InformationRequestItem[],
  comms: Communication[],
  sequence: ReminderSequence | undefined,
  today: string,
): ChasingAssessment {
  const jobItems = items.filter((i) => i.jobId === job.id);
  const completeness = computeCompleteness(jobItems);
  const reminders = comms
    .filter((c) => c.jobId === job.id && c.direction === 'outbound' && c.reminderStage)
    .sort((a, b) => b.sentAt.localeCompare(a.sentAt));
  const base = { remindersSent: reminders.length, lastReminderAt: reminders[0]?.sentAt };

  if (job.status === 'filed') {
    return { ...base, required: false, reason: 'Job is filed.', kind: 'none', outstanding: [], overdueStep: false };
  }
  if (job.chasingPaused) {
    return { ...base, required: false, reason: 'Chasing paused by the practice.', kind: 'none', outstanding: completeness.missing, overdueStep: false };
  }
  if (job.status === 'waiting_client_approval' && job.waitingOn === 'client') {
    const step = nextReminderStep(job, sequence, reminders.length, today);
    return {
      ...base,
      required: true,
      reason: 'Client approval outstanding.',
      kind: 'approval',
      outstanding: [],
      nextStep: step?.step,
      overdueStep: step?.overdue ?? false,
    };
  }
  if (job.status === 'waiting_for_records' && job.waitingOn === 'client' && !completeness.complete) {
    const step = nextReminderStep(job, sequence, reminders.length, today);
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

/** The next step in the sequence based on how many reminders have already gone out. */
export function nextReminderStep(
  job: Job,
  sequence: ReminderSequence | undefined,
  remindersSent: number,
  today: string,
): { step: ReminderStep; overdue: boolean } | null {
  if (!sequence) return null;
  const step = sequence.steps[Math.min(remindersSent, sequence.steps.length - 1)];
  if (!step) return null;
  const daysLeft = daysUntil(job.dueDate, today);
  return { step, overdue: daysLeft <= step.daysBeforeDue };
}

export interface ReminderDraft {
  channel: Channel;
  recipient: string;
  subject?: string;
  body: string;
  documentsRequested: string[];
  stage: string;
}

function firstName(contact: Contact): string {
  return contact.name.split(' ')[0];
}

function listWords(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * Drafts a human, specific reminder that references what has been received
 * and what is still outstanding. Never says "please send your documents".
 */
export function draftReminder(opts: {
  client: Client;
  contact: Contact;
  job: Job;
  items: InformationRequestItem[];
  channel: Channel;
  step?: ReminderStep;
  sender: User;
  practiceName: string;
  today: string;
}): ReminderDraft {
  const { client, contact, job, items, channel, step, sender, practiceName, today } = opts;
  const jobItems = items.filter((i) => i.jobId === job.id && i.required);
  const received = jobItems.filter((i) => i.status === 'received').map((i) => i.label.toLowerCase());
  const missing = jobItems.filter((i) => i.status !== 'received').map((i) => i.label.toLowerCase());
  const daysLeft = daysUntil(job.dueDate, today);
  const tone = step?.tone ?? 'standard';
  const stage = step?.label ?? 'Ad hoc reminder';

  const thanks = received.length > 0 ? `Thanks for sending your ${listWords(received)}. ` : '';
  let ask: string;
  if (job.status === 'waiting_client_approval') {
    ask = `Your ${job.name.toLowerCase()} are ready for your approval. Could you review and confirm so we can file them?`;
  } else if (missing.length > 0) {
    ask = `We're still waiting for your ${listWords(missing)} before we can complete your ${job.name.toLowerCase()}.`;
  } else {
    ask = `Just checking in on your ${job.name.toLowerCase()}.`;
  }

  let urgency = '';
  if (daysLeft < 0) urgency = ` The filing deadline has now passed, so this is urgent.`;
  else if (tone === 'urgent' || daysLeft <= 7) urgency = ` The deadline is in ${daysLeft} day${daysLeft === 1 ? '' : 's'}, so we'd be grateful if you could send these as soon as possible.`;
  else if (tone === 'firm') urgency = ` The deadline is ${daysLeft} days away and we want to leave enough time to do a thorough job.`;
  else urgency = ` There's no rush yet, but sending these over when you get a moment keeps everything on track.`;

  const greeting = channel === 'email' ? `Hi ${firstName(contact)},\n\n` : `Hi ${firstName(contact)}, `;
  const signOff = channel === 'email' ? `\n\nBest wishes,\n${sender.name}\n${practiceName}` : ` — ${sender.name}, ${practiceName}`;
  const body = channel === 'sms'
    ? `${greeting}${ask}${urgency} Reply here or email us. — ${practiceName}`
    : `${greeting}${thanks}${ask}${urgency}${signOff}`;

  const recipient = channel === 'email'
    ? contact.email ?? ''
    : channel === 'whatsapp'
      ? contact.whatsapp ?? contact.phone ?? ''
      : contact.phone ?? '';

  return {
    channel,
    recipient,
    subject: channel === 'email' ? `${client.name} — ${job.name}: ${missing.length > 0 ? 'documents still needed' : 'quick update'}` : undefined,
    body,
    documentsRequested: jobItems.filter((i) => i.status !== 'received').map((i) => i.label),
    stage,
  };
}
