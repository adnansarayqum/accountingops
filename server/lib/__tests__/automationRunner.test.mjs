import { describe, expect, it, vi } from 'vitest';
import { runAutomation, usableProvider } from '../automationRunner.mjs';
import { RULES } from '../automation.mjs';
import { MessagingError } from '../messaging/errors.mjs';

const SEQUENCE = { id: 'seq_accounts', steps: [{ daysBeforeDue: 30, channels: ['email'], tone: 'standard', label: 'Email (30 days)' }] };
const WED_11AM = new Date('2026-09-16T10:00:00Z');
const SAT = new Date('2026-09-19T10:00:00Z');

function snapshot({ jobs = 1, on = true } = {}) {
  return {
    practice: { id: 'p', name: 'Farhan & Raihan', timezone: 'Europe/London', automation: { autoReminders: on } },
    users: [{ id: 'u1', name: 'Owner' }],
    clients: Array.from({ length: jobs }, (_, i) => ({ id: `c${i}`, name: `Client ${i}`, lifecycle: 'active', preferredChannel: 'email', primaryContactId: `ct${i}`, ownerUserId: 'u1' })),
    contacts: Array.from({ length: jobs }, (_, i) => ({ id: `ct${i}`, clientId: `c${i}`, name: `Person ${i}`, email: `p${i}@example.com`, isPrimary: true })),
    jobs: Array.from({ length: jobs }, (_, i) => ({ id: `j${i}`, clientId: `c${i}`, serviceCode: 'annual_accounts', name: 'Accounts', dueDate: '2026-10-14', status: 'waiting_for_records', waitingOn: 'client' })),
    requestItems: Array.from({ length: jobs }, (_, i) => ({ id: `r${i}`, jobId: `j${i}`, clientId: `c${i}`, label: 'Sales invoices', documentType: 'x', status: 'missing', required: true })),
    communications: [],
    reminderSequences: [SEQUENCE],
  };
}

const realProvider = (send) => ({ name: 'postmark', isConfigured: () => true, send: vi.fn(send ?? (async () => ({ providerMessageId: 'pm_1', status: 'sent' }))) });

function deps(overrides = {}) {
  let n = 0;
  return {
    readSnapshot: vi.fn(async () => snapshot()),
    getProvider: () => realProvider(),
    pendingByJob: vi.fn(async () => new Map()),
    claimReminder: vi.fn(async () => `arm_${(n += 1)}`),
    completeReminder: vi.fn(async () => {}),
    releaseReminder: vi.fn(async () => {}),
    markReminderUnknown: vi.fn(async () => {}),
    ...overrides,
  };
}

describe('usableProvider', () => {
  it('accepts only a provider that really delivers and is configured', () => {
    const real = realProvider();
    expect(usableProvider(() => real)).toEqual({ provider: real });
    expect(usableProvider(() => ({ name: 'simulated', isConfigured: () => true }))).toEqual({ problem: 'simulated_provider' });
    expect(usableProvider(() => ({ name: 'postmark', isConfigured: () => false }))).toEqual({ problem: 'provider_not_configured' });
  });

  it('names a provider that cannot be chosen at all', () => {
    expect(usableProvider(() => { throw new MessagingError(503, 'authenticated_mode_required'); })).toEqual({ problem: 'authenticated_mode_required' });
    expect(usableProvider(() => { throw new Error('boom'); })).toEqual({ problem: 'provider_error' });
  });
});

describe('runAutomation — the reasons it sends nothing', () => {
  it('has no practice data yet', async () => {
    expect(await runAutomation({ now: WED_11AM }, deps({ readSnapshot: async () => null }))).toEqual({ status: 'no_data' });
  });

  it('is switched off, and never touches the provider or the ledger', async () => {
    const d = deps({ readSnapshot: async () => snapshot({ on: false }), getProvider: vi.fn() });
    const result = await runAutomation({ now: WED_11AM }, d);
    expect(result.status).toBe('off');
    expect(d.getProvider).not.toHaveBeenCalled();
    expect(d.claimReminder).not.toHaveBeenCalled();
  });

  it('has no real email provider — a simulated one would record a reminder as sent that never left', async () => {
    const send = vi.fn();
    const d = deps({ getProvider: () => ({ name: 'simulated', isConfigured: () => true, send }) });
    expect(await runAutomation({ now: WED_11AM }, d)).toMatchObject({ status: 'no_provider', problem: 'simulated_provider' });
    expect(send).not.toHaveBeenCalled();
    expect(d.claimReminder).not.toHaveBeenCalled();
  });

  it('is outside working hours, unless a person asks for it anyway', async () => {
    const d = deps();
    expect(await runAutomation({ now: SAT }, d)).toMatchObject({ status: 'outside_hours' });
    expect(d.claimReminder).not.toHaveBeenCalled();
    expect(await runAutomation({ now: SAT, ignoreHours: true }, d)).toMatchObject({ status: 'done' });
  });

  it('has nothing due', async () => {
    const d = deps({ readSnapshot: async () => ({ ...snapshot(), jobs: [] }) });
    expect(await runAutomation({ now: WED_11AM }, d)).toMatchObject({ status: 'nothing_due' });
  });

  it('is a preview: shows what would go, and sends and records nothing', async () => {
    const provider = realProvider();
    const d = deps({ getProvider: () => provider });
    const result = await runAutomation({ now: WED_11AM, dryRun: true }, d);
    expect(result.status).toBe('preview');
    expect(result.plan.due).toHaveLength(1);
    expect(provider.send).not.toHaveBeenCalled();
    expect(d.claimReminder).not.toHaveBeenCalled();
    // Even outside hours a preview still shows what is waiting.
    expect((await runAutomation({ now: SAT, dryRun: true }, d)).status).toBe('preview');
  });
});

