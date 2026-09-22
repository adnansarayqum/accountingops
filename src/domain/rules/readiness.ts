import type { Client, MtdReadiness, MtdStatus, Person, PersonRole, PersonRoleKind } from '../types';
import { formatDate } from '../dates';

export interface MtdEvaluation {
  status: MtdStatus;
  reasons: string[];
  required: boolean;
}

/**
 * MTD for Income Tax: mandation is phased by qualifying income. Bands map to
 * illustrative start years; the rule is transparent and easy to replace with HMRC's
 * actual thresholds.
 */
export function evaluateMtd(r: MtdReadiness): MtdEvaluation {
  const required = r.incomeBand !== 'under_20k';
  if (!required) return { status: 'not_yet_required', reasons: ['Qualifying income is below the current threshold.'], required };
  const reasons: string[] = [];
  if (!r.signedUp) reasons.push('Not yet signed up for MTD.');
  if (!r.softwareReady) reasons.push('No MTD-compatible software confirmed.');
  if (!r.agentAuthorised) reasons.push('Agent authorisation not in place.');
  if (reasons.length === 0) return { status: 'ready', reasons: ['Signed up, software confirmed and agent authorised.'], required };
  if (reasons.length >= 2) return { status: 'action_needed', reasons, required };
  return { status: 'review', reasons, required };
}

export type IdentityReadinessStatus = 'ready' | 'blocked' | 'in_progress';

export interface IdentityReadiness {
  client: Client;
  roles: { role: PersonRole; person: Person }[];
  verified: number;
  total: number;
  status: IdentityReadinessStatus;
  confirmationStatementBlocked: boolean;
}

export function evaluateIdentityReadiness(client: Client, roles: PersonRole[], people: Person[]): IdentityReadiness {
  const own = roles
    .filter((r) => r.clientId === client.id)
    .map((role) => ({ role, person: people.find((p) => p.id === role.personId)! }))
    .filter((x) => x.person);
  const verified = own.filter((x) => x.role.identityVerification === 'verified').length;
  const anyInProgress = own.some((x) => x.role.identityVerification === 'in_progress');
  const status: IdentityReadinessStatus = verified === own.length ? 'ready' : anyInProgress && verified + own.filter((x) => x.role.identityVerification === 'in_progress').length === own.length ? 'in_progress' : 'blocked';
  return { client, roles: own, verified, total: own.length, status, confirmationStatementBlocked: verified < own.length };
}

/**
 * One line on what Companies House itself says about a role's identity
 * verification, as of the last refresh — so "still needs verification"
 * can be read against the register rather than guessed at. Null before
 * any refresh has looked.
 */
export interface PersonRoleGroup {
  person: Person;
  roles: PersonRole[];
}

const ROLE_KIND_ORDER: Record<PersonRoleKind, number> = { director: 0, psc: 1, partner: 2, proprietor: 3 };

/**
 * Groups a client's roles by the person holding them. Without this, a
 * person who is both a director and a PSC shows up as two separate,
 * identically-named entries — and a Companies House refresh adds every
 * director before any PSC, so the two need not even be adjacent — easy to
 * read the first one ("verified") and miss that the second ("PSC") still
 * needs it. Each group's roles are ordered director-then-PSC-then-others;
 * groups are ordered by the person's first appearance in `entries`.
 */
export function groupRolesByPerson(entries: { role: PersonRole; person: Person }[]): PersonRoleGroup[] {
  const order: string[] = [];
  const groups = new Map<string, PersonRoleGroup>();
  for (const { role, person } of entries) {
    let group = groups.get(person.id);
    if (!group) {
      group = { person, roles: [] };
      groups.set(person.id, group);
      order.push(person.id);
    }
    group.roles.push(role);
  }
  for (const id of order) groups.get(id)!.roles.sort((a, b) => ROLE_KIND_ORDER[a.kind] - ROLE_KIND_ORDER[b.kind]);
  return order.map((id) => groups.get(id)!);
}

export function describeCompaniesHouseVerification(role: PersonRole, timeZone?: string): string | null {
  const seen = role.companiesHouseVerification;
  if (!seen) return null;
  if (seen.verifiedOn) return `Companies House: verified ${formatDate(seen.verifiedOn, { year: true })}`;
  if (seen.dueOn) return `Companies House: verification statement due by ${formatDate(seen.dueOn, { year: true })}`;
  return `Companies House: nothing published yet (checked ${formatDate(seen.checkedAt, { timeZone })})`;
}
