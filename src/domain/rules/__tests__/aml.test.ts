import { describe, expect, it } from 'vitest';
import { AML_REVIEW_MONTHS, amlNextDue, amlReviewStatus, amlSummary } from '../aml';
import type { Client } from '../../types';

const today = '2026-09-12';
const client = (id: string, over: Partial<Client> = {}): Client =>
  ({ id, practiceId: 'p', name: id, type: 'limited_company', lifecycle: 'active', ownerUserId: 'u', primaryContactId: 'c', preferredChannel: 'email', averageResponseDays: 5, createdAt: '2026-01-01T00:00:00Z', ...over }) as Client;

describe('amlReviewStatus', () => {
  it('treats a client with no rating on file as never reviewed — the first thing a supervisory visit finds', () => {
    expect(amlReviewStatus(client('a'), today)).toMatchObject({ state: 'never_reviewed', rating: null, nextDueOn: null, daysUntilDue: null });
    expect(amlReviewStatus(client('b', { amlRiskRating: 'low' }), today).state).toBe('never_reviewed');
  });

  it('sets the next review by risk: annual for high, two-yearly for standard, three-yearly for low', () => {
    expect(AML_REVIEW_MONTHS).toEqual({ high: 12, standard: 24, low: 36 });
    expect(amlNextDue('high', '2026-01-15')).toBe('2027-01-15');
    expect(amlNextDue('standard', '2026-01-15')).toBe('2028-01-15');
    expect(amlNextDue('low', '2026-01-15')).toBe('2029-01-15');
  });

  it('is current, due soon within sixty days, and overdue after the date', () => {
    expect(amlReviewStatus(client('a', { amlRiskRating: 'high', amlLastReviewedOn: '2026-01-15' }), today)).toMatchObject({ state: 'current', nextDueOn: '2027-01-15', daysUntilDue: 125 });
    expect(amlReviewStatus(client('b', { amlRiskRating: 'high', amlLastReviewedOn: '2025-10-20' }), today)).toMatchObject({ state: 'due_soon', nextDueOn: '2026-10-20', daysUntilDue: 38 });
    expect(amlReviewStatus(client('c', { amlRiskRating: 'standard', amlLastReviewedOn: '2024-06-01' }), today)).toMatchObject({ state: 'overdue', nextDueOn: '2026-06-01', daysUntilDue: -103 });
  });

  it('takes a custom due-soon window', () => {
    expect(amlReviewStatus(client('b', { amlRiskRating: 'high', amlLastReviewedOn: '2025-10-20' }), today, 30).state).toBe('current');
  });

  it('fails safe on a rating outside the known set, rather than reading it as current', () => {
    // amlRiskRating is typed, but data can reach this rule from outside the
    // app's own store actions (a hand-built API request) — see
    // server/lib/practiceDataShape.mjs, which now refuses this at the
    // door, but this rule must not trust that being the only guard.
    const tampered = client('a', { amlRiskRating: 'extreme' as never, amlLastReviewedOn: '2026-01-15' });
    expect(amlReviewStatus(tampered, today)).toMatchObject({ state: 'never_reviewed', rating: null, nextDueOn: null, daysUntilDue: null });
  });
});

describe('amlSummary', () => {
  it('groups active clients worst first and leaves ceased ones out', () => {
    const clients = [
      client('never'),
      client('overdue_more', { amlRiskRating: 'high', amlLastReviewedOn: '2024-01-01' }),
      client('overdue_less', { amlRiskRating: 'standard', amlLastReviewedOn: '2024-06-01' }),
      client('soon', { amlRiskRating: 'high', amlLastReviewedOn: '2025-10-20' }),
      client('fine', { amlRiskRating: 'low', amlLastReviewedOn: '2026-01-01' }),
      client('ceased', { lifecycle: 'ceased' }),
    ];
    const summary = amlSummary(clients, today);
    expect(summary.neverReviewed.map((s) => s.clientId)).toEqual(['never']);
    expect(summary.overdue.map((s) => s.clientId)).toEqual(['overdue_more', 'overdue_less']);
    expect(summary.dueSoon.map((s) => s.clientId)).toEqual(['soon']);
    expect(summary.current).toBe(1);
    expect(summary.total).toBe(5);
  });
});
