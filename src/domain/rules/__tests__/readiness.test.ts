import { describe, expect, it } from 'vitest';
import { describeCompaniesHouseVerification } from '../readiness';
import type { PersonRole } from '../../types';

const role = (companiesHouseVerification?: PersonRole['companiesHouseVerification']): PersonRole => ({
  id: 'pr_1',
  practiceId: 'p',
  personId: 'p_1',
  clientId: 'cl_1',
  kind: 'director',
  identityVerification: 'not_started',
  personalCodeCaptured: false,
  evidenceStatus: 'none',
  companiesHouseVerification,
});

describe('describeCompaniesHouseVerification', () => {
  it('says nothing before any refresh has looked', () => {
    expect(describeCompaniesHouseVerification(role())).toBeNull();
  });

  it('reports a verification date, a statement due date, or that nothing is published', () => {
    expect(describeCompaniesHouseVerification(role({ checkedAt: '2026-09-11T08:00:00Z', verifiedOn: '2026-03-04', dueOn: null }))).toBe('Companies House: verified 4 Mar 2026');
    expect(describeCompaniesHouseVerification(role({ checkedAt: '2026-09-11T08:00:00Z', verifiedOn: null, dueOn: '2026-09-28' }))).toBe('Companies House: verification statement due by 28 Sep 2026');
    expect(describeCompaniesHouseVerification(role({ checkedAt: '2026-09-11T08:00:00Z', verifiedOn: null, dueOn: null }))).toBe('Companies House: nothing published yet (checked 11 Sep 2026)');
  });

  it('prefers the verification over a due date when both are present', () => {
    expect(describeCompaniesHouseVerification(role({ checkedAt: '2026-09-11T08:00:00Z', verifiedOn: '2026-03-04', dueOn: '2026-09-28' }))).toBe('Companies House: verified 4 Mar 2026');
  });
});
