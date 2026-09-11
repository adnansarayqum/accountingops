import { describe, expect, it } from 'vitest';
import { computeDashboardMetrics } from '../metrics';
import { computeCapacity } from '../capacity';
import { buildFixtureData } from '../../../testing/fixtures';
import { evaluateAttention } from '../attention';

const today = '2026-09-11';
const d = buildFixtureData(today);

describe('dashboard metrics', () => {
  const attention = evaluateAttention({ jobs: d.jobs, clients: d.clients, items: d.requestItems, comms: d.communications, approvals: d.approvals, personRoles: d.personRoles, sequences: d.reminderSequences, users: d.users, today });
  const m = computeDashboardMetrics(d.jobs, d.communications, attention, today, 0);

  it('counts overdue, ready to file and waiting on client from job state', () => {
    expect(m.overdue).toBe(d.jobs.filter((j) => j.status !== 'filed' && j.dueDate < today).length);
    expect(m.readyToFile).toBe(d.jobs.filter((j) => j.status === 'ready_to_file').length);
    expect(m.waitingOnClient).toBe(d.jobs.filter((j) => j.status !== 'filed' && j.waitingOn === 'client').length);
  });

  it('computes on-time percentage from filed jobs only', () => {
    const filed = d.jobs.filter((j) => j.status === 'filed');
    expect(m.completedOnTime + m.completedLate).toBe(filed.length);
    expect(m.onTimePercent).toBe(Math.round((m.completedOnTime / filed.length) * 100));
  });

  it('returns null on-time when nothing is filed', () => {
    expect(computeDashboardMetrics([], [], [], today, 0).onTimePercent).toBeNull();
  });
});

describe('capacity', () => {
  it('bands users and lists unassigned work', () => {
    const c = computeCapacity(d.users, d.jobs, 30, today);
    expect(c.rows.length).toBe(4);
    expect(c.unassigned.some((j) => j.id === 'job_hartley_ct')).toBe(false); // due in 130 days, outside window
    const c60 = computeCapacity(d.users, d.jobs, 60, today);
    expect(c60.rows.every((r) => ['overloaded', 'balanced', 'under'].includes(r.band))).toBe(true);
  });
});
