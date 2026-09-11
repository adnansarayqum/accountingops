import { describe, expect, it } from 'vitest';
import { generateNextJob, nextPeriod } from '../recurrence';
import type { Job, Obligation } from '../../types';

const ob: Obligation = { id: 'ob1', practiceId: 'p', clientId: 'c', serviceCode: 'vat', name: 'Quarterly VAT', frequency: 'quarterly', lastPeriodEnd: '2026-09-30', dueOffsetDays: 38, periodLengthMonths: 3 };

describe('recurrence', () => {
  it('computes the next quarterly period deterministically', () => {
    const p = nextPeriod(ob);
    expect(p.periodStart).toBe('2026-10-01');
    expect(p.periodEnd).toBe('2026-12-31');
    expect(p.dueDate).toBe('2027-02-07');
    expect(p.periodKey).toBe('2026-Q4');
  });

  it('generates the next job once and advances the obligation', () => {
    let n = 0;
    const gen = generateNextJob(ob, [], () => `job_${++n}`);
    expect(gen).not.toBeNull();
    expect(gen!.job.name).toBe('VAT Return 2026 Q4');
    expect(gen!.job.status).toBe('waiting_for_records');
    expect(gen!.obligation.lastPeriodEnd).toBe('2026-12-31');
  });

  it('prevents duplicate generation for the same period', () => {
    const existing: Job[] = [{ id: 'x', practiceId: 'p', clientId: 'c', obligationId: 'ob1', serviceCode: 'vat', name: 'VAT Return 2026 Q4', periodKey: '2026-Q4', periodStart: '2026-10-01', periodEnd: '2026-12-31', dueDate: '2027-02-07', status: 'waiting_for_records', waitingOn: 'client', estimatedHours: 3, statusChangedAt: '', createdAt: '' }];
    expect(generateNextJob(ob, existing, () => 'y')).toBeNull();
  });

  it('handles annual and monthly periods', () => {
    const annual = nextPeriod({ ...ob, frequency: 'annual', lastPeriodEnd: '2025-12-31', periodLengthMonths: 12, dueOffsetDays: 270 });
    expect(annual.periodEnd).toBe('2026-12-31');
    expect(annual.dueDate).toBe('2027-09-27');
    expect(annual.periodKey).toBe('2026');
    const monthly = nextPeriod({ ...ob, frequency: 'monthly', lastPeriodEnd: '2026-01-31', periodLengthMonths: 1, dueOffsetDays: 19 });
    expect(monthly.periodEnd).toBe('2026-02-28');
    expect(monthly.periodKey).toBe('2026-02');
  });
});