describe('runAutomation — sending', () => {
  it('claims the step first, sends the drafted email, then records it as sent', async () => {
    const provider = realProvider();
    const d = deps({ getProvider: () => provider });
    const result = await runAutomation({ now: WED_11AM }, d);

    expect(result).toMatchObject({ status: 'done', failed: [], unknown: [], sent: [{ id: 'arm_1', jobId: 'j0', clientName: 'Client 0', stage: 'Email (30 days)' }] });
    expect(d.claimReminder).toHaveBeenCalledWith(expect.objectContaining({ jobId: 'j0', stepNo: 0, clientId: 'c0', recipient: 'p0@example.com', stage: 'Email (30 days)', documentsRequested: ['Sales invoices'] }));
    expect(provider.send).toHaveBeenCalledWith({ to: 'p0@example.com', subject: 'Client 0 — Accounts: documents still needed', body: expect.stringContaining('Hi Person,') });
    expect(d.claimReminder.mock.invocationCallOrder[0]).toBeLessThan(provider.send.mock.invocationCallOrder[0]);
    expect(d.completeReminder).toHaveBeenCalledWith('arm_1', { providerName: 'postmark', providerMessageId: 'pm_1' });
  });

  it('sends nothing for a step that has already been taken — by an earlier pass or another server', async () => {
    const provider = realProvider();
    const d = deps({ getProvider: () => provider, claimReminder: vi.fn(async () => null) });
    const result = await runAutomation({ now: WED_11AM }, d);
    expect(result).toMatchObject({ status: 'done', sent: [] });
    expect(provider.send).not.toHaveBeenCalled();
  });

  it('frees the step when the provider clearly refused, so the next pass may try again', async () => {
    const provider = realProvider(async () => {
      throw new MessagingError(400, 'rejected_by_provider');
    });
    const d = deps({ getProvider: () => provider });
    const result = await runAutomation({ now: WED_11AM }, d);
    expect(result.failed).toEqual([{ jobId: 'j0', clientName: 'Client 0', error: 'rejected_by_provider' }]);
    expect(d.releaseReminder).toHaveBeenCalledWith('arm_1');
    expect(d.markReminderUnknown).not.toHaveBeenCalled();
    expect(d.completeReminder).not.toHaveBeenCalled();
  });

  it('never retries a send whose outcome it cannot know: a dropped connection or a crash of its own', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    for (const err of [new MessagingError(502, 'upstream_unreachable'), new Error('socket hang up')]) {
      const d = deps({ getProvider: () => realProvider(async () => { throw err; }) });
      const result = await runAutomation({ now: WED_11AM }, d);
      expect(result.unknown).toEqual([{ id: 'arm_1', jobId: 'j0', clientName: 'Client 0' }]);
      expect(d.markReminderUnknown).toHaveBeenCalledWith('arm_1');
      expect(d.releaseReminder).not.toHaveBeenCalled();
    }
  });

  it('goes on to the next client after one fails', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    let calls = 0;
    const provider = realProvider(async () => {
      calls += 1;
      if (calls === 1) throw new MessagingError(429, 'rate_limited');
      return { providerMessageId: 'pm_2', status: 'sent' };
    });
    const d = deps({ getProvider: () => provider, readSnapshot: async () => snapshot({ jobs: 3 }) });
    const result = await runAutomation({ now: WED_11AM }, d);
    expect(result.failed).toHaveLength(1);
    expect(result.sent).toHaveLength(2);
  });

  it('stops at the most it will send in one pass', async () => {
    const provider = realProvider();
    const d = deps({ getProvider: () => provider, readSnapshot: async () => snapshot({ jobs: RULES.maxPerRun + 5 }) });
    const result = await runAutomation({ now: WED_11AM }, d);
    expect(result.sent).toHaveLength(RULES.maxPerRun);
    expect(provider.send).toHaveBeenCalledTimes(RULES.maxPerRun);
  });

  it('counts reminders the snapshot does not record yet, so the step is not repeated', async () => {
    const provider = realProvider();
    const d = deps({ getProvider: () => provider, pendingByJob: async () => new Map([['j0', { count: 1, lastSentAt: '2026-09-16T09:00:00.000Z' }]]) });
    const result = await runAutomation({ now: WED_11AM }, d);
    expect(result.status).toBe('nothing_due');
    expect(provider.send).not.toHaveBeenCalled();
  });
});
