import { describe, expect, it } from 'vitest';
import { TURNOVER_STALE_DAYS, VAT_APPROACHING_SHARE, VAT_REGISTRATION_THRESHOLD, vatThresholdStatus, vatThresholdSummary } from '../vatThreshold';
import type { Client, ClientIdentifier } from '../../types';

const today = '2026-09-12';
const client = (id: string, over: Partial<Client> = {}): Client =>
  ({ id, practiceId: 'p', name: id, type: 'sole_trader', lifecycle: 'active', ownerUserId: 'u', primaryContactId: 'c', preferredChannel: 'email', averageResponseDays: 5, createdAt: '2026-01-01T00:00:00Z', ...over }) as Client;
const vat = (clientId: string): ClientIdentifier => ({ id: `i_${clientId}`, practiceId: 'p', clientId, kind: 'vat_number', value: 'GB123456789', sensitive: false });

describe('vatThresholdStatus', () => {
  it('uses the current £90,000 threshold and flags from 85% of it', () => {
    expect(VAT_REGISTRATION_THRESHOLD).toBe(90_000);
    expect(VAT_APPROACHING_SHARE).toBe(0.85);
  });

  it('does not watch a client who is already registered', () => {
    expect(vatThresholdStatus(client('a', { rolling12MonthTurnover: 200_000 }), [vat('a')], today).state).toBe('registered');
  });

  it('cannot see a client with no figure on file, and says so rather than guessing', () => {
    expect(vatThresholdStatus(client('a'), [], today)).toMatchObject({ state: 'no_figure', share: null, headroom: null });
    expect(vatThresholdStatus(client('b', { rolling12MonthTurnover: -5 }), [], today).state).toBe('no_figure');
  });

  it('is clear, approaching, or over by share of the threshold, with the headroom in pounds', () => {
    expect(vatThresholdStatus(client('a', { rolling12MonthTurnover: 50_000, turnoverRecordedOn: '2026-09-01' }), [], today)).toMatchObject({ state: 'clear', headroom: 40_000, stale: false });
    expect(vatThresholdStatus(client('b', { rolling12MonthTurnover: 76_500, turnoverRecordedOn: '2026-09-01' }), [], today)).toMatchObject({ state: 'approaching', share: 0.85, headroom: 13_500 });
    expect(vatThresholdStatus(client('c', { rolling12MonthTurnover: 90_000, turnoverRecordedOn: '2026-09-01' }), [], today)).toMatchObject({ state: 'over', share: 1, headroom: 0 });
    expect(vatThresholdStatus(client('d', { rolling12MonthTurnover: 95_000, turnoverRecordedOn: '2026-09-01' }), [], today)).toMatchObject({ state: 'over', headroom: -5_000 });
  });

  it('marks a figure stale after four months, or when it was never dated', () => {
    expect(TURNOVER_STALE_DAYS).toBe(120);
    expect(vatThresholdStatus(client('a', { rolling12MonthTurnover: 50_000, turnoverRecordedOn: '2026-04-01' }), [], today).stale).toBe(true);
    expect(vatThresholdStatus(client('b', { rolling12MonthTurnover: 50_000 }), [], today).stale).toBe(true);
    expect(vatThresholdStatus(client('c', { rolling12MonthTurnover: 50_000, turnoverRecordedOn: '2026-06-01' }), [], today).stale).toBe(false);
  });
});

describe('vatThresholdSummary', () => {
  it('lists over first, then closest to the line, and counts the rest', () => {
    const clients = [
      client('over', { rolling12MonthTurnover: 91_000 }),
      client('near', { rolling12MonthTurnover: 80_000 }),
      client('nearer', { rolling12MonthTurnover: 88_000 }),
      client('clear', { rolling12MonthTurnover: 20_000 }),
      client('blank'),
      client('reg', { rolling12MonthTurnover: 500_000 }),
      client('gone', { lifecycle: 'ceased', rolling12MonthTurnover: 500_000 }),
    ];
    const summary = vatThresholdSummary(clients, [vat('reg')], today);
    expect(summary.over.map((s) => s.clientId)).toEqual(['over']);
    expect(summary.approaching.map((s) => s.clientId)).toEqual(['nearer', 'near']);
    expect(summary).toMatchObject({ noFigure: 1, clear: 1, registered: 1 });
  });
});
