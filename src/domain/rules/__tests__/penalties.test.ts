import { describe, expect, it } from 'vitest';
import { formatPounds, penaltyExposureFor, summarisePenalties, VAT_POINT_THRESHOLD } from '../penalties';
import type { Job, ServiceCode } from '../../types';

const today = '2026-09-12';

let n = 0;
const job = (serviceCode: ServiceCode, dueDate: string, over: Partial<Job> = {}): Job => ({
  id: `job_${++n}`,
  practiceId: 'prac',
  clientId: 'cl_a',
  serviceCode,
  name: `${serviceCode} job`,
  periodKey: serviceCode === 'vat' ? '2026-Q1' : '2025',
  periodStart: '2025-04-01',
  periodEnd: '2026-03-31',
  dueDate,
  status: 'waiting_for_records',
  waitingOn: 'client',
  estimatedHours: 4,
  statusChangedAt: '2026-09-01T00:00:00Z',
  createdAt: '2026-09-01T00:00:00Z',
  ...over,
});

/** A filed job from a previous period, late or on time. */
const filed = (serviceCode: ServiceCode, dueDate: string, filedOn: string, periodEnd: string, over: Partial<Job> = {}): Job =>
  job(serviceCode, dueDate, { status: 'filed', filedAt: `${filedOn}T12:00:00Z`, periodEnd, periodKey: periodEnd.slice(0, 4), ...over });

describe('Companies House accounts', () => {
  it('has nothing incurred ahead of the deadline, and names the first £150 on the day after it', () => {
    const j = job('annual_accounts', '2026-09-21');
    expect(penaltyExposureFor(j, [j], today)).toMatchObject({ daysLate: -9, incurred: 0, next: { amount: 150, inDays: 10, label: 'up to 1 month late' } });
  });

  it('steps through £150, £375, £750 and £1,500 by calendar month, not by thirty-day blocks', () => {
    const at = (dueDate: string) => penaltyExposureFor(job('annual_accounts', dueDate), [], today)!;
    expect(at('2026-09-11').incurred).toBe(150); // 1 day late
    expect(at('2026-08-12').incurred).toBe(150); // exactly one month: still "up to 1 month"
    expect(at('2026-08-11').incurred).toBe(375); // a day past one month
    expect(at('2026-06-11').incurred).toBe(750); // a day past three months
    expect(at('2026-03-11').incurred).toBe(1500); // a day past six months
  });

  it('says when the next step lands', () => {
    const exposure = penaltyExposureFor(job('annual_accounts', '2026-09-01'), [], today)!;
    expect(exposure.incurred).toBe(150);
    // One month after 1 Sep is 1 Oct; the £375 band starts the day after.
    expect(exposure.next).toEqual({ amount: 375, inDays: 20, label: 'more than 1 month late' });
  });

  it('doubles every band when last year’s accounts were also late', () => {
    const lastYear = filed('annual_accounts', '2025-12-31', '2026-01-20', '2025-03-31');
    const thisYear = job('annual_accounts', '2026-09-01', { periodEnd: '2026-03-31' });
    const exposure = penaltyExposureFor(thisYear, [lastYear, thisYear], today)!;
    expect(exposure.incurred).toBe(300);
    expect(exposure.next?.amount).toBe(750);
    expect(exposure.notes[0]).toMatch(/Doubled/);
  });

  it('does not double when last year was on time, or for another client’s lateness', () => {
    const onTime = filed('annual_accounts', '2025-12-31', '2025-12-20', '2025-03-31');
    const otherClient = filed('annual_accounts', '2025-12-31', '2026-02-01', '2025-03-31', { clientId: 'cl_b' });
    const thisYear = job('annual_accounts', '2026-09-01');
    expect(penaltyExposureFor(thisYear, [onTime, otherClient, thisYear], today)!.incurred).toBe(150);
  });
});

