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

describe('identity verification reasons', () => {
  it('says how many verification statements Companies House expects, and by when, once a refresh has recorded it', () => {
    const d = buildFixtureData(today);
    // Greenfield's confirmation statement is due in 18 days; Olivia's two roles are not started.
    const olivia = d.personRoles.filter((r) => r.personId === 'p_olivia');
    expect(olivia).toHaveLength(2);
    for (const role of olivia) role.companiesHouseVerification = { checkedAt: '2026-09-11T08:00:00Z', verifiedOn: null, dueOn: role.kind === 'psc' ? '2026-09-28' : '2026-10-05' };
    const item = evaluateAttention(ctx({ personRoles: d.personRoles })).find((i) => i.jobId === 'job_greenfield_cs');
    expect(item?.ruleCode).toBe('identity_incomplete');
    expect(item?.reasons).toEqual([
      '2 directors/PSCs still need identity verification.',
      'Companies House expects 2 verification statements by 28 Sep 2026.',
      'Companies House will reject the filing without it.',
    ]);
  });

  it('keeps the plain reason when Companies House has published no dates', () => {
    const item = evaluateAttention(ctx()).find((i) => i.jobId === 'job_greenfield_cs');
    expect(item?.reasons).toEqual(['2 directors/PSCs still need identity verification.', 'Companies House will reject the filing without it.']);
  });
});

describe('configurable thresholds (Settings → Timing thresholds)', () => {
  it('uses the same defaults whether thresholds are omitted or explicitly passed as the defaults', () => {
    const withDefaults = evaluateAttention(ctx({ thresholds: { dueSoonDays: 14, identityVerificationWindowDays: 45, staleJobDays: 14, reviewWaitDays: 7, approvalWaitDays: 10 } }));
    expect(withDefaults).toEqual(evaluateAttention(ctx()));
  });

  it('identityVerificationWindowDays: widening it brings a farther-out confirmation statement into scope', () => {
    // job_lumen_cs is due in 88 days with an unverified director — outside the
    // default 45-day window, and nothing else about it qualifies for any other
    // rule, so by default it doesn't appear at all.
    expect(evaluateAttention(ctx()).find((i) => i.jobId === 'job_lumen_cs')).toBeUndefined();
    const widened = evaluateAttention(ctx({ thresholds: { identityVerificationWindowDays: 90 } })).find((i) => i.jobId === 'job_lumen_cs');
    expect(widened?.ruleCode).toBe('identity_incomplete');
    expect(widened?.reasons[0]).toContain('1 director');
  });

  it('identityVerificationWindowDays: narrowing it drops a confirmation statement that the default would flag', () => {
    // job_greenfield_cs, due in 18 days with two unverified roles, is flagged by default.
    expect(evaluateAttention(ctx()).find((i) => i.jobId === 'job_greenfield_cs')?.ruleCode).toBe('identity_incomplete');
    const narrowed = evaluateAttention(ctx({ thresholds: { identityVerificationWindowDays: 10 } })).find((i) => i.jobId === 'job_greenfield_cs');
    expect(narrowed).toBeUndefined();
  });

  it('staleJobDays: narrowing it flags a job that has not moved in 9 days, which the default (14) does not', () => {
    // job_northern_accounts: in_progress, unchanged for 9 days, nothing else about it qualifies for any rule.
    expect(evaluateAttention(ctx()).find((i) => i.jobId === 'job_northern_accounts')).toBeUndefined();
    const narrowed = evaluateAttention(ctx({ thresholds: { staleJobDays: 5 } })).find((i) => i.jobId === 'job_northern_accounts');
    expect(narrowed?.ruleCode).toBe('stale');
  });

  it('reviewWaitDays: widening it beyond 8 days stops flagging a review that has sat that long', () => {
    // job_hartley_accounts: internal_review, no reviewer, unchanged for 8 days — flagged by the default (7).
    expect(evaluateAttention(ctx()).find((i) => i.jobId === 'job_hartley_accounts')?.ruleCode).toBe('review_no_reviewer');
    const widened = evaluateAttention(ctx({ thresholds: { reviewWaitDays: 10 } })).find((i) => i.jobId === 'job_hartley_accounts');
    expect(widened).toBeUndefined();
  });

  it('approvalWaitDays: widening it beyond 11 days stops flagging an approval that has sat that long', () => {
    // job_brown_accounts: waiting_client_approval for 11 days — flagged by the default (10).
    expect(evaluateAttention(ctx()).find((i) => i.jobId === 'job_brown_accounts')?.ruleCode).toBe('approval_stalled');
    const widened = evaluateAttention(ctx({ thresholds: { approvalWaitDays: 15 } })).find((i) => i.jobId === 'job_brown_accounts');
    expect(widened).toBeUndefined();
  });

  it('a partial override only changes the field given — every other threshold keeps behaving as the default', () => {
    const partial = evaluateAttention(ctx({ thresholds: { staleJobDays: 5 } }));
    const full = evaluateAttention(ctx({ thresholds: { staleJobDays: 5, dueSoonDays: 14, identityVerificationWindowDays: 45, reviewWaitDays: 7, approvalWaitDays: 10 } }));
    expect(partial).toEqual(full);
  });
});


describe('penalty reasons', () => {
  it('states the late-filing penalty in pounds on an overdue job, and what it rises to', () => {
    const d = buildFixtureData(today);
    const overdue = d.jobs.find((j) => j.status !== 'filed' && j.serviceCode === 'annual_accounts' && j.dueDate < today)!;
    const items = evaluateAttention({ jobs: d.jobs, clients: d.clients, items: d.requestItems, comms: d.communications, approvals: d.approvals, personRoles: d.personRoles, sequences: d.reminderSequences, users: d.users, today });
    const item = items.find((a) => a.jobId === overdue.id)!;
    expect(item.reasons.some((r) => /^Late filing penalty now £\d/.test(r))).toBe(true);
    expect(item.reasons.some((r) => /Rises by £\d+ in \d+ days?\./.test(r))).toBe(true);
  });
});
