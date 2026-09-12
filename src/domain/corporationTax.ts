import { addDays, addMonths, daysBetween, daysUntil, nowIso } from './dates';
import { SERVICES } from './catalog';
import { jobNameFor, periodKeyFor } from './rules';
import type { Client, InformationRequestItem, IsoDate, Job, Obligation, PracticeData, ServiceSubscription } from './types';

/**
 * Corporation tax deadlines, and filling in the CT600 work a client roster
 * import never created.
 *
 * Two separate statutory dates hang off one accounting period end
 * (gov.uk/company-tax-returns):
 *
 *  - the Company Tax Return (CT600) is due **12 months** after the end of
 *    the accounting period;
 *  - the corporation tax **payment** is due **9 months and 1 day** after
 *    that same period end — three months *before* the return.
 *
 * The job this app tracks is preparing and filing the return, so its due
 * date is the filing deadline. The payment date is derived wherever a
 * corporation tax job is shown, so nobody reads "due in 12 months" and
 * misses the fact that money has to move in nine.
 */

export const CT_FILING_MONTHS = 12;
export const CT_PAYMENT_MONTHS = 9;

/** CT600 filing deadline: 12 months after the end of the accounting period. */
export function corporationTaxFilingDue(periodEnd: IsoDate): IsoDate {
  return addMonths(periodEnd, CT_FILING_MONTHS);
}

/**
 * Corporation tax payment deadline: 9 months and 1 day after the end of the
 * accounting period. This is the deadline for companies with taxable profits
 * up to £1.5m; larger companies pay in quarterly instalments, which this app
 * does not model.
 */
export function corporationTaxPaymentDue(periodEnd: IsoDate): IsoDate {
  return addDays(addMonths(periodEnd, CT_PAYMENT_MONTHS), 1);
}

/** One limited company that has an accounting period on file but no corporation tax work for it. */
export interface MissingCorporationTax {
  clientId: string;
  clientName: string;
  /** Accounting period end, taken from the client's annual accounts obligation. */
  periodEnd: IsoDate;
  /** CT600 filing deadline. */
  dueDate: IsoDate;
  /** Corporation tax payment deadline — earlier than the filing deadline. */
  paymentDue: IsoDate;
  /** True when that filing deadline has already passed, so generating it creates overdue work. */
  alreadyOverdue: boolean;
}

type MissingSource = Pick<PracticeData, 'clients' | 'obligations'>;

/**
 * Limited companies with an annual accounts obligation (so an accounting
 * period end is known) but no corporation tax obligation. A spreadsheet
 * roster import only ever creates accounts and confirmation statement work,
 * so for an imported practice this is every limited company on file.
 *
 * Deliberately conservative: only limited companies, only where the period
 * end comes from a real accounts obligation rather than being guessed, and
 * never for a client that already has corporation tax on file — re-running
 * it does nothing.
 */
export function findMissingCorporationTax(data: MissingSource, today: IsoDate): MissingCorporationTax[] {
  const hasCt = new Set(data.obligations.filter((o) => o.serviceCode === 'corporation_tax').map((o) => o.clientId));
  const accountsByClient = new Map<string, Obligation>();
  for (const ob of data.obligations) {
    if (ob.serviceCode !== 'annual_accounts') continue;
    // A client shouldn't have two, but if it does the latest period end wins.
    const existing = accountsByClient.get(ob.clientId);
    if (!existing || ob.lastPeriodEnd > existing.lastPeriodEnd) accountsByClient.set(ob.clientId, ob);
  }

  const out: MissingCorporationTax[] = [];
  for (const client of data.clients) {
    if (!qualifies(client) || hasCt.has(client.id)) continue;
    const accounts = accountsByClient.get(client.id);
    if (!accounts) continue;
    const periodEnd = accounts.lastPeriodEnd;
    const dueDate = corporationTaxFilingDue(periodEnd);
    out.push({
      clientId: client.id,
      clientName: client.name,
      periodEnd,
      dueDate,
      paymentDue: corporationTaxPaymentDue(periodEnd),
      alreadyOverdue: daysUntil(dueDate, today) < 0,
    });
  }
  return out.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.clientName.localeCompare(b.clientName));
}

