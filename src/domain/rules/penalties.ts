import { addMonths, daysUntil } from '../dates';
import type { Job, ServiceCode } from '../types';

/**
 * Late-filing penalty exposure, in pounds.
 *
 * Accountants think in penalties. "4 jobs overdue" is abstract; "£1,950 of
 * penalty exposure, £750 of it crystallising in 9 days" is not. Every
 * figure here is a published statutory amount, cited inline, and every
 * input is something the app already holds: open jobs, their due dates,
 * and the client's own filing history for the escalations that depend on
 * a pattern (accounts late two years running, a CT600 late three times).
 *
 * Where a penalty depends on the tax owed (10% of unpaid corporation tax,
 * 5% of self assessment liability) the amount is not known here, so it is
 * reported as an unquantified escalation rather than a made-up number.
 * Where the regime has no automatic fixed penalty (confirmation statement)
 * or one this app cannot yet compute (PAYE, which depends on employee
 * count), the job is listed with the risk named and nothing invented.
 *
 * Sources, checked 12 Sep 2026:
 *  - Companies House late filing penalties (private companies):
 *    gov.uk/government/publications/late-filing-penalties
 *  - Company Tax Return penalties: gov.uk/company-tax-returns/penalties-for-late-filing
 *  - VAT late submission points: gov.uk/guidance/penalty-points-and-penalties-if-you-submit-your-vat-return-late
 *  - Self Assessment penalties: gov.uk/self-assessment-tax-returns/penalties
 */

export interface PenaltyBand {
  /** Days after the due date at which this band starts (0 = the day after the deadline). */
  fromDaysLate: number;
  amount: number;
  label: string;
}

export interface PenaltyExposure {
  jobId: string;
  clientId: string;
  serviceCode: ServiceCode;
  /** Negative while still ahead of the deadline. */
  daysLate: number;
  /** Pounds already incurred if the job were filed today. */
  incurred: number;
  /** The next fixed step up, if any: what it costs and when. */
  next: { amount: number; inDays: number; label: string } | null;
  /** Plain-English caveats: a percentage-of-tax step, a doubling, a regime with no fixed figure. */
  notes: string[];
  /** True when the regime carries a penalty this app cannot put a number on. */
  unquantified: boolean;
}

export interface PenaltySummary {
  /** Pounds incurred across every open job today. */
  incurred: number;
  /** Pounds that will be added within the horizon if nothing is filed. */
  atRiskWithinHorizon: number;
  horizonDays: number;
  jobsWithExposure: number;
  jobsUnquantified: number;
  items: PenaltyExposure[];
}

/** Companies House, private company. Doubled when the previous year's accounts were also late. */
const ACCOUNTS_BANDS: PenaltyBand[] = [
  { fromDaysLate: 1, amount: 150, label: 'up to 1 month late' },
  { fromDaysLate: 31, amount: 375, label: 'more than 1 month late' },
  { fromDaysLate: 92, amount: 750, label: 'more than 3 months late' },
  { fromDaysLate: 183, amount: 1500, label: 'more than 6 months late' },
];

/** Company Tax Return. The fixed steps; the 6- and 12-month steps are 10% of unpaid tax and are noted, not summed. */
const CT_BANDS: PenaltyBand[] = [
  { fromDaysLate: 1, amount: 200, label: '1 day late' },
  { fromDaysLate: 92, amount: 400, label: '3 months late' },
];
const CT_REPEAT_BANDS: PenaltyBand[] = [
  { fromDaysLate: 1, amount: 1000, label: '1 day late (third consecutive late return)' },
  { fromDaysLate: 92, amount: 2000, label: '3 months late (third consecutive late return)' },
];

/** Self Assessment: £100 at once; £10 a day from 3 months for up to 90 days; £300 minimums at 6 and 12 months (or 5% of tax, whichever is more). */
const SA_IMMEDIATE = 100;
const SA_DAILY = 10;
const SA_DAILY_CAP_DAYS = 90;
const SA_SIX_MONTH_MIN = 300;
const SA_TWELVE_MONTH_MIN = 300;

/** VAT late-submission points: one per late return, a £200 penalty at the threshold and for every late return after. */
const VAT_PENALTY = 200;
export const VAT_POINT_THRESHOLD: Record<'monthly' | 'quarterly' | 'annual', number> = { monthly: 5, quarterly: 4, annual: 2 };
const POINTS_LOOKBACK_MONTHS = 24;

