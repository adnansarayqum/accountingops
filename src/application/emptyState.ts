import { buildReminderSequences } from '../domain/catalog';
import type { PracticeData, User } from '../domain/types';

export const PRACTICE_ID = 'prac_main';
export const OWNER_USER_ID = 'u_owner';

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

/**
 * The state a brand-new practice starts in: one signed-in owner, no
 * clients, jobs, or history yet. Every list is genuinely empty — there is
 * no seeded/synthetic data. `reminderSequences` is reference configuration
 * (chasing-sequence templates), not client data, so it's populated from
 * day one.
 */
export function buildEmptyPracticeData(ownerName = 'Adnan Sarayqum'): PracticeData {
  const owner: User = {
    id: OWNER_USER_ID,
    practiceId: PRACTICE_ID,
    name: ownerName,
    initials: initialsOf(ownerName),
    role: 'owner',
    weeklyCapacityHours: 40,
    colour: 'blue',
  };

  return {
    practice: { id: PRACTICE_ID, name: 'Farhan & Raihan', timezone: 'Europe/London' },
    users: [owner],
    clients: [],
    contacts: [],
    identifiers: [],
    people: [],
    personRoles: [],
    subscriptions: [],
    obligations: [],
    jobs: [],
    requestItems: [],
    documents: [],
    communications: [],
    reminderSequences: buildReminderSequences(PRACTICE_ID),
    approvals: [],
    filings: [],
    activities: [],
    auditEvents: [],
    inboxItems: [],
    notifications: [],
    onboardingCases: [],
    mtdReadiness: [],
  };
}
