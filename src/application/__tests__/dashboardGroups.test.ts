import { describe, expect, it } from 'vitest';
import { groupDueSoonByService, serviceStatuses } from '../dashboardGroups';
import { computeDerived } from '../selectors';
import { buildFixtureData } from '../../testing/fixtures';
import type { JobView } from '../selectors';
import type { JobStatus, ServiceCode } from '../../domain/types';

const today = '2026-09-11';

/** A minimal stand-in for a JobView — these helpers only ever read job.id, job.serviceCode, job.status and daysUntilDue. */
function view(id: string, serviceCode: ServiceCode, daysUntilDue: number, status: JobStatus = 'in_progress'): JobView {
  return { job: { id, serviceCode, status }, daysUntilDue } as unknown as JobView;
}

describe('groupDueSoonByService', () => {
  it('returns nothing for an empty list', () => {
    expect(groupDueSoonByService([])).toEqual([]);
  });

  it('groups by service, keeps each group in its original (due-date) order, and orders groups by nearest deadline', () => {
    // Deliberately pre-sorted by daysUntilDue, as the caller (Dashboard) always passes it —
    // that's what makes each group's first entry its nearest deadline.
    const views = [
      view('cs_soonest', 'confirmation_statement', 1),
      view('vat_soonest', 'vat', 3),
      view('accounts_only', 'annual_accounts', 5),
      view('cs_later', 'confirmation_statement', 10),
      view('vat_later', 'vat', 12),
    ];

    const groups = groupDueSoonByService(views);

    expect(groups.map((g) => g.serviceCode)).toEqual(['confirmation_statement', 'vat', 'annual_accounts']);
    expect(groups.map((g) => g.label)).toEqual(['CS01', 'VAT', 'Accounts']);
    expect(groups[0].views.map((v) => v.job.id)).toEqual(['cs_soonest', 'cs_later']);
    expect(groups[1].views.map((v) => v.job.id)).toEqual(['vat_soonest', 'vat_later']);
    expect(groups[2].views.map((v) => v.job.id)).toEqual(['accounts_only']);
  });

  it('gives a service with only one due-soon job its own single-item group', () => {
    const groups = groupDueSoonByService([view('lonely_vat', 'vat', 4)]);
    expect(groups).toEqual([{ serviceCode: 'vat', label: 'VAT', views: [view('lonely_vat', 'vat', 4)] }]);
  });

  it('splits a realistic due-soon list from the fixture practice the way the Dashboard actually calls it', () => {
    const data = buildFixtureData(today);
    const derived = computeDerived(data, today);
    const dueSoonViews = derived.jobViews.filter((v) => v.job.status !== 'filed' && v.daysUntilDue >= 0 && v.daysUntilDue <= 14);
    expect(dueSoonViews.length).toBeGreaterThan(0);

    const groups = groupDueSoonByService(dueSoonViews);

    // Nothing lost or duplicated across the split, and every group is genuinely single-service.
    expect(groups.reduce((sum, g) => sum + g.views.length, 0)).toBe(dueSoonViews.length);
    for (const group of groups) {
      expect(group.views.every((v) => v.job.serviceCode === group.serviceCode)).toBe(true);
    }
    // Groups are ordered by their nearest deadline.
    const nearestDeadlines = groups.map((g) => g.views[0].daysUntilDue);
    expect(nearestDeadlines).toEqual([...nearestDeadlines].sort((a, b) => a - b));

    // The fixture has several clients whose payroll falls due within the next 14 days —
    // a stable enough fact of the practice to check without pinning the exact count.
    expect(groups.some((g) => g.serviceCode === 'payroll')).toBe(true);
  });
});

describe('serviceStatuses', () => {
  it('returns nothing for an empty list', () => {
    expect(serviceStatuses([], 14)).toEqual([]);
  });

  it('counts overdue, due-soon and open per service, and leads with overdue + due soon', () => {
    const statuses = serviceStatuses(
      [
        view('vat_overdue', 'vat', -3),
        view('vat_soon', 'vat', 5),
        view('vat_later', 'vat', 60),
        view('cs_soon', 'confirmation_statement', 10),
      ],
      14,
    );

    expect(statuses.map((s) => s.serviceCode)).toEqual(['vat', 'confirmation_statement']);
    expect(statuses[0]).toEqual({ serviceCode: 'vat', label: 'VAT', overdue: 1, dueSoon: 1, due: 2, open: 3, nextDueInDays: -3 });
    expect(statuses[1]).toEqual({ serviceCode: 'confirmation_statement', label: 'CS01', overdue: 0, dueSoon: 1, due: 1, open: 1, nextDueInDays: 10 });
  });

  it('leaves filed jobs out of every count', () => {
    const statuses = serviceStatuses([view('done', 'vat', -30, 'filed'), view('open', 'vat', 3)], 14);
    expect(statuses).toEqual([{ serviceCode: 'vat', label: 'VAT', overdue: 0, dueSoon: 1, due: 1, open: 1, nextDueInDays: 3 }]);
  });

  it('drops a service entirely once nothing of it is open', () => {
    expect(serviceStatuses([view('done', 'payroll', -30, 'filed')], 14)).toEqual([]);
  });

  it('keeps a service with open work but nothing due yet, so the tile can say what is next', () => {
    const [payroll] = serviceStatuses([view('far', 'payroll', 90)], 14);
    expect(payroll).toMatchObject({ due: 0, overdue: 0, dueSoon: 0, open: 1, nextDueInDays: 90 });
  });

  it('respects the practice\'s due-soon window', () => {
    const views = [view('a', 'vat', 20)];
    expect(serviceStatuses(views, 14)[0]).toMatchObject({ dueSoon: 0, due: 0 });
    expect(serviceStatuses(views, 30)[0]).toMatchObject({ dueSoon: 1, due: 1 });
  });

  it('orders services by nearest deadline, so anything overdue comes first', () => {
    const statuses = serviceStatuses(
      [view('payroll', 'payroll', 8), view('accounts', 'annual_accounts', -1), view('vat', 'vat', 3)],
      14,
    );
    expect(statuses.map((s) => s.serviceCode)).toEqual(['annual_accounts', 'vat', 'payroll']);
  });

  it('matches the real fixture practice: every open job is counted exactly once, in the right service', () => {
    const data = buildFixtureData(today);
    const derived = computeDerived(data, today);
    const statuses = serviceStatuses(derived.jobViews, derived.thresholds.dueSoonDays);
    const openViews = derived.jobViews.filter((v) => v.job.status !== 'filed');

    expect(statuses.reduce((sum, s) => sum + s.open, 0)).toBe(openViews.length);
    for (const status of statuses) {
      expect(status.due).toBe(status.overdue + status.dueSoon);
      expect(status.due).toBeLessThanOrEqual(status.open);
      expect(status.open).toBe(openViews.filter((v) => v.job.serviceCode === status.serviceCode).length);
    }
    // The fixture has overdue accounts, so that tile sorts to the front.
    expect(statuses[0].serviceCode).toBe('annual_accounts');
    expect(statuses[0].overdue).toBeGreaterThan(0);
  });
});