describe('Company Tax Return', () => {
  it('is £200 from the first day and £400 from three months, with the percentage steps noted rather than guessed', () => {
    const late1 = penaltyExposureFor(job('corporation_tax', '2026-09-11'), [], today)!;
    expect(late1.incurred).toBe(200);
    expect(late1.next).toEqual({ amount: 200, inDays: 91, label: '3 months late' });
    expect(late1.notes.join(' ')).toMatch(/10% of the unpaid tax/);
    expect(late1.unquantified).toBe(false);

    const late100 = penaltyExposureFor(job('corporation_tax', '2026-06-04'), [], today)!;
    expect(late100.incurred).toBe(400);
    expect(late100.next).toBeNull();
  });

  it('marks the six-month point as unquantified, because 10% of an unknown tax bill is not a number', () => {
    expect(penaltyExposureFor(job('corporation_tax', '2026-03-01'), [], today)!.unquantified).toBe(true);
  });

  it('charges £1,000 a step when the last two returns were late too', () => {
    const h1 = filed('corporation_tax', '2025-03-31', '2025-04-15', '2024-03-31');
    const h2 = filed('corporation_tax', '2024-03-31', '2024-05-01', '2023-03-31');
    const current = job('corporation_tax', '2026-09-11');
    const exposure = penaltyExposureFor(current, [h1, h2, current], today)!;
    expect(exposure.incurred).toBe(1000);
    expect(exposure.next?.amount).toBe(1000);
    expect(exposure.notes[0]).toMatch(/Third consecutive/);
  });

  it('needs both previous returns late — one on time breaks the run', () => {
    const h1 = filed('corporation_tax', '2025-03-31', '2025-04-15', '2024-03-31');
    const h2 = filed('corporation_tax', '2024-03-31', '2024-03-01', '2023-03-31');
    const current = job('corporation_tax', '2026-09-11');
    expect(penaltyExposureFor(current, [h1, h2, current], today)!.incurred).toBe(200);
  });
});

describe('Self Assessment', () => {
  const at = (dueDate: string) => penaltyExposureFor(job('self_assessment', dueDate), [], today)!;

  it('is £100 at once, then £10 a day from three months capped at £900', () => {
    expect(at('2026-09-11').incurred).toBe(100);
    expect(at('2026-06-11').incurred).toBe(100 + 10); // 93 days: one daily penalty
    expect(at('2026-03-13').incurred).toBe(100 + 900); // 183 days: daily cap reached, six-month step not yet
  });

  it('adds the £300 minimums at six and twelve months and flags the percentage alternative', () => {
    const six = at('2026-03-12'); // 184 days
    expect(six.incurred).toBe(100 + 900 + 300);
    expect(six.unquantified).toBe(true);
    expect(six.notes[0]).toMatch(/5% of the tax due/);
    const twelve = at('2025-09-10'); // 367 days
    expect(twelve.incurred).toBe(100 + 900 + 300 + 300);
  });

  it('names the next step at each stage', () => {
    expect(at('2026-09-20').next).toEqual({ amount: 100, inDays: 9, label: '1 day late' });
    expect(at('2026-09-01').next?.label).toMatch(/daily penalties begin/);
    expect(at('2026-03-13').next?.label).toBe('6 months late');
  });
});

