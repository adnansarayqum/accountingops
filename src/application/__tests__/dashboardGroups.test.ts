import { describe, expect, it } from 'vitest';
import { groupDueSoonByService } from '../dashboardGroups';
import { computeDerived } from '../selectors';
import { buildFixtureData } from '../../testing/fixtures';
import type { JobView } from '../selectors';
import type { ServiceCode } from '../../domain/types';

const today = '2026-09-11';

/** A minimal stand-in for a JobView — groupDueSoonByService only ever reads job.id, job.serviceCode and daysUntilDue. */
function view(id: string, serviceCode: ServiceCode, daysUntilDue: number): JobView {
  return { job: { id, serviceCode }, daysUntilDue } as unknown as JobView;
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
