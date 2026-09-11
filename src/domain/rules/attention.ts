import { daysSince, daysUntil } from '../dates';
import type { Approval, Client, Communication, InformationRequestItem, Job, PersonRole, ReminderSequence, User } from '../types';
import { assessChasing } from './chasing';
import { computeCompleteness } from './completeness';
import { CHANNEL_LABELS } from '../catalog';

export type Severity = 'red' | 'amber';

export interface AttentionItem {
  id: string;
  severity: Severity;
  jobId: string;
  clientId: string;
  /** Short headline, e.g. "Accounts overdue by 3 days." */
  headline: string;
  /** Plain-English explanation of why the rule fired. */
  reasons: string[];
  recommendedAction: RecommendedAction;
  ownerUserId?: string;
  dueDate: string;
  daysUntilDue: number;
  ruleCode: string;
  /** Higher sorts first. */
  score: number;
}

export type RecommendedActionKind = 'send_reminder' | 'assign_reviewer' | 'chase_approval' | 'verify_identity' | 'review_job' | 'file' | 'start_work' | 'reassign';

export interface RecommendedAction {
  kind: RecommendedActionKind;
  label: string;
  channel?: 'email' | 'whatsapp' | 'sms';
}

export interface AttentionContext {
  jobs: Job[];
  clients: Client[];
  items: InformationRequestItem[];
  comms: Communication[];
  approvals: Approval[];
  personRoles: PersonRole[];
  sequences: ReminderSequence[];
  users: User[];
  today: string;
}

const STALE_DAYS = 14;
const REVIEW_WAIT_DAYS = 7;
const APPROVAL_WAIT_DAYS = 10;

/**
 * Explainable attention rules. Each rule is deterministic and produces the
 * reasons that fired so the UI can show "why this needs attention".
 * A job appears at most once, with the highest-severity rule winning.
 */
