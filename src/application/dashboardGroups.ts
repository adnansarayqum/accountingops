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
 * One status line per service the practice has open work for — "CS due",
 * "VAT due" and so on — for the dashboard's tile row. Takes every job view,
 * not a pre-filtered set, so "open" here always means the same thing.
 *
 * Only services with at least one open job appear, ordered by their nearest
 * deadline, which puts anything overdue (a negative count of days) first.
 */
export function serviceStatuses(views: JobView[], dueSoonDays: number): ServiceStatus[] {
  const byService = new Map<ServiceCode, JobView[]>();
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
