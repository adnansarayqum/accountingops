import { describe, expect, it } from 'vitest';
import { applyPeopleMerge, findDuplicatePeople } from '../peopleMerge';
import type { Person, PersonRole } from '../types';

const person = (id: string, fullName: string, extra: Partial<Person> = {}): Person => ({ id, practiceId: 'prac', fullName, ...extra });
const role = (id: string, personId: string, clientId: string, kind: PersonRole['kind'] = 'director', extra: Partial<PersonRole> = {}): PersonRole => ({
  id,
  practiceId: 'prac',
  personId,
  clientId,
  kind,
  identityVerification: 'not_started',
  personalCodeCaptured: false,
  evidenceStatus: 'none',
  ...extra,
});
const clients = [{ id: 'cl_a' }, { id: 'cl_b' }] as never;

describe('findDuplicatePeople', () => {
  it('groups name-equivalent people who hold a role at the same client', () => {
    const people = [person('p1', 'HASAN, Mohammad'), person('p2', 'Mr Mohammad Hasan'), person('p3', 'Jane Smith')];
    const personRoles = [role('r1', 'p1', 'cl_a'), role('r2', 'p2', 'cl_a', 'psc'), role('r3', 'p3', 'cl_a')];
    const groups = findDuplicatePeople({ people, personRoles, clients });
    expect(groups).toHaveLength(1);
    expect(groups[0].keep.id).toBe('p1');
    expect(groups[0].duplicates.map((p) => p.id)).toEqual(['p2']);
    expect(groups[0].clientIds).toEqual(['cl_a']);
  });

  it('leaves namesakes at different clients alone', () => {
    const people = [person('p1', 'John Smith'), person('p2', 'John Smith')];
    const personRoles = [role('r1', 'p1', 'cl_a'), role('r2', 'p2', 'cl_b')];
    expect(findDuplicatePeople({ people, personRoles, clients })).toEqual([]);
  });

  it('keeps people with different birth months apart, even at the same client', () => {
    const people = [person('p1', 'John Smith', { birthMonthYear: '1980-05' }), person('p2', 'John Smith', { birthMonthYear: '1981-02' })];
    const personRoles = [role('r1', 'p1', 'cl_a'), role('r2', 'p2', 'cl_a', 'psc')];
    expect(findDuplicatePeople({ people, personRoles, clients })).toEqual([]);
  });

  it('does not guess when an unrecorded birth month links two people who disagree', () => {
    const people = [person('p1', 'John Smith', { birthMonthYear: '1980-05' }), person('p2', 'John Smith'), person('p3', 'John Smith', { birthMonthYear: '1981-02' })];
    const personRoles = [role('r1', 'p1', 'cl_a'), role('r2', 'p2', 'cl_a', 'psc'), role('r3', 'p3', 'cl_a', 'partner')];
    expect(findDuplicatePeople({ people, personRoles, clients })).toEqual([]);
  });

  it('prefers to keep the record with a birth month, then the one with more roles', () => {
    const people = [person('p1', 'Amira Khan'), person('p2', 'KHAN, Amira', { birthMonthYear: '1985-01' })];
    const personRoles = [role('r1', 'p1', 'cl_a'), role('r2', 'p1', 'cl_a', 'psc'), role('r3', 'p2', 'cl_a')];
    expect(findDuplicatePeople({ people, personRoles, clients })[0].keep.id).toBe('p2');

    const noMonths = [person('p1', 'Amira Khan'), person('p2', 'KHAN, Amira')];
    expect(findDuplicatePeople({ people: noMonths, personRoles, clients })[0].keep.id).toBe('p1');
  });

  it('links a group across clients once any client shows they are the same person', () => {
    const people = [person('p1', 'Gareth Brown'), person('p2', 'BROWN, Gareth')];
    const personRoles = [role('r1', 'p1', 'cl_a'), role('r2', 'p2', 'cl_a', 'psc'), role('r3', 'p2', 'cl_b')];
    const [group] = findDuplicatePeople({ people, personRoles, clients });
    expect(group.clientIds).toEqual(['cl_a', 'cl_b']);
  });

  it('ignores roles pointing at a person who is no longer on file', () => {
    const people = [person('p1', 'Jo Hartley')];
    const personRoles = [role('r1', 'p1', 'cl_a'), role('r2', 'p_gone', 'cl_a')];
    expect(findDuplicatePeople({ people, personRoles, clients })).toEqual([]);
  });
});

