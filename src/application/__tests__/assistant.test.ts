import { describe, expect, it } from 'vitest';
import { buildFixtureData } from '../../testing/fixtures';
import { computeDerived } from '../selectors';
import { routeQuestion } from '../assistant/router';

const today = '2026-09-11';
const data = buildFixtureData(today);
const ctx = { data, derived: computeDerived(data, today), today };

describe('ask the practice', () => {
  it('answers identifier questions with a masked value', () => {
    const r = routeQuestion(ctx, "What's ABC Construction's UTR?");
    expect(r.tool).toBe('get_client_identifier');
    expect(r.answer).toContain('•••••67890');
    expect(r.answer).not.toContain('1234567890');
  });
  it('routes attention questions', () => {
    expect(routeQuestion(ctx, 'What needs my attention today?').tool).toBe('get_attention_queue');
    expect(routeQuestion(ctx, 'Which jobs are at risk?').tool).toBe('get_attention_queue');
  });
  it('routes VAT due this month', () => {
    const r = routeQuestion(ctx, 'Which VAT returns are due this month?');
    expect(r.tool).toBe('get_upcoming_jobs');
    expect(r.rows.every((row) => row.title.includes('VAT'))).toBe(true);
  });
  it('routes missing documents with a filter', () => {
    const r = routeQuestion(ctx, 'Show accounts due within 60 days where bank statements are missing.');
    expect(r.tool).toBe('get_missing_information');
    expect(r.rows.some((row) => row.title.includes('Patel'))).toBe(true);
  });
  it('routes chasing and capacity', () => {
    expect(routeQuestion(ctx, 'Which clients still need chasing this month?').tool).toBe('get_waiting_on_clients');
    expect(routeQuestion(ctx, 'Who is overloaded next week?').tool).toBe('get_capacity');
  });
});