function bandFor(bands: PenaltyBand[], daysLate: number): { current: PenaltyBand | null; next: PenaltyBand | null } {
  let current: PenaltyBand | null = null;
  let next: PenaltyBand | null = null;
  for (const band of bands) {
    if (daysLate >= band.fromDaysLate) current = band;
    else if (!next) next = band;
  }
  return { current, next };
}

/** Whole calendar months late, the way Companies House and HMRC count — not days divided by thirty. */
function monthsLate(dueDate: string, today: string): number {
  let months = 0;
  // Strictly past the anniversary: exactly one month late is still "up to
  // 1 month", since the next band is for *more than* a month.
  while (addMonths(dueDate, months + 1) < today) months += 1;
  return months;
}

/** Filed jobs of the same client and service, most recent period first. */
function filedHistory(jobs: Job[], job: Job): Job[] {
  return jobs.filter((j) => j.clientId === job.clientId && j.serviceCode === job.serviceCode && j.status === 'filed' && j.filedAt && j.id !== job.id).sort((a, b) => b.periodEnd.localeCompare(a.periodEnd));
}

function wasLate(j: Job): boolean {
  return Boolean(j.filedAt && j.filedAt.slice(0, 10) > j.dueDate);
}

function frequencyOf(job: Job, history: Job[]): 'monthly' | 'quarterly' | 'annual' {
  const key = job.periodKey;
  if (/^\d{4}-Q\d$/.test(key)) return 'quarterly';
  if (/^\d{4}-\d{2}$/.test(key)) return 'monthly';
  if (/^\d{4}$/.test(key)) return 'annual';
  return history.length > 4 ? 'monthly' : 'quarterly';
}

/**
 * Exposure for one open job. Filed jobs have no exposure — whatever they
 * cost is history. A job still ahead of its deadline has `incurred: 0` and
 * a `next` step on the day after it, which is how "£150 in 9 days" is
 * known before anything is late.
 */
