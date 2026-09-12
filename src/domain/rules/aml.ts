import { addMonths, daysUntil } from '../dates';
import type { AmlRiskRating, Client, IsoDate } from '../types';

/**
 * Anti-money-laundering client review cycle.
 *
 * The Money Laundering Regulations expect *ongoing* monitoring, not a
 * one-off check at onboarding: a documented risk rating per client, a
 * periodic re-review, and an evidence trail a supervisor can be shown.
 * The onboarding checklist here already has an `identity_aml` stage; this
 * is the part that comes round again.
 *
 * The regulations set the principle (risk-based, periodic) but not a
 * number, so the intervals below are the practice's own policy defaults —
 * annual for high risk, two-yearly for standard, three-yearly for low —
 * stated in one place so they can be changed in one place. A client that
 * has never been rated is overdue by definition: no rating on file is the
 * thing a supervisory visit picks up first.
 */

export const AML_REVIEW_MONTHS: Record<AmlRiskRating, number> = { high: 12, standard: 24, low: 36 };

export const AML_RATING_LABELS: Record<AmlRiskRating, string> = { low: 'Low risk', standard: 'Standard risk', high: 'High risk' };

export type AmlReviewState = 'never_reviewed' | 'overdue' | 'due_soon' | 'current';

export interface AmlReviewStatus {
  clientId: string;
  rating: AmlRiskRating | null;
  lastReviewedOn: IsoDate | null;
  nextDueOn: IsoDate | null;
  /** Negative when overdue; null when never reviewed. */
  daysUntilDue: number | null;
  state: AmlReviewState;
}

/** How far ahead "due soon" looks. Sixty days is enough to book the review into a quiet week. */
export const AML_DUE_SOON_DAYS = 60;

export function amlNextDue(rating: AmlRiskRating, lastReviewedOn: IsoDate): IsoDate {
  return addMonths(lastReviewedOn, AML_REVIEW_MONTHS[rating]);
}

export function amlReviewStatus(client: Client, today: IsoDate, dueSoonDays = AML_DUE_SOON_DAYS): AmlReviewStatus {
  const rating = client.amlRiskRating ?? null;
  const lastReviewedOn = client.amlLastReviewedOn ?? null;
  if (!rating || !lastReviewedOn) {
    return { clientId: client.id, rating, lastReviewedOn, nextDueOn: null, daysUntilDue: null, state: 'never_reviewed' };
  }
  const nextDueOn = amlNextDue(rating, lastReviewedOn);
  const days = daysUntil(nextDueOn, today);
  return {
    clientId: client.id,
    rating,
    lastReviewedOn,
    nextDueOn,
    daysUntilDue: days,
    state: days < 0 ? 'overdue' : days <= dueSoonDays ? 'due_soon' : 'current',
  };
}

export interface AmlSummary {
  neverReviewed: AmlReviewStatus[];
  overdue: AmlReviewStatus[];
  dueSoon: AmlReviewStatus[];
  current: number;
  /** Ceased clients are out of scope: there is nothing ongoing to monitor. */
  total: number;
}

/** Every active client's position, worst first within each group. */
export function amlSummary(clients: Client[], today: IsoDate, dueSoonDays = AML_DUE_SOON_DAYS): AmlSummary {
  const inScope = clients.filter((c) => c.lifecycle !== 'ceased');
  const statuses = inScope.map((c) => amlReviewStatus(c, today, dueSoonDays));
  const byDue = (a: AmlReviewStatus, b: AmlReviewStatus) => (a.daysUntilDue ?? 0) - (b.daysUntilDue ?? 0);
  return {
    neverReviewed: statuses.filter((s) => s.state === 'never_reviewed'),
    overdue: statuses.filter((s) => s.state === 'overdue').sort(byDue),
    dueSoon: statuses.filter((s) => s.state === 'due_soon').sort(byDue),
    current: statuses.filter((s) => s.state === 'current').length,
    total: inScope.length,
  };
}
