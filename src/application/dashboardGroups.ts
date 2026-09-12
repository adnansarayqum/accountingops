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
