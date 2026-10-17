import { describe, expect, it, vi } from 'vitest';
import { AutomationScheduler, TICK_MS } from '../automationScheduler.mjs';

const WED_11AM = new Date('2026-09-16T10:00:00Z');
const snapshot = {
  practice: { id: 'p', name: 'P', timezone: 'Europe/London', automation: { autoReminders: true } },
  users: [{ id: 'u1', name: 'Owner' }],
  clients: [{ id: 'c1', name: 'Acme', lifecycle: 'active', preferredChannel: 'email', primaryContactId: 'ct1', ownerUserId: 'u1' }],
  contacts: [{ id: 'ct1', clientId: 'c1', name: 'Dave', email: 'dave@acme.example', isPrimary: true }],
  jobs: [{ id: 'j1', clientId: 'c1', serviceCode: 'annual_accounts', name: 'Accounts', dueDate: '2026-10-14', status: 'waiting_for_records', waitingOn: 'client' }],
  requestItems: [{ id: 'r1', jobId: 'j1', clientId: 'c1', label: 'Sales invoices', documentType: 'x', status: 'missing', required: true }],
  communications: [],
  reminderSequences: [{ id: 'seq_accounts', steps: [{ daysBeforeDue: 30, channels: ['email'], tone: 'standard', label: 'Email (30 days)' }] }],
};

const deps = (over = {}) => ({
  readSnapshot: vi.fn(async () => snapshot),
  getProvider: () => ({ name: 'postmark', isConfigured: () => true, send: vi.fn(async () => ({ providerMessageId: 'pm', status: 'sent' })) }),
  pendingByJob: async () => new Map(),
  claimReminder: vi.fn(async () => 'arm_1'),
  completeReminder: vi.fn(async () => {}),
  releaseReminder: vi.fn(),
  markReminderUnknown: vi.fn(),
  ...over,
});

describe('AutomationScheduler', () => {
  it('runs one pass per tick and counts what it sent', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const d = deps();
    const scheduler = new AutomationScheduler({ deps: d, now: () => WED_11AM });
    expect(await scheduler.tick()).toEqual({ status: 'done', sent: 1 });
    expect(scheduler.stats).toEqual({ ticks: 1, sent: 1, failed: 0 });
    expect(d.completeReminder).toHaveBeenCalledTimes(1);
  });

  it('reports why it did nothing, and does nothing quietly', async () => {
    const off = new AutomationScheduler({ deps: deps({ readSnapshot: async () => ({ ...snapshot, practice: { ...snapshot.practice, automation: {} } }) }), now: () => WED_11AM });
    expect(await off.tick()).toEqual({ status: 'off', sent: 0 });
    const night = new AutomationScheduler({ deps: deps(), now: () => new Date('2026-09-16T22:00:00Z') });
    expect(await night.tick()).toEqual({ status: 'outside_hours', sent: 0 });
  });

  it('survives a failing pass, and does not run two at once', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const broken = new AutomationScheduler({ deps: deps({ readSnapshot: async () => { throw new Error('db down'); } }), now: () => WED_11AM });
    expect(await broken.tick()).toEqual({ status: 'error' });

    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const slow = new AutomationScheduler({ deps: deps({ readSnapshot: async () => { await gate; return snapshot; } }), now: () => WED_11AM });
    const first = slow.tick();
    expect(await slow.tick()).toEqual({ status: 'busy' });
    release();
    await first;
  });

  it('starts a timer without sending at once, and stops it', () => {
    const timers = [];
    const cleared = [];
    const d = deps();
    const scheduler = new AutomationScheduler({ deps: d, setInterval: (fn, ms) => (timers.push({ fn, ms }), timers.length), clearInterval: (t) => cleared.push(t) });
    scheduler.start();
    scheduler.start();
    expect(timers).toHaveLength(1);
    expect(timers[0].ms).toBe(TICK_MS);
    expect(d.readSnapshot).not.toHaveBeenCalled();
    scheduler.stop();
    scheduler.stop();
    expect(cleared).toEqual([1]);
  });
});