export function evaluateAttention(ctx: AttentionContext): AttentionItem[] {
  const out: AttentionItem[] = [];
  const clientById = new Map(ctx.clients.map((c) => [c.id, c]));

  for (const job of ctx.jobs) {
    if (job.status === 'filed') continue;
    const client = clientById.get(job.clientId);
    if (!client) continue;
    const jobItems = ctx.items.filter((i) => i.jobId === job.id);
    const completeness = computeCompleteness(jobItems);
    const sequence = ctx.sequences.find((s) => s.id === sequenceIdFor(job.serviceCode));
    const chasing = assessChasing(job, jobItems, ctx.comms, sequence, ctx.today);
    const days = daysUntil(job.dueDate, ctx.today);
    const missingPct = completeness.total === 0 ? 0 : Math.round((completeness.missing.length / completeness.total) * 100);
    const stale = daysSince(job.statusChangedAt, ctx.today);
    const preferred = client.preferredChannel === 'email' || client.preferredChannel === 'whatsapp' || client.preferredChannel === 'sms' ? client.preferredChannel : 'email';
    const reminderAction = (): RecommendedAction => ({
      kind: 'send_reminder',
      label: `Send ${CHANNEL_LABELS[preferred]} reminder to client`,
      channel: preferred,
    });

    const candidates: Omit<AttentionItem, 'id' | 'jobId' | 'clientId' | 'ownerUserId' | 'dueDate' | 'daysUntilDue'>[] = [];

    // RED: overdue and client still hasn't supplied documents
    if (days < 0 && !completeness.complete && job.status === 'waiting_for_records') {
      candidates.push({
        severity: 'red',
        ruleCode: 'overdue_missing_docs',
        headline: `Overdue by ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'}.`,
        reasons: [
          `Deadline passed ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago.`,
          `Client has not supplied ${listLabels(completeness.missing)}.`,
          chasing.remindersSent > 0 ? `${chasing.remindersSent} reminder${chasing.remindersSent === 1 ? '' : 's'} sent without a response.` : 'No reminder has been sent yet.',
        ],
        recommendedAction: reminderAction(),
        score: 1000 + Math.abs(days) * 5,
      });
    }
    // RED: overdue for any other reason
    else if (days < 0) {
      candidates.push({
        severity: 'red',
        ruleCode: 'overdue',
        headline: `Overdue by ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'}.`,
        reasons: [`Deadline passed and the job is still ${statusPhrase(job)}.`],
        recommendedAction: actionForStatus(job, reminderAction),
        score: 900 + Math.abs(days) * 5,
      });
    }

    // RED: deadline within 7 days with a large share of information missing
    if (days >= 0 && days <= 7 && missingPct >= 30 && job.status === 'waiting_for_records') {
      candidates.push({
        severity: 'red',
        ruleCode: 'imminent_missing_docs',
        headline: `Due in ${days} day${days === 1 ? '' : 's'}.`,
        reasons: [
          `${missingPct}% of required information is still missing.`,
          `Still needed: ${listLabels(completeness.missing)}.`,
          chasing.remindersSent > 0 ? `Client has not responded to ${chasing.remindersSent} reminder${chasing.remindersSent === 1 ? '' : 's'}.` : 'No reminder has been sent yet.',
        ],
        recommendedAction: reminderAction(),
        score: 800 + (7 - days) * 10 + missingPct,
      });
    }

    // AMBER: due within 21 days with documents still missing and reminders ignored
    if (days > 7 && days <= 21 && !completeness.complete && job.status === 'waiting_for_records') {
      const ignored = chasing.remindersSent >= 2;
      candidates.push({
        severity: ignored ? 'red' : 'amber',
        ruleCode: 'approaching_missing_docs',
        headline: `Due in ${days} days.`,
        reasons: [
          `${completeness.missing.length} document${completeness.missing.length === 1 ? ' is' : 's are'} still missing: ${listLabels(completeness.missing)}.`,
          ignored ? `Client has ignored ${chasing.remindersSent} reminders.` : chasing.remindersSent === 1 ? 'One reminder sent so far.' : 'No reminder has been sent yet.',
        ],
        recommendedAction: reminderAction(),
        score: (ignored ? 700 : 400) + (21 - days) * 5,
      });
    }

    // AMBER: sitting in internal review with no reviewer
    if (job.status === 'internal_review' && stale >= REVIEW_WAIT_DAYS && !job.reviewerUserId) {
      candidates.push({
        severity: 'amber',
        ruleCode: 'review_no_reviewer',
        headline: `Ready for internal review for ${stale} days.`,
        reasons: ['No reviewer has been assigned.', `Due in ${days} days.`],
        recommendedAction: { kind: 'assign_reviewer', label: 'Assign a reviewer' },
        score: 450 + stale * 3,
      });
    }

    // AMBER: waiting for client approval for too long
    if (job.status === 'waiting_client_approval' && stale >= APPROVAL_WAIT_DAYS) {
      candidates.push({
        severity: days <= 7 ? 'red' : 'amber',
        ruleCode: 'approval_stalled',
        headline: `Completed. Waiting for client approval for ${stale} days.`,
        reasons: [`Approval requested ${stale} days ago and nothing has come back.`, `Filing deadline in ${days} days.`],
        recommendedAction: { kind: 'chase_approval', label: `Chase approval by ${CHANNEL_LABELS[preferred]}`, channel: preferred },
        score: 520 + stale * 3,
      });
    }

    // AMBER: confirmation statement approaching with unverified directors
    if (job.serviceCode === 'confirmation_statement' && days <= 45) {
      const unverified = ctx.personRoles.filter((r) => r.clientId === job.clientId && r.identityVerification !== 'verified');
      if (unverified.length > 0) {
        candidates.push({
          severity: days <= 14 ? 'red' : 'amber',
          ruleCode: 'identity_incomplete',
          headline: `Due in ${days} days — director identity verification incomplete.`,
          reasons: [`${unverified.length} director${unverified.length === 1 ? '' : 's'}/PSC${unverified.length === 1 ? '' : 's'} still need identity verification.`, 'Companies House will reject the filing without it.'],
          recommendedAction: { kind: 'verify_identity', label: 'Complete identity verification' },
          score: 470 + (45 - days) * 3,
        });
      }
    }

    // AMBER: nothing has happened for 14 days
    if (stale >= STALE_DAYS && ['in_progress', 'ready_to_start', 'internal_review'].includes(job.status) && candidates.length === 0) {
      candidates.push({
        severity: 'amber',
        ruleCode: 'stale',
        headline: `No change for ${stale} days.`,
        reasons: [`Status is "${statusPhrase(job)}" and nobody has moved it on.`, `Due in ${days} days.`],
        recommendedAction: job.assigneeUserId ? { kind: 'review_job', label: 'Review and move the job on' } : { kind: 'reassign', label: 'Assign an accountant' },
        score: 300 + stale,
      });
    }

    // AMBER: ready to file and deadline close — don't lose the win
    if (job.status === 'ready_to_file' && days <= 7 && days >= 0) {
      candidates.push({
        severity: 'amber',
        ruleCode: 'ready_deadline_close',
        headline: `Ready to file, due in ${days} day${days === 1 ? '' : 's'}.`,
        reasons: ['Everything is approved. File it before the deadline.'],
        recommendedAction: { kind: 'file', label: 'Mark as filed' },
        score: 420 + (7 - days) * 10,
      });
    }

    if (candidates.length === 0) continue;
    const best = candidates.sort((a, b) => sevRank(b.severity) - sevRank(a.severity) || b.score - a.score)[0];
    out.push({
      ...best,
      id: `att_${job.id}_${best.ruleCode}`,
      jobId: job.id,
      clientId: job.clientId,
      ownerUserId: job.assigneeUserId ?? client.ownerUserId,
      dueDate: job.dueDate,
      daysUntilDue: days,
    });
  }

  return out.sort((a, b) => sevRank(b.severity) - sevRank(a.severity) || b.score - a.score);
}

function sevRank(s: Severity): number {
  return s === 'red' ? 2 : 1;
}

function listLabels(items: InformationRequestItem[]): string {
  const labels = items.map((i) => i.label.toLowerCase());
  if (labels.length <= 1) return labels.join('');
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

function statusPhrase(job: Job): string {
  return job.status.replace(/_/g, ' ');
}

function actionForStatus(job: Job, reminder: () => RecommendedAction): RecommendedAction {
  switch (job.status) {
    case 'waiting_for_records':
    case 'waiting_client_approval':
      return reminder();
    case 'ready_to_file':
      return { kind: 'file', label: 'Mark as filed' };
    case 'ready_to_start':
      return { kind: 'start_work', label: 'Start work now' };
    default:
      return { kind: 'review_job', label: 'Review and move the job on' };
  }
}

export function sequenceIdFor(serviceCode: Job['serviceCode']): string {
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
