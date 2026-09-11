import { describe, expect, it } from 'vitest';
import { computeCompleteness } from '../completeness';
import type { InformationRequestItem } from '../../types';

const item = (label: string, status: InformationRequestItem['status'], required = true): InformationRequestItem => ({
  id: label,
  practiceId: 'p',
  jobId: 'j',
  clientId: 'c',
  label,
  documentType: label,
  status,
  required,
});

describe('computeCompleteness', () => {
  it('counts only required items', () => {
    const c = computeCompleteness([item('a', 'received'), item('b', 'missing'), item('c', 'missing', false)]);
    expect(c.total).toBe(2);
    expect(c.received).toBe(1);
    expect(c.percent).toBe(50);
    expect(c.complete).toBe(false);
    expect(c.missing.map((m) => m.label)).toEqual(['b']);
  });

  it('treats requested as still outstanding', () => {
    const c = computeCompleteness([item('a', 'requested')]);
    expect(c.percent).toBe(0);
    expect(c.requested).toHaveLength(1);
  });

  it('is complete when everything required is received', () => {
    const c = computeCompleteness([item('a', 'received'), item('b', 'received')]);
    expect(c.complete).toBe(true);
    expect(c.percent).toBe(100);
  });

  it('is complete with no requirements', () => {
    expect(computeCompleteness([]).complete).toBe(true);
  });

  it('rounds 4 of 6 to 67%', () => {
    const c = computeCompleteness([item('a', 'received'), item('b', 'received'), item('c', 'received'), item('d', 'received'), item('e', 'missing'), item('f', 'missing')]);
    expect(c.percent).toBe(67);
  });
});
