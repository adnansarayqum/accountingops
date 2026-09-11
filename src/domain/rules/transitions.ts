import type { Job, JobStatus, WaitingOn } from '../types';
import type { Completeness } from './completeness';

/** Allowed forward/backward moves. Filed is terminal. */
export const ALLOWED_TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  waiting_for_records: ['ready_to_start', 'in_progress'],
  ready_to_start: ['in_progress', 'waiting_for_records'],
  in_progress: ['internal_review', 'waiting_for_records', 'waiting_client_approval'],
  internal_review: ['waiting_client_approval', 'in_progress', 'ready_to_file'],
  waiting_client_approval: ['ready_to_file', 'internal_review'],
  ready_to_file: ['filed', 'waiting_client_approval'],
  filed: [],
};

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** Sensible default for who we're waiting on when a job enters a status. */
export const DEFAULT_WAITING_ON: Record<JobStatus, WaitingOn> = {
  waiting_for_records: 'client',
  ready_to_start: 'accountant',
  in_progress: 'accountant',
  internal_review: 'senior_review',
  waiting_client_approval: 'client',
  ready_to_file: 'nothing',
  filed: 'nothing',
};

export const OPEN_STATUSES: JobStatus[] = [
  'waiting_for_records',
  'ready_to_start',
  'in_progress',
  'internal_review',
  'waiting_client_approval',
  'ready_to_file',
];

export function isOpen(job: Job): boolean {
  return job.status !== 'filed';
}

/**
 * When the last required document arrives the job should stop waiting for
 * records. The rule suggests the transition; the store applies it.
 */
export function suggestedTransitionOnCompleteness(job: Job, completeness: Completeness): JobStatus | null {
  if (job.status === 'waiting_for_records' && completeness.complete) return 'ready_to_start';
  if (job.status === 'ready_to_start' && !completeness.complete) return 'waiting_for_records';
  return null;
}

/** Human labels for the primary forward action on a job. */
export function primaryActionLabel(status: JobStatus): string | null {
  switch (status) {
    case 'waiting_for_records':
      return null; // chasing is the action, not a transition
    case 'ready_to_start':
      return 'Start work';
    case 'in_progress':
      return 'Send for review';
    case 'internal_review':
      return 'Approve internally';
    case 'waiting_client_approval':
      return 'Record client approval';
    case 'ready_to_file':
      return 'Mark as filed';
    case 'filed':
      return null;
  }
}

export function primaryActionTarget(status: JobStatus): JobStatus | null {
  switch (status) {
    case 'ready_to_start':
      return 'in_progress';
    case 'in_progress':
      return 'internal_review';
    case 'internal_review':
      return 'waiting_client_approval';
    case 'waiting_client_approval':
      return 'ready_to_file';
    case 'ready_to_file':
      return 'filed';
    default:
      return null;
  }
}