describe('VAT late-submission points', () => {
  it('counts late returns in the last 24 months as points and charges £200 only at the threshold', () => {
    const late = (due: string, on: string, periodEnd: string) => filed('vat', due, on, periodEnd, { periodKey: `${periodEnd.slice(0, 4)}-Q1` });
    const history = [late('2026-05-07', '2026-05-20', '2026-03-31'), late('2026-02-07', '2026-02-20', '2025-12-31'), late('2025-11-07', '2025-11-20', '2025-09-30')];
    const current = job('vat', '2026-09-07');
    const exposure = penaltyExposureFor(current, [...history, current], today)!;
    expect(exposure.notes[0]).toBe('3 late-submission points in the last 24 months; the threshold is 4.');
    // This one is late and is the fourth point: £200.
    expect(exposure.incurred).toBe(200);
  });

  it('adds a point without a penalty when below the threshold', () => {
    const current = job('vat', '2026-09-07');
    const exposure = penaltyExposureFor(current, [current], today)!;
    expect(exposure.incurred).toBe(0);
    expect(exposure.notes).toContain('Late: one more point, no penalty yet.');
  });

  it('ignores late returns older than 24 months — points expire', () => {
    const old = filed('vat', '2024-05-07', '2024-06-20', '2024-03-31', { periodKey: '2024-Q1' });
    const current = job('vat', '2026-09-07');
    expect(penaltyExposureFor(current, [old, current], today)!.notes[0]).toMatch(/^0 late-submission points/);
  });

  it('uses the threshold for the filing frequency', () => {
    expect(VAT_POINT_THRESHOLD).toEqual({ monthly: 5, quarterly: 4, annual: 2 });
    const monthly = job('vat', '2026-09-07', { periodKey: '2026-07' });
    expect(penaltyExposureFor(monthly, [monthly], today)!.notes[0]).toMatch(/threshold is 5/);
  });
});

describe('regimes with no fixed figure', () => {
  it('lists an overdue confirmation statement as unquantified rather than inventing a number', () => {
    const exposure = penaltyExposureFor(job('confirmation_statement', '2026-09-01'), [], today)!;
    expect(exposure.incurred).toBe(0);
    expect(exposure.unquantified).toBe(true);
    expect(exposure.notes[0]).toMatch(/struck off/);
  });

  it('does the same for payroll, naming why', () => {
    const exposure = penaltyExposureFor(job('payroll', '2026-09-01'), [], today)!;
    expect(exposure.unquantified).toBe(true);
    expect(exposure.notes[0]).toMatch(/employee count/);
  });

  it('has no exposure at all while still ahead of the deadline', () => {
    expect(penaltyExposureFor(job('confirmation_statement', '2026-10-01'), [], today)!.unquantified).toBe(false);
  });
});

describe('summarisePenalties', () => {
  it('totals what is incurred, what lands within the horizon, and leaves filed jobs out', () => {
    const jobs = [
      job('annual_accounts', '2026-08-01'), // 42 days late: £375, next £750 in ~50 days
      job('corporation_tax', '2026-09-20'), // 8 days ahead: £200 in 9 days
      job('vat', '2026-12-01'), // far ahead, no exposure
      filed('annual_accounts', '2025-12-31', '2026-01-10', '2025-03-31', { clientId: 'cl_z' }),
    ];
    const summary = summarisePenalties(jobs, today, 14);
    expect(summary.incurred).toBe(375);
    expect(summary.atRiskWithinHorizon).toBe(200);
    expect(summary.jobsWithExposure).toBe(2);
    expect(summary.items.map((i) => i.serviceCode)).toEqual(['annual_accounts', 'corporation_tax']);
  });

  it('orders by what is already incurred, then by what lands soonest', () => {
    const jobs = [job('corporation_tax', '2026-09-20'), job('annual_accounts', '2026-09-11'), job('self_assessment', '2026-09-15')];
    const summary = summarisePenalties(jobs, today, 30);
    expect(summary.items.map((i) => i.serviceCode)).toEqual(['annual_accounts', 'self_assessment', 'corporation_tax']);
  });

  it('counts unquantified regimes separately so the pound total stays honest', () => {
    const summary = summarisePenalties([job('confirmation_statement', '2026-09-01'), job('payroll', '2026-09-01')], today, 14);
    expect(summary.incurred).toBe(0);
    expect(summary.jobsUnquantified).toBe(2);
    expect(summary.jobsWithExposure).toBe(0);
  });
});

describe('formatPounds', () => {
  it('uses the UK thousands separator', () => {
    expect(formatPounds(1500)).toBe('£1,500');
    expect(formatPounds(0)).toBe('£0');
  });
});
