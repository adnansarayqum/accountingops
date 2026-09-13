import { buildReminderSequences } from '../domain/catalog';
import type { PracticeData, User } from '../domain/types';

export const PRACTICE_ID = 'prac_main';

// These ids are shared with the server's seeded login accounts
// (server/lib/bootstrapUsers.mjs) — once a real session exists, the
// signed-in user's id must resolve to one of these team members.
export const OWNER_USER_ID = 'u_adnan';
export const FARHAN_USER_ID = 'u_farhan';
export const RAYHAN_USER_ID = 'u_rayhan';

const TEAM: User[] = [
  { id: OWNER_USER_ID, practiceId: PRACTICE_ID, name: 'Adnan Sarayqum', initials: 'AS', role: 'owner', weeklyCapacityHours: 40, colour: 'blue' },
  { id: FARHAN_USER_ID, practiceId: PRACTICE_ID, name: 'Farhan', initials: 'F', role: 'owner', weeklyCapacityHours: 40, colour: 'violet' },
  { id: RAYHAN_USER_ID, practiceId: PRACTICE_ID, name: 'Raihan', initials: 'R', role: 'owner', weeklyCapacityHours: 40, colour: 'emerald' },
];

/**
 * The state a brand-new practice starts in: the team (no clients, jobs, or
 * history yet — every list is genuinely empty, no seeded/synthetic data).
 * `reminderSequences` is reference configuration (chasing-sequence
 * templates), not client data, so it's populated from day one.
 */
export function buildEmptyPracticeData(): PracticeData {
  return {
    practice: { id: PRACTICE_ID, name: 'Farhan & Raihan', timezone: 'Europe/London' },
    users: TEAM,
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
    wipEntries: [],
    timeEntries: [],
  };
}
