import { describe, expect, it } from 'vitest';
import { evaluateAttention, type AttentionContext } from '../attention';
import { buildFixtureData } from '../../../testing/fixtures';

const today = '2026-09-11';

function ctx(overrides: Partial<AttentionContext> = {}): AttentionContext {
  const d = buildFixtureData(today);
  return { jobs: d.jobs, clients: d.clients, items: d.requestItems, comms: d.communications, approvals: d.approvals, personRoles: d.personRoles, sequences: d.reminderSequences, users: d.users, today, ...overrides };
}

describe('attention rules against the fixture dataset', () => {
  const items = evaluateAttention(ctx());
  const byJob = new Map(items.map((i) => [i.jobId, i]));

  it('flags overdue accounts with missing documents as red', () => {
    const patel = byJob.get('job_patel_accounts');
    expect(patel?.severity).toBe('red');
    expect(patel?.ruleCode).toBe('overdue_missing_docs');
    expect(patel?.reasons.join(' ')).toMatch(/bank statements/i);
  });

  it('flags a VAT return due in 5 days with 40% missing as red', () => {
    const oak = byJob.get('job_oakwood_vat');
    expect(oak?.severity).toBe('red');
    expect(oak?.reasons[0]).toContain('40%');
  });

  it('flags ABC Construction (ignored reminders, due in 12 days) with a reminder action', () => {
    const abc = byJob.get('job_abc_accounts');
    expect(abc).toBeDefined();
    expect(abc?.recommendedAction.kind).toBe('send_reminder');
    expect(abc?.recommendedAction.channel).toBe('whatsapp');
    expect(abc?.reasons.join(' ')).toMatch(/ignored 2 reminders/);
  });

  it('flags internal review with no reviewer as amber', () => {
    expect(byJob.get('job_hartley_accounts')?.ruleCode).toBe('review_no_reviewer');
  });

  it('flags stalled client approval', () => {
    expect(byJob.get('job_brown_accounts')?.ruleCode).toBe('approval_stalled');
  });

  it('flags confirmation statement with unverified directors', () => {
    expect(byJob.get('job_greenfield_cs')?.ruleCode).toBe('identity_incomplete');
  });

  it('flags stale in-progress jobs', () => {
    expect(byJob.get('job_lumen_accounts')?.ruleCode).toBe('stale');
  });

  it('never flags filed jobs and sorts red first', () => {
    expect(items.some((i) => i.jobId === 'job_abc_payroll_prev')).toBe(false);
    const firstAmber = items.findIndex((i) => i.severity === 'amber');
    const lastRed = items.map((i) => i.severity).lastIndexOf('red');
    expect(lastRed).toBeLessThan(firstAmber === -1 ? Infinity : firstAmber);
  });

  it('drops the attention flag once documents are complete', () => {
    const c = ctx();
    c.items = c.items.map((i) => (i.jobId === 'job_abc_accounts' ? { ...i, status: 'received' } : i));
    c.jobs = c.jobs.map((j) => (j.id === 'job_abc_accounts' ? { ...j, status: 'ready_to_start', waitingOn: 'accountant', statusChangedAt: `${today}T09:00:00Z` } : j));
    expect(evaluateAttention(c).some((i) => i.jobId === 'job_abc_accounts')).toBe(false);
  });
});
