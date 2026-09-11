import { describe, expect, it } from 'vitest';
import { canTransition, suggestedTransitionOnCompleteness } from '../transitions';
import type { Job } from '../../types';

const base: Job = { id: 'j', practiceId: 'p', clientId: 'c', serviceCode: 'vat', name: 'VAT', periodKey: '2026-Q3', periodStart: '', periodEnd: '', dueDate: '2026-10-01', status: 'waiting_for_records', waitingOn: 'client', estimatedHours: 2, statusChangedAt: '', createdAt: '' };

describe('job transitions', () => {
  it('allows the standard forward path', () => {
    expect(canTransition('waiting_for_records', 'ready_to_start')).toBe(true);
    expect(canTransition('ready_to_start', 'in_progress')).toBe(true);
    expect(canTransition('in_progress', 'internal_review')).toBe(true);
    expect(canTransition('internal_review', 'waiting_client_approval')).toBe(true);
    expect(canTransition('waiting_client_approval', 'ready_to_file')).toBe(true);
    expect(canTransition('ready_to_file', 'filed')).toBe(true);
  });
  it('blocks impossible states', () => {
    expect(canTransition('waiting_for_records', 'filed')).toBe(false);
    expect(canTransition('filed', 'in_progress')).toBe(false);
    expect(canTransition('ready_to_start', 'ready_to_file')).toBe(false);
  });
  it('suggests ready_to_start when records become complete', () => {
    expect(suggestedTransitionOnCompleteness(base, { total: 2, received: 2, missing: [], requested: [], percent: 100, complete: true })).toBe('ready_to_start');
  });
  it('does not suggest anything when still incomplete or already in progress', () => {
    expect(suggestedTransitionOnCompleteness(base, { total: 2, received: 1, missing: [], requested: [], percent: 50, complete: false })).toBeNull();
    expect(suggestedTransitionOnCompleteness({ ...base, status: 'in_progress' }, { total: 2, received: 2, missing: [], requested: [], percent: 100, complete: true })).toBeNull();
  });
});
