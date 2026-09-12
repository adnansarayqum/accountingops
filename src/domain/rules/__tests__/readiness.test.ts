import { describe, expect, it } from 'vitest';
import { describeCompaniesHouseVerification, groupRolesByPerson } from '../readiness';
import type { Person, PersonRole, PersonRoleKind } from '../../types';

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

const person = (id: string, fullName: string): Person => ({ id, practiceId: 'p', fullName });
const roleFor = (id: string, personId: string, kind: PersonRoleKind): PersonRole => ({
  id,
  practiceId: 'p',
  personId,
  clientId: 'cl_1',
  kind,
  identityVerification: 'not_started',
  personalCodeCaptured: false,
  evidenceStatus: 'none',
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

describe('groupRolesByPerson', () => {
  it('groups a person holding both roles into one entry, director before PSC regardless of input order', () => {
    const dave = person('p_dave', 'Dave Thompson');
    const groups = groupRolesByPerson([
      { role: roleFor('pr_psc', 'p_dave', 'psc'), person: dave },
      { role: roleFor('pr_dir', 'p_dave', 'director'), person: dave },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].person).toBe(dave);
    expect(groups[0].roles.map((r) => r.id)).toEqual(['pr_dir', 'pr_psc']);
  });

  it('keeps roles for different people in separate groups, ordered by first appearance', () => {
    const dave = person('p_dave', 'Dave Thompson');
    const lisa = person('p_lisa', 'Lisa Thompson');
    const groups = groupRolesByPerson([
      { role: roleFor('pr_2', 'p_lisa', 'director'), person: lisa },
      { role: roleFor('pr_1', 'p_dave', 'director'), person: dave },
    ]);
    expect(groups.map((g) => g.person.id)).toEqual(['p_lisa', 'p_dave']);
  });

  it('is not confused when two roles for the same person are not adjacent — the case a Companies House refresh produces (every director added before any PSC)', () => {
    const dave = person('p_dave', 'Dave Thompson');
    const lisa = person('p_lisa', 'Lisa Thompson');
    const groups = groupRolesByPerson([
      { role: roleFor('pr_dave_dir', 'p_dave', 'director'), person: dave },
      { role: roleFor('pr_lisa_dir', 'p_lisa', 'director'), person: lisa },
      { role: roleFor('pr_dave_psc', 'p_dave', 'psc'), person: dave },
    ]);
    expect(groups).toHaveLength(2);
    const daveGroup = groups.find((g) => g.person.id === 'p_dave')!;
    expect(daveGroup.roles.map((r) => r.id)).toEqual(['pr_dave_dir', 'pr_dave_psc']);
  });

  it('returns an empty list for no entries', () => {
    expect(groupRolesByPerson([])).toEqual([]);
  });
});
