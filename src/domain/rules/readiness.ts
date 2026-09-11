import type { Client, MtdReadiness, MtdStatus, Person, PersonRole } from '../types';

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
