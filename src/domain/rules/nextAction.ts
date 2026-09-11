import type { Client, Communication, InformationRequestItem, Job, ReminderSequence } from '../types';
import { assessChasing } from './chasing';
import { computeCompleteness } from './completeness';
import { primaryActionLabel } from './transitions';
import { sequenceIdFor } from './attention';
import { CHANNEL_LABELS } from '../catalog';

export interface NextAction {
  label: string;
  kind: 'send_reminder' | 'transition' | 'assign' | 'none' | 'file';
  detail?: string;
}

/** Single source of truth for "what should happen next on this job". */
export function nextActionForJob(
  job: Job,
  client: Client,
  items: InformationRequestItem[],
  comms: Communication[],
  sequences: ReminderSequence[],
  today: string,
): NextAction {
  if (job.nextActionOverride) return { label: job.nextActionOverride, kind: 'none' };
  if (job.status === 'filed') return { label: 'Nothing — filed', kind: 'none' };
  const jobItems = items.filter((i) => i.jobId === job.id);
  const completeness = computeCompleteness(jobItems);
  const sequence = sequences.find((s) => s.id === sequenceIdFor(job.serviceCode));
  const chasing = assessChasing(job, jobItems, comms, sequence, today);
  const channel = CHANNEL_LABELS[client.preferredChannel] ?? 'email';

  if (chasing.required && chasing.kind === 'documents') {
    return {
      label: `Send ${channel} reminder`,
      kind: 'send_reminder',
      detail: `${completeness.missing.length} document${completeness.missing.length === 1 ? '' : 's'} still needed`,
    };
  }
  if (chasing.required && chasing.kind === 'approval') {
    return { label: `Chase approval by ${channel}`, kind: 'send_reminder', detail: 'Client approval outstanding' };
  }
  if (!job.assigneeUserId) return { label: 'Assign an accountant', kind: 'assign' };
  if (job.status === 'internal_review' && !job.reviewerUserId) return { label: 'Assign a reviewer', kind: 'assign' };
  if (job.status === 'ready_to_file') return { label: 'Mark as filed', kind: 'file' };
  const label = primaryActionLabel(job.status);
  if (label) return { label, kind: 'transition' };
  return { label: 'No action needed', kind: 'none' };
}