export function penaltyExposureFor(job: Job, allJobs: Job[], today: string): PenaltyExposure | null {
  if (job.status === 'filed') return null;
  const daysLate = -daysUntil(job.dueDate, today);
  const history = filedHistory(allJobs, job);
  const base = { jobId: job.id, clientId: job.clientId, serviceCode: job.serviceCode, daysLate };

  switch (job.serviceCode) {
    case 'annual_accounts': {
      // Doubled when the immediately preceding accounts were also late.
      const previous = history[0];
      const doubled = Boolean(previous && wasLate(previous));
      const months = daysLate >= 1 ? monthsLate(job.dueDate, today) : -1;
      const bandsByMonth = [
        { months: 0, band: ACCOUNTS_BANDS[0] },
        { months: 1, band: ACCOUNTS_BANDS[1] },
        { months: 3, band: ACCOUNTS_BANDS[2] },
        { months: 6, band: ACCOUNTS_BANDS[3] },
      ];
      const factor = doubled ? 2 : 1;
      let current: PenaltyBand | null = null;
      let next: { band: PenaltyBand; months: number } | null = null;
      for (const entry of bandsByMonth) {
        if (daysLate >= 1 && months >= entry.months) current = entry.band;
        else if (!next) next = entry;
      }
      const nextInDays = next ? (daysLate < 1 ? -daysLate + 1 : Math.max(1, daysUntil(addMonths(job.dueDate, next.months), today) + 1)) : 0;
      return {
        ...base,
        incurred: (current?.amount ?? 0) * factor,
        next: next ? { amount: next.band.amount * factor, inDays: nextInDays, label: next.band.label } : null,
        notes: doubled ? ['Doubled: last year’s accounts were also filed late.'] : [],
        unquantified: false,
      };
    }
    case 'corporation_tax': {
      // Three in a row: the two most recent filed returns both late.
      const repeat = history.length >= 2 && wasLate(history[0]) && wasLate(history[1]);
      const bands = repeat ? CT_REPEAT_BANDS : CT_BANDS;
      const { current, next } = bandFor(bands, daysLate);
      const notes = ['At 6 months and again at 12 months, HMRC add 10% of the unpaid tax — not counted here.'];
      if (repeat) notes.unshift('Third consecutive late return: the fixed penalties are £1,000 each.');
      return {
        ...base,
        incurred: current?.amount ?? 0,
        next: next ? { amount: next.amount - (current?.amount ?? 0), inDays: next.fromDaysLate - daysLate, label: next.label } : null,
        notes,
        unquantified: daysLate >= 183,
      };
    }
    case 'self_assessment': {
      let incurred = 0;
      const notes: string[] = [];
      if (daysLate >= 1) incurred += SA_IMMEDIATE;
      if (daysLate > 92) incurred += Math.min(daysLate - 92, SA_DAILY_CAP_DAYS) * SA_DAILY;
      if (daysLate > 183) {
        incurred += SA_SIX_MONTH_MIN;
        notes.push('At 6 months: £300 or 5% of the tax due, whichever is more — the £300 minimum is counted.');
      }
      if (daysLate > 365) {
        incurred += SA_TWELVE_MONTH_MIN;
        notes.push('At 12 months: another £300 or 5% of the tax due, whichever is more — the £300 minimum is counted.');
      }
      let next: PenaltyExposure['next'] = null;
      if (daysLate < 1) next = { amount: SA_IMMEDIATE, inDays: -daysLate + 1, label: '1 day late' };
      else if (daysLate <= 92) next = { amount: SA_DAILY, inDays: 93 - daysLate, label: 'daily penalties begin (£10 a day, up to £900)' };
      else if (daysLate <= 183) next = { amount: SA_SIX_MONTH_MIN, inDays: 184 - daysLate, label: '6 months late' };
      else if (daysLate <= 365) next = { amount: SA_TWELVE_MONTH_MIN, inDays: 366 - daysLate, label: '12 months late' };
      return { ...base, incurred, next, notes, unquantified: daysLate > 183 };
    }
    case 'vat':
    case 'mtd_income_tax': {
      const frequency = frequencyOf(job, history);
      const threshold = VAT_POINT_THRESHOLD[frequency];
      const lookbackFrom = addMonths(today, -POINTS_LOOKBACK_MONTHS);
      const points = history.filter((j) => wasLate(j) && (j.filedAt ?? '').slice(0, 10) >= lookbackFrom).length;
      const wouldReach = points + 1 >= threshold;
      const incurred = daysLate >= 1 && wouldReach ? VAT_PENALTY : 0;
      const notes = [`${points} late-submission point${points === 1 ? '' : 's'} in the last 24 months; the threshold is ${threshold}.`];
      if (daysLate >= 1 && !wouldReach) notes.push('Late: one more point, no penalty yet.');
      return {
        ...base,
        incurred,
        next: daysLate < 1 ? { amount: wouldReach ? VAT_PENALTY : 0, inDays: -daysLate + 1, label: wouldReach ? 'reaches the points threshold' : 'adds a point' } : null,
        notes,
        unquantified: false,
      };
    }
    case 'confirmation_statement':
      return {
        ...base,
        incurred: 0,
        next: null,
        notes: ['No automatic fixed penalty, but Companies House can now impose one, and a company that does not file can be struck off.'],
        unquantified: daysLate >= 1,
      };
    case 'payroll':
      return {
        ...base,
        incurred: 0,
        next: null,
        notes: ['Late RTI penalties depend on employee count (£100–£400 a month) — not computed here.'],
        unquantified: daysLate >= 1,
      };
    default:
      return null;
  }
}

/**
 * The practice-wide picture. `horizonDays` is how far ahead "at risk"
 * looks — the dashboard uses the same due-soon window as everything else.
 */
export function summarisePenalties(jobs: Job[], today: string, horizonDays: number): PenaltySummary {
  const items = jobs
    .map((j) => penaltyExposureFor(j, jobs, today))
    .filter((x): x is PenaltyExposure => x !== null)
    .filter((x) => x.incurred > 0 || x.unquantified || (x.next !== null && x.next.amount > 0 && x.next.inDays <= horizonDays))
    .sort((a, b) => b.incurred - a.incurred || (a.next?.inDays ?? Infinity) - (b.next?.inDays ?? Infinity));
  return {
    incurred: items.reduce((sum, x) => sum + x.incurred, 0),
    atRiskWithinHorizon: items.reduce((sum, x) => sum + (x.next && x.next.inDays <= horizonDays ? x.next.amount : 0), 0),
    horizonDays,
    jobsWithExposure: items.filter((x) => x.incurred > 0 || (x.next !== null && x.next.amount > 0 && x.next.inDays <= horizonDays)).length,
    jobsUnquantified: items.filter((x) => x.unquantified).length,
    items,
  };
}

export function formatPounds(amount: number): string {
  return `£${amount.toLocaleString('en-GB')}`;
}
