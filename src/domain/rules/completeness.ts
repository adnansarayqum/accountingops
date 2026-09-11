import type { InformationRequestItem, Job } from '../types';

export interface Completeness {
  total: number;
  received: number;
  missing: InformationRequestItem[];
  requested: InformationRequestItem[];
  percent: number;
  complete: boolean;
}

/**
 * Document completeness for a job. Only required items count towards the
 * percentage; optional items are reported but never block the job.
 */
export function computeCompleteness(items: InformationRequestItem[]): Completeness {
  const required = items.filter((i) => i.required);
  const received = required.filter((i) => i.status === 'received');
  const missing = required.filter((i) => i.status !== 'received');
  const requested = required.filter((i) => i.status === 'requested');
  const total = required.length;
  const percent = total === 0 ? 100 : Math.round((received.length / total) * 100);
  return { total, received: received.length, missing, requested, percent, complete: missing.length === 0 };
}

export function itemsForJob(items: InformationRequestItem[], jobId: string): InformationRequestItem[] {
  return items.filter((i) => i.jobId === jobId);
}

export function completenessForJob(job: Job, items: InformationRequestItem[]): Completeness {
  return computeCompleteness(itemsForJob(items, job.id));
}