/** Corporation tax is a limited company obligation. A ceased client has no further returns to file. */
function qualifies(client: Client): boolean {
  return client.type === 'limited_company' && client.lifecycle !== 'ceased';
}

export interface CorporationTaxBackfillSummary {
  clientsUpdated: number;
  jobsCreated: number;
  /** Of those, how many land already past their filing deadline. */
  overdueCreated: number;
}

/**
 * Creates the corporation tax subscription, obligation and first job for
 * every row given, mutating the snapshot in place the way every other
 * store mutation does. Rows come from `findMissingCorporationTax`, so this
 * never duplicates work that already exists.
 */
export function applyCorporationTaxBackfill(
  data: Pick<PracticeData, 'practice' | 'subscriptions' | 'obligations' | 'jobs' | 'requestItems'>,
  rows: MissingCorporationTax[],
  idFactory: (prefix: string) => string,
): CorporationTaxBackfillSummary {
  const today = nowIso().slice(0, 10);
  for (const row of rows) {
    buildCorporationTaxRecords(
      { practiceId: data.practice.id, clientId: row.clientId, periodEnd: row.periodEnd, today },
      { subscriptions: data.subscriptions, obligations: data.obligations, jobs: data.jobs, requestItems: data.requestItems },
      idFactory,
    );
  }
  return {
    clientsUpdated: rows.length,
    jobsCreated: rows.length,
    overdueCreated: rows.filter((r) => r.alreadyOverdue).length,
  };
}

/**
 * The shared builder: one corporation tax subscription, obligation, job and
 * document checklist for an accounting period. Used both by the roster
 * import (for new clients) and by the backfill (for clients imported before
 * corporation tax was generated), so the two can never drift apart.
 */
export function buildCorporationTaxRecords(
  spec: { practiceId: string; clientId: string; periodEnd: IsoDate; today: IsoDate },
  into: { subscriptions: ServiceSubscription[]; obligations: Obligation[]; jobs: Job[]; requestItems: InformationRequestItem[] },
  idFactory: (prefix: string) => string,
): { obligation: Obligation; job: Job } {
  const { practiceId, clientId, periodEnd, today } = spec;
  const service = SERVICES.corporation_tax;
  const dueDate = corporationTaxFilingDue(periodEnd);

  into.subscriptions.push({ id: idFactory('sub'), practiceId, clientId, serviceCode: 'corporation_tax', startedOn: today, active: true });

  const obligation: Obligation = {
    id: idFactory('ob'),
    practiceId,
    clientId,
    serviceCode: 'corporation_tax',
    name: service.name,
    frequency: service.frequency,
    lastPeriodEnd: periodEnd,
    dueOffsetDays: daysBetween(periodEnd, dueDate),
    periodLengthMonths: 12,
  };
  into.obligations.push(obligation);

  const periodKey = periodKeyFor(obligation, periodEnd);
  const job: Job = {
    id: idFactory('job'),
    practiceId,
    clientId,
    obligationId: obligation.id,
    serviceCode: 'corporation_tax',
    name: jobNameFor(obligation, periodKey),
    periodKey,
    periodStart: addDays(addMonths(periodEnd, -12), 1),
    periodEnd,
    dueDate,
    status: 'waiting_for_records',
    waitingOn: 'client',
    estimatedHours: service.defaultEstimatedHours,
    statusChangedAt: nowIso(),
    createdAt: nowIso(),
  };
  into.jobs.push(job);

  for (const label of service.defaultRequirements) {
    into.requestItems.push({ id: idFactory('req'), practiceId, jobId: job.id, clientId, label, documentType: label, status: 'missing', required: true });
  }
  return { obligation, job };
}
