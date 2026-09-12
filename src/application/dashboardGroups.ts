import type { JobView } from './selectors';
import { SERVICES } from '../domain/catalog';
import type { ServiceCode } from '../domain/types';

export interface DueSoonGroup {
  serviceCode: ServiceCode;
  label: string;
  views: JobView[];
}

/**
 * Splits "due soon" jobs into one group per service (Accounts, VAT,
 * Confirmation Statement, ...) instead of a single combined list —
 * feedback from the practice: lumping every kind of deadline together
 * made it hard to see, at a glance, what specifically needed doing.
 *
 * Only services with at least one due-soon job get a group. Groups are
 * ordered by their nearest deadline; each group's jobs keep the order
 * they arrived in (callers pass jobs already sorted by due date).
 */
export function groupDueSoonByService(views: JobView[]): DueSoonGroup[] {
  const byService = new Map<ServiceCode, JobView[]>();
  for (const view of views) {
    const list = byService.get(view.job.serviceCode);
    if (list) list.push(view);
    else byService.set(view.job.serviceCode, [view]);
  }
  return [...byService.entries()]
    .map(([serviceCode, group]) => ({ serviceCode, label: SERVICES[serviceCode].shortName, views: group }))
    .sort((a, b) => a.views[0].daysUntilDue - b.views[0].daysUntilDue);
}

export interface ServiceStatus {
  serviceCode: ServiceCode;
  label: string;
  /** Open jobs already past their deadline. */
  overdue: number;
  /** Open jobs due within the practice's due-soon window — not counting the overdue ones. */
  dueSoon: number;
  /** overdue + dueSoon: what needs attention now, and what the tile leads with. */
  due: number;
  /** Every open (unfiled) job of this service. */
  open: number;
  /** Days to the nearest open deadline; negative when that one is already overdue. Null when nothing is open. */
  nextDueInDays: number | null;
}

/**
 * The statutory work a practice of this shape always wants in view, even
 * at zero — a tile reading "CT600 due 0 · nothing tracked yet" says
 * something worth knowing (nobody is tracking corporation tax) that a
 * missing tile does not. Anything else appears once there's open work.
 */
export const CORE_TILE_SERVICES: ServiceCode[] = ['annual_accounts', 'corporation_tax', 'vat', 'payroll', 'confirmation_statement', 'self_assessment'];

/**
 * One status line per service for the dashboard's tile row — "CS due",
 * "VAT due" and so on. Takes every job view, not a pre-filtered set, so
 * "open" here always means the same thing.
 *
 * A service appears when it has at least one open job, or when it's one of
 * `alwaysInclude` (which then reads as zero). Ordered by nearest deadline,
 * which puts anything overdue first and anything with no open work last.
 */
export function serviceStatuses(views: JobView[], dueSoonDays: number, alwaysInclude: ServiceCode[] = []): ServiceStatus[] {
  const byService = new Map<ServiceCode, JobView[]>();
  for (const code of alwaysInclude) byService.set(code, []);
  for (const view of views) {
    if (view.job.status === 'filed') continue;
    const list = byService.get(view.job.serviceCode);
    if (list) list.push(view);
    else byService.set(view.job.serviceCode, [view]);
  }
  return [...byService.entries()]
    .map(([serviceCode, open]) => {
      const overdue = open.filter((v) => v.daysUntilDue < 0).length;
      const dueSoon = open.filter((v) => v.daysUntilDue >= 0 && v.daysUntilDue <= dueSoonDays).length;
      return {
        serviceCode,
        label: SERVICES[serviceCode].shortName,
        overdue,
        dueSoon,
        due: overdue + dueSoon,
        open: open.length,
        nextDueInDays: open.reduce<number | null>((soonest, v) => (soonest === null || v.daysUntilDue < soonest ? v.daysUntilDue : soonest), null),
      };
    })
    .sort((a, b) => (a.nextDueInDays ?? Infinity) - (b.nextDueInDays ?? Infinity));
}

export interface WorkloadSlice {
  key: 'overdue' | 'waiting' | 'dueSoon' | 'other';
  label: string;
  value: number;
  colour: string;
}

/**
 * How the open pipeline splits for the workload donut. Every open job lands
 * in exactly one slice, worst first, so the four add up to the open total
 * and the chart can't double-count a job that is both overdue and blocked.
 */
export function workloadSlices(views: JobView[], dueSoonDays: number): WorkloadSlice[] {
  let overdue = 0;
  let waiting = 0;
  let dueSoon = 0;
  let other = 0;
  for (const view of views) {
    if (view.job.status === 'filed') continue;
    if (view.daysUntilDue < 0) overdue += 1;
    else if (view.job.waitingOn === 'client') waiting += 1;
    else if (view.daysUntilDue <= dueSoonDays) dueSoon += 1;
    else other += 1;
  }
  return [
    { key: 'overdue', label: 'Overdue', value: overdue, colour: '#ef4444' },
    { key: 'waiting', label: 'Waiting on client', value: waiting, colour: '#f59e0b' },
    { key: 'dueSoon', label: 'Due soon', value: dueSoon, colour: '#2563eb' },
    { key: 'other', label: 'Scheduled', value: other, colour: '#cbd5e1' },
  ];
}
