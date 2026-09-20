/**
 * Checks a snapshot write makes against what is already stored, for the
 * parts of PracticeData that are not ordinary work.
 *
 * The whole practice is one JSON document the browser sends back in full, so
 * "who may change the practice's settings or the team roster" cannot be a
 * route-level rule — it is a question about what differs between the stored
 * snapshot and the one arriving. These helpers answer it; routes/practiceData
 * turns the answers into a 403 (or into audit records when the write is
 * allowed).
 *
 * Only `practice` and `users` are protected. Everything else in the snapshot
 * (clients, jobs, communications…) is the daily work every role does.
 * `reminderSequences` is deliberately not protected: nothing in the app
 * edits it, and older snapshots get their defaults filled in by the client's
 * normaliser, so guarding it would refuse ordinary saves from an accountant
 * for changes they did not make.
 */
import { PERMISSIONS } from './authorization.mjs';

/** Stable JSON: keys sorted, undefined dropped — so key order and absent-vs-undefined never read as a change. */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .filter((k) => value[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

const same = (a, b) => canonical(a) === canonical(b);

/** A practice that never touched Settings → Timing thresholds has no `thresholds` at all, or an empty one; those are the same practice. */
function normalisedPractice(practice) {
  const { thresholds, ...rest } = practice ?? {};
  const cleaned = Object.fromEntries(Object.entries(thresholds ?? {}).filter(([, v]) => v !== undefined && v !== null));
  return Object.keys(cleaned).length > 0 ? { ...rest, thresholds: cleaned } : rest;
}

/** The fields of a team member any signed-in user may correct on their own row: how they are shown, nothing that grants anything. */
const SELF_EDITABLE_USER_FIELDS = ['name', 'initials'];

/**
 * What the write changes that needs more than ordinary access.
 * Returns `{ practice, team }` — each null when untouched, otherwise a
 * summary safe to put in the audit trail (ids, field names and role values;
 * never names or other personal details).
 *
 * `actorId` is the signed-in user, who may always fix how they themselves
 * are displayed.
 */
export function protectedChanges(stored, next, actorId) {
  const result = { practice: null, team: null };

  const before = normalisedPractice(stored?.practice);
  const after = normalisedPractice(next?.practice);
  if (!same(before, after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => !same(before[k], after[k])).sort();
    result.practice = { fields: keys };
  }

  const storedUsers = new Map((stored?.users ?? []).map((u) => [u.id, u]));
  const nextUsers = new Map((next?.users ?? []).map((u) => [u.id, u]));
  const added = [...nextUsers.keys()].filter((id) => !storedUsers.has(id));
  const removed = [...storedUsers.keys()].filter((id) => !nextUsers.has(id));
  const roleChanges = [];
  const rosterChanges = []; // changes only team.manage may make
  const displayChanges = []; // name/initials on someone else's row → also team.manage
  for (const [id, was] of storedUsers) {
    const now = nextUsers.get(id);
    if (!now) continue;
    if (was.role !== now.role) roleChanges.push({ userId: id, from: was.role, to: now.role });
    const changedFields = [...new Set([...Object.keys(was), ...Object.keys(now)])].filter((k) => !same(was[k], now[k]));
    const beyondSelf = changedFields.filter((k) => !SELF_EDITABLE_USER_FIELDS.includes(k));
    const selfOnly = changedFields.filter((k) => SELF_EDITABLE_USER_FIELDS.includes(k));
    if (beyondSelf.length > 0) rosterChanges.push({ userId: id, fields: beyondSelf.sort() });
    if (selfOnly.length > 0 && id !== actorId) displayChanges.push({ userId: id, fields: selfOnly.sort() });
  }
  if (added.length + removed.length + roleChanges.length + rosterChanges.length + displayChanges.length > 0) {
    result.team = { added, removed, roleChanges, rosterChanges, displayChanges };
  }
  return result;
}

/** The permissions a set of protected changes demands, each with what triggered it. */
export function requiredPermissions(changes) {
  const needed = [];
  if (changes.practice) needed.push({ permission: PERMISSIONS.PRACTICE_CONFIGURE, reason: 'practice_settings_changed', detail: changes.practice });
  if (changes.team) needed.push({ permission: PERMISSIONS.TEAM_MANAGE, reason: 'team_changed', detail: changes.team });
  return needed;
}

/**
 * The browser writes PracticeData.auditEvents, so nothing in them is
 * evidence — but a write must not be allowed to *pose* as the server. New
 * events (ids not already stored) must claim source 'ui'; 'system' and 'api'
 * are what server-originated records would say, and only the server may say
 * them. Removals and actor mismatches are not refused (retention trims old
 * events and a rebase replays others') but are counted so the authoritative
 * trail shows them.
 */
export function inspectClientAuditEvents(stored, next, actorId) {
  const storedIds = new Set((stored?.auditEvents ?? []).map((e) => e.id));
  const nextEvents = Array.isArray(next?.auditEvents) ? next.auditEvents : [];
  const nextIds = new Set(nextEvents.map((e) => e.id));
  const fresh = nextEvents.filter((e) => !storedIds.has(e.id));
  return {
    added: fresh.length,
    removed: [...storedIds].filter((id) => !nextIds.has(id)).length,
    forgedSource: fresh.filter((e) => e.source !== 'ui').map((e) => e.id),
    actorMismatch: fresh.filter((e) => e.actorUserId !== undefined && e.actorUserId !== null && e.actorUserId !== actorId).length,
  };
}
