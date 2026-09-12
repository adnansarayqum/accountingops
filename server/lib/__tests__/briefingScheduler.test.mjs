import { describe, expect, it, vi } from 'vitest';
import { BriefingScheduler, sendHourFromEnv } from '../briefingScheduler.mjs';

const snapshot = {
  practice: { timezone: 'Europe/London' },
  clients: [{ id: 'cl_a', name: 'Acme Ltd' }],
  jobs: [{ id: 'j1', clientId: 'cl_a', name: '2025 Annual Accounts', status: 'waiting_for_records', waitingOn: 'client', dueDate: '2026-09-11' }],
  communications: [],
};

function harness(over = {}) {
  const sent = [];
  const marked = [];
  const provider = { name: 'test', isConfigured: () => true, send: vi.fn(async (m) => void sent.push(m)) };
  const scheduler = new BriefingScheduler({
    now: () => new Date('2026-09-14T06:10:00Z'), // Monday 07:10 London
    provider,
    listRecipients: async () => [{ userId: 'u1', name: 'Adnan', email: 'adnan@example.com', lastSentOn: null }],
    readSnapshot: async () => snapshot,
    markSent: async (userId, date) => void marked.push([userId, date]),
    appUrl: 'https://ops.example',
    ...over,
  });
  return { scheduler, sent, marked, provider };
}

describe('BriefingScheduler', () => {
  it('sends one briefing per recipient on a weekday morning and records the local date', async () => {
    const { scheduler, sent, marked } = harness();
    expect(await scheduler.tick()).toEqual({ sent: 1 });
    expect(sent[0]).toMatchObject({ to: 'adnan@example.com', subject: 'Monday briefing: 1 overdue, 0 due this week, 0 ready to file' });
    expect(sent[0].body).toContain('https://ops.example/briefing');
    expect(marked).toEqual([['u1', '2026-09-14']]);
  });

  it('does not send twice in a day', async () => {
    const { scheduler, sent } = harness({ listRecipients: async () => [{ userId: 'u1', email: 'a@b.c', lastSentOn: '2026-09-14' }] });
    expect(await scheduler.tick()).toEqual({ sent: 0 });
    expect(sent).toHaveLength(0);
  });

  it('does nothing before the send hour, at the weekend, or with no provider configured', async () => {
    expect((await harness({ now: () => new Date('2026-09-14T04:00:00Z') }).scheduler.tick()).sent).toBe(0);
    expect((await harness({ now: () => new Date('2026-09-13T08:00:00Z') }).scheduler.tick()).sent).toBe(0);
    const { scheduler, provider } = harness({ provider: { name: 'x', isConfigured: () => false, send: vi.fn() } });
    expect(await scheduler.tick()).toEqual({ sent: 0, skipped: 'no_provider' });
    expect(provider.send).not.toHaveBeenCalled();
  });

  it('never reads the snapshot when nobody is due — most ticks send to nobody', async () => {
    const readSnapshot = vi.fn(async () => snapshot);
    const { scheduler } = harness({ readSnapshot, listRecipients: async () => [{ userId: 'u1', email: 'a@b.c', lastSentOn: '2026-09-14' }] });
    await scheduler.tick();
    expect(readSnapshot).not.toHaveBeenCalled();
  });

  it('keeps going for the others when one send fails, and does not mark that one as sent', async () => {
    const send = vi.fn(async ({ to }) => {
      if (to === 'bad@example.com') throw new Error('rejected');
    });
    const marked = [];
    const { scheduler } = harness({
      provider: { name: 't', isConfigured: () => true, send },
      listRecipients: async () => [
        { userId: 'u_bad', email: 'bad@example.com', lastSentOn: null },
        { userId: 'u_ok', email: 'ok@example.com', lastSentOn: null },
      ],
      markSent: async (userId, date) => void marked.push([userId, date]),
    });
    expect(await scheduler.tick()).toEqual({ sent: 1 });
    expect(marked).toEqual([['u_ok', '2026-09-14']]);
    expect(scheduler.stats.failed).toBe(1);
  });

  it('survives a failing store rather than taking the process down', async () => {
    const { scheduler } = harness({ listRecipients: async () => { throw new Error('db down'); } });
    expect(await scheduler.tick()).toEqual({ sent: 0, skipped: 'error' });
  });

  it('runs on a timer and stops cleanly', () => {
    const timers = [];
    const { scheduler } = harness({ setInterval: (fn, ms) => (timers.push({ fn, ms }), 'timer-1'), clearInterval: (t) => timers.push({ cleared: t }) });
    scheduler.start();
    scheduler.start();
    expect(timers.filter((t) => t.fn)).toHaveLength(1);
    scheduler.stop();
    expect(timers.at(-1)).toEqual({ cleared: 'timer-1' });
  });

  it('reads the send hour from the environment, defaulting to seven', () => {
    expect(sendHourFromEnv({})).toBe(7);
    expect(sendHourFromEnv({ BRIEFING_SEND_HOUR: '9' })).toBe(9);
    expect(sendHourFromEnv({ BRIEFING_SEND_HOUR: '25' })).toBe(7);
    expect(sendHourFromEnv({ BRIEFING_SEND_HOUR: 'noon' })).toBe(7);
  });
});
