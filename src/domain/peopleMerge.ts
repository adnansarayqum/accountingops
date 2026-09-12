import type { IdentityVerificationStatus, Person, PersonRole, PracticeData } from './types';
import { isSamePerson, normalisePersonName } from './personNames';

/**
 * Finding and merging people recorded more than once. Before names were
 * normalised (see personNames.ts), an import and a Companies House refresh
 * could each add "HASAN, Mohammad" and "Mr Mohammad Hasan" as two people
 * with a role each at the same client. Nothing removes those automatically —
 * merging is a visible, confirmable action (Settings → Duplicate people),
 * saved like any other change and undoable from Version history in the
 * shared mode.
 *
 * Conservative on purpose: two records are only ever treated as one person
 * when they hold a role at the same client, their names fold to the same
 * form, and any recorded birth month/year agrees. Two "John Smith"s at
 * different clients with no birth month on file are left alone.
 */

export interface DuplicatePeopleGroup {
  /** The record that stays — every role of the others is moved onto it. */
  keep: Person;
  /** The records removed by a merge, in the order they appear on file. */
  duplicates: Person[];
  /** Clients where members of this group hold roles, in the order the clients appear on file. */
  clientIds: string[];
}

export interface PeopleMergeSummary {
  peopleRemoved: number;
  /** Roles a duplicate held that the kept record didn't — re-pointed at it. */
  rolesMoved: number;
  /** Roles both held at the same client — combined (best status wins) and the duplicate's dropped. */
  rolesCombined: number;
}

const VERIFICATION_RANK: Record<IdentityVerificationStatus, number> = { verified: 3, in_progress: 2, expired: 1, not_started: 0 };
const EVIDENCE_RANK: Record<PersonRole['evidenceStatus'], number> = { checked: 3, received: 2, requested: 1, none: 0 };

function identityOf(person: Person) {
  return { name: person.fullName, birthMonthYear: person.birthMonthYear };
}

/** Which of a group stays: the one with a birth month on file, then the most roles, then the most verification progress, then the earliest on file. */
function chooseKeep(members: Person[], roles: PersonRole[]): Person {
  const score = (p: Person) => {
    const own = roles.filter((r) => r.personId === p.id);
    return [p.birthMonthYear ? 1 : 0, own.length, own.reduce((sum, r) => sum + VERIFICATION_RANK[r.identityVerification], 0)];
  };
  return members.reduce((best, candidate) => {
    const a = score(best);
    const b = score(candidate);
    for (let i = 0; i < a.length; i++) {
      if (b[i] !== a[i]) return b[i] > a[i] ? candidate : best;
    }
    return best;
  });
}

export function findDuplicatePeople(data: Pick<PracticeData, 'people' | 'personRoles' | 'clients'>): DuplicatePeopleGroup[] {
  const byId = new Map(data.people.map((p) => [p.id, p]));
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== undefined && parent.get(root) !== root) root = parent.get(root)!;
    return root;
  };
  const linked = new Set<string>();
  const union = (a: string, b: string) => {
    linked.add(a);
    linked.add(b);
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  };

  const peopleAtClient = new Map<string, Person[]>();
  for (const role of data.personRoles) {
    const person = byId.get(role.personId);
    if (!person) continue;
    const list = peopleAtClient.get(role.clientId) ?? [];
    if (!list.includes(person)) list.push(person);
    peopleAtClient.set(role.clientId, list);
  }
  for (const list of peopleAtClient.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (isSamePerson(identityOf(list[i]), identityOf(list[j]))) union(list[i].id, list[j].id);
      }
    }
  }

  const groups = new Map<string, Person[]>();
  for (const person of data.people) {
    if (!linked.has(person.id)) continue;
    const root = find(person.id);
    groups.set(root, [...(groups.get(root) ?? []), person]);
  }

  const clientOrder = new Map(data.clients.map((c, i) => [c.id, i]));
  const result: DuplicatePeopleGroup[] = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    // "Same name, no birth month" links to both "1980-05" and "1981-02"; those
    // two are different people, so a group with disagreeing birth months is
    // left alone rather than guessed at.
    const months = new Set(members.map((p) => p.birthMonthYear).filter(Boolean));
    if (months.size > 1) continue;
    const keep = chooseKeep(members, data.personRoles);
    const memberIds = new Set(members.map((p) => p.id));
    const clientIds = [...new Set(data.personRoles.filter((r) => memberIds.has(r.personId)).map((r) => r.clientId))].sort(
      (a, b) => (clientOrder.get(a) ?? Infinity) - (clientOrder.get(b) ?? Infinity),
    );
    result.push({ keep, duplicates: members.filter((p) => p !== keep), clientIds });
  }
  return result;
}

/**
 * Merges each group into its kept record, editing `data` in place (the
 * store hands this a draft). Roles the duplicate held that the kept record
 * didn't are re-pointed; roles both held at the same client are combined,
 * keeping the furthest-along verification and evidence status, any
 * personal code captured, and the union of natures of control.
 */
export function applyPeopleMerge(data: Pick<PracticeData, 'people' | 'personRoles'>, groups: DuplicatePeopleGroup[]): PeopleMergeSummary {
  const summary: PeopleMergeSummary = { peopleRemoved: 0, rolesMoved: 0, rolesCombined: 0 };
  for (const group of groups) {
    const keep = data.people.find((p) => p.id === group.keep.id);
    if (!keep) continue;
    for (const duplicate of group.duplicates) {
      const dup = data.people.find((p) => p.id === duplicate.id);
      if (!dup) continue;
      keep.birthMonthYear ??= dup.birthMonthYear;
      keep.dateOfBirth ??= dup.dateOfBirth;
      keep.email ??= dup.email;
      for (const role of data.personRoles.filter((r) => r.personId === dup.id)) {
        const existing = data.personRoles.find((r) => r.personId === keep.id && r.clientId === role.clientId && r.kind === role.kind);
        if (!existing) {
          role.personId = keep.id;
          summary.rolesMoved += 1;
          continue;
        }
        if (VERIFICATION_RANK[role.identityVerification] > VERIFICATION_RANK[existing.identityVerification]) existing.identityVerification = role.identityVerification;
        if (EVIDENCE_RANK[role.evidenceStatus] > EVIDENCE_RANK[existing.evidenceStatus]) existing.evidenceStatus = role.evidenceStatus;
        existing.personalCodeCaptured = existing.personalCodeCaptured || role.personalCodeCaptured;
        existing.companiesHouseVerification ??= role.companiesHouseVerification;
        if (role.naturesOfControl?.length) existing.naturesOfControl = [...new Set([...(existing.naturesOfControl ?? []), ...role.naturesOfControl])];
        data.personRoles.splice(data.personRoles.indexOf(role), 1);
        summary.rolesCombined += 1;
      }
      data.people.splice(data.people.indexOf(dup), 1);
      summary.peopleRemoved += 1;
    }
    keep.fullName = normalisePersonName(keep.fullName);
  }
  return summary;
}