describe('applyPeopleMerge', () => {
  it('moves roles the kept record lacks, combines those it has, and removes the duplicate', () => {
    const people = [person('p1', 'HASAN, Mohammad'), person('p2', 'Mr Mohammad Hasan', { birthMonthYear: '1979-03', email: 'm@example.com' })];
    const personRoles = [
      role('r1', 'p1', 'cl_a', 'director', { identityVerification: 'in_progress', evidenceStatus: 'requested' }),
      role('r2', 'p2', 'cl_a', 'director', { identityVerification: 'verified', evidenceStatus: 'checked', personalCodeCaptured: true }),
      role('r3', 'p2', 'cl_a', 'psc', { naturesOfControl: ['ownership-of-shares-75-to-100-percent'] }),
      role('r4', 'p2', 'cl_b', 'director'),
    ];
    const data = { people, personRoles };
    const groups = findDuplicatePeople({ ...data, clients });
    expect(groups[0].keep.id).toBe('p2'); // has a birth month and more roles
    const summary = applyPeopleMerge(data, groups);

    expect(summary).toEqual({ peopleRemoved: 1, rolesMoved: 0, rolesCombined: 1 });
    expect(data.people.map((p) => p.id)).toEqual(['p2']);
    expect(data.people[0].fullName).toBe('Mohammad Hasan');
    expect(data.personRoles.map((r) => r.id).sort()).toEqual(['r2', 'r3', 'r4']);
    const director = data.personRoles.find((r) => r.id === 'r2')!;
    expect(director).toMatchObject({ identityVerification: 'verified', evidenceStatus: 'checked', personalCodeCaptured: true });
  });

  it('keeps the furthest-along status when the duplicate was the verified one, and fills in missing details', () => {
    const people = [person('p1', 'Amira Khan', { birthMonthYear: '1985-01' }), person('p2', 'KHAN, Amira', { email: 'amira@example.com', dateOfBirth: '1985-01-22' })];
    const personRoles = [
      role('r1', 'p1', 'cl_a', 'director', { identityVerification: 'not_started', evidenceStatus: 'none' }),
      role('r2', 'p2', 'cl_a', 'director', { identityVerification: 'verified', evidenceStatus: 'checked', personalCodeCaptured: true }),
      role('r3', 'p2', 'cl_a', 'psc', { naturesOfControl: ['voting-rights-75-to-100-percent'] }),
    ];
    const data = { people, personRoles };
    const summary = applyPeopleMerge(data, findDuplicatePeople({ ...data, clients }));
    expect(summary).toEqual({ peopleRemoved: 1, rolesMoved: 1, rolesCombined: 1 });
    expect(data.people).toEqual([{ id: 'p1', practiceId: 'prac', fullName: 'Amira Khan', birthMonthYear: '1985-01', email: 'amira@example.com', dateOfBirth: '1985-01-22' }]);
    expect(data.personRoles.find((r) => r.id === 'r1')).toMatchObject({ identityVerification: 'verified', evidenceStatus: 'checked', personalCodeCaptured: true });
    expect(data.personRoles.find((r) => r.id === 'r3')).toMatchObject({ personId: 'p1', naturesOfControl: ['voting-rights-75-to-100-percent'] });
  });

  it('merges natures of control from both PSC roles', () => {
    const people = [person('p1', 'Tom Greenfield'), person('p2', 'GREENFIELD, Tom')];
    const personRoles = [role('r1', 'p1', 'cl_a', 'psc', { naturesOfControl: ['a'] }), role('r2', 'p2', 'cl_a', 'psc', { naturesOfControl: ['a', 'b'] })];
    const data = { people, personRoles };
    applyPeopleMerge(data, findDuplicatePeople({ ...data, clients }));
    expect(data.personRoles).toHaveLength(1);
    expect(data.personRoles[0].naturesOfControl).toEqual(['a', 'b']);
  });

  it('is a no-op for an empty set of groups', () => {
    const data = { people: [person('p1', 'Solo Person')], personRoles: [role('r1', 'p1', 'cl_a')] };
    expect(applyPeopleMerge(data, [])).toEqual({ peopleRemoved: 0, rolesMoved: 0, rolesCombined: 0 });
    expect(data.people).toHaveLength(1);
  });
});
