import { addDays, addMonths, nowIso } from '../dates';
import { SERVICES } from '../catalog';
import type { Job, Obligation } from '../types';

/**
 * Deterministic period generation. Statutory rules (e.g. Companies House
 * 9 months after year end, VAT 1 month + 7 days) are represented by the
 * obligation's `dueOffsetDays`, so real rules can replace them later without
 * touching the job pipeline.
 */
export function nextPeriod(ob: Obligation): { periodStart: string; periodEnd: string; dueDate: string; periodKey: string } {
  const periodStart = addDays(ob.lastPeriodEnd, 1);
  const periodEnd = addDays(addMonths(periodStart, ob.periodLengthMonths), -1);
  const dueDate = addDays(periodEnd, ob.dueOffsetDays);
  return { periodStart, periodEnd, dueDate, periodKey: periodKeyFor(ob, periodEnd) };
}

export function periodKeyFor(ob: Obligation, periodEnd: string): string {
  const [y, m] = periodEnd.split('-').map(Number);
  if (ob.frequency === 'annual') return `${y}`;
  if (ob.frequency === 'quarterly') return `${y}-Q${Math.ceil(m / 3)}`;
  if (ob.frequency === 'monthly') return `${y}-${String(m).padStart(2, '0')}`;
  return `${y}-${m}`;
}

export function jobNameFor(ob: Obligation, periodKey: string): string {
  const service = SERVICES[ob.serviceCode];
  switch (ob.frequency) {
    case 'quarterly':
      return `${service.name} ${periodKey.replace('-', ' ')}`;
    case 'monthly':
      return `${service.name} ${monthLabel(periodKey)}`;
    default:
      return `${periodKey} ${service.name}`;
  }
}

function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[m - 1]} ${y}`;
}

/**
 * Generate the next job for an obligation. Returns null when a job for the
 * next period already exists (duplicate prevention is keyed on obligation +
 * period, so re-running is safe).
 */
export function generateNextJob(ob: Obligation, existingJobs: Job[], idFactory: () => string): { job: Job; obligation: Obligation } | null {
  const period = nextPeriod(ob);
  const duplicate = existingJobs.some((j) => j.obligationId === ob.id && j.periodKey === period.periodKey);
  if (duplicate) return null;
  const service = SERVICES[ob.serviceCode];
  const previous = existingJobs.filter((j) => j.obligationId === ob.id).sort((a, b) => b.periodEnd.localeCompare(a.periodEnd))[0];
  const job: Job = {
    id: idFactory(),
    practiceId: ob.practiceId,
    clientId: ob.clientId,
    obligationId: ob.id,
    serviceCode: ob.serviceCode,
    name: jobNameFor(ob, period.periodKey),
    periodKey: period.periodKey,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    dueDate: period.dueDate,
    status: 'waiting_for_records',
    waitingOn: 'client',
    assigneeUserId: previous?.assigneeUserId,
    reviewerUserId: undefined,
    estimatedHours: previous?.estimatedHours ?? service.defaultEstimatedHours,
    statusChangedAt: nowIso(),
    createdAt: nowIso(),
  };
  return { job, obligation: { ...ob, lastPeriodEnd: period.periodEnd } };
}
