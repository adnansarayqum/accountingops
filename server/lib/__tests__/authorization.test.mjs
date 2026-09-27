import { describe, expect, it } from 'vitest';
import { PERMISSIONS, ROLE_PERMISSIONS, can, permissionsFor } from '../authorization.mjs';
import { inspectClientAuditEvents, protectedChanges, requiredPermissions } from '../snapshotGuards.mjs';
import { buildFixtureData } from '../../../src/testing/fixtures';

const clone = (value) => structuredClone(value);
const base = () => clone(buildFixtureData('2026-09-11'));

describe('permissions matrix', () => {
  const P = PERMISSIONS;

  // Kept as a literal table on purpose: this is the documented matrix
  // (docs/PERMISSIONS.md). Changing who may do what must change this too.
  const MATRIX = {
    [P.DATA_READ]: { owner: true, manager: true, accountant: true, admin: true },
    [P.DATA_WRITE]: { owner: true, manager: true, accountant: true, admin: true },
    [P.HISTORY_READ]: { owner: true, manager: true, accountant: true, admin: true },
    [P.MESSAGES_SEND]: { owner: true, manager: true, accountant: true, admin: true },
    [P.HMRC_READ]: { owner: true, manager: true, accountant: true, admin: true },
    [P.PRACTICE_CONFIGURE]: { owner: true, manager: true, accountant: false, admin: false },
    [P.SNAPSHOT_RESTORE]: { owner: true, manager: false, accountant: false, admin: false },
    [P.HMRC_CONNECT]: { owner: true, manager: false, accountant: false, admin: false },
    [P.TEAM_MANAGE]: { owner: true, manager: false, accountant: false, admin: false },
    [P.AUDIT_READ]: { owner: true, manager: false, accountant: false, admin: false },
  };

  it('covers every permission that exists — a new one cannot be added without deciding who holds it', () => {
    expect(Object.keys(MATRIX).sort()).toEqual(Object.values(P).sort());
  });

  for (const [permission, roles] of Object.entries(MATRIX)) {
    for (const [role, allowed] of Object.entries(roles)) {
      it(`${role} ${allowed ? 'holds' : 'lacks'} ${permission}`, () => {
        expect(can(role, permission)).toBe(allowed);
      });
    }
  }

  it('fails closed: an unknown role, a missing role and an unknown permission are all denied', () => {
    for (const role of ['intern', 'OWNER', '', undefined, null, 'constructor', '__proto__', 'toString']) {
      for (const permission of Object.values(P)) expect(can(role, permission), `${String(role)} / ${permission}`).toBe(false);
      expect(permissionsFor(role)).toEqual([]);
    }
    expect(can('owner', 'nuclear.launch')).toBe(false);
    expect(can('owner', undefined)).toBe(false);
  });

  it('never grants a non-owner the practice-wide destructive tier', () => {
    for (const role of ['manager', 'accountant', 'admin']) {
      for (const permission of [P.SNAPSHOT_RESTORE, P.HMRC_CONNECT, P.TEAM_MANAGE, P.AUDIT_READ]) expect(can(role, permission)).toBe(false);
    }
  });

  it('exposes a copy, so a caller cannot widen the matrix by mutating what permissionsFor returns', () => {
    const mine = permissionsFor('accountant');
    mine.push(P.SNAPSHOT_RESTORE);
    expect(can('accountant', P.SNAPSHOT_RESTORE)).toBe(false);
    expect(Object.isFrozen(ROLE_PERMISSIONS.owner)).toBe(true);
  });
});

describe('protectedChanges — what a snapshot write changes beyond ordinary work', () => {
  it('sees nothing in an ordinary save: clients, jobs and communications change freely', () => {
    const stored = base();
    const next = base();
    next.clients[0].name = 'Renamed Client Ltd';
    next.jobs[0].status = 'in_progress';
    next.communications.push({ id: 'comm_new', practiceId: stored.practice.id, clientId: next.clients[0].id, direction: 'outbound', channel: 'email', recipient: 'a@b.co', body: 'hi', sentAt: '2026-09-11T10:00:00.000Z', responseStatus: 'awaiting', simulated: true });
    const changes = protectedChanges(stored, next, 'u_sarah');
    expect(changes).toEqual({ practice: null, team: null });
    expect(requiredPermissions(changes)).toEqual([]);
  });

  it('is unmoved by key order and by an absent-versus-empty thresholds object', () => {
    const stored = base();
    delete stored.practice.thresholds;
    const next = base();
    next.practice = Object.fromEntries(Object.entries(next.practice).reverse());
    next.practice.thresholds = {};
    expect(protectedChanges(stored, next, 'u_sarah')).toEqual({ practice: null, team: null });
  });

  it('flags a change to timing thresholds or practice details as practice.configure', () => {
    const stored = base();
    const next = base();
    next.practice.thresholds = { dueSoonDays: 30 };
    next.practice.name = 'Somebody Else Ltd';
    const changes = protectedChanges(stored, next, 'u_sarah');
    expect(changes.practice).toEqual({ fields: ['name', 'thresholds'] });
    expect(requiredPermissions(changes).map((n) => n.permission)).toEqual([PERMISSIONS.PRACTICE_CONFIGURE]);
  });

  it('flags a role change, an added member and a removed member as team.manage, and reports roles but not names', () => {
    const stored = base();
    const next = base();
    const [first, second] = next.users;
    first.role = first.role === 'owner' ? 'accountant' : 'owner';
    next.users = next.users.filter((u) => u.id !== second.id);
    next.users.push({ id: 'u_new', practiceId: stored.practice.id, name: 'Newcomer', initials: 'N', role: 'owner', weeklyCapacityHours: 40, colour: 'blue' });
    const changes = protectedChanges(stored, next, first.id);
    expect(changes.team.added).toEqual(['u_new']);
    expect(changes.team.removed).toEqual([second.id]);
    expect(changes.team.roleChanges).toEqual([{ userId: first.id, from: stored.users[0].role, to: first.role }]);
    expect(JSON.stringify(changes)).not.toContain('Newcomer');
    expect(requiredPermissions(changes).map((n) => n.permission)).toEqual([PERMISSIONS.TEAM_MANAGE]);
  });

  it("treats a member's capacity or colour as roster data, not something they may edit about themselves", () => {
    const stored = base();
    const next = base();
    next.users[0].weeklyCapacityHours += 10;
    const changes = protectedChanges(stored, next, next.users[0].id);
    expect(changes.team.rosterChanges).toEqual([{ userId: next.users[0].id, fields: ['weeklyCapacityHours'] }]);
    expect(requiredPermissions(changes).map((n) => n.permission)).toEqual([PERMISSIONS.TEAM_MANAGE]);
  });

  it('lets anyone correct how THEY are shown, but not how someone else is', () => {
    const stored = base();
    const mine = base();
    mine.users[0].name = 'My Corrected Name';
    mine.users[0].initials = 'MC';
    expect(protectedChanges(stored, mine, mine.users[0].id)).toEqual({ practice: null, team: null });

    const theirs = base();
    theirs.users[1].name = 'Someone Elses Name';
    const changes = protectedChanges(stored, theirs, theirs.users[0].id);
    expect(changes.team.displayChanges).toEqual([{ userId: theirs.users[1].id, fields: ['name'] }]);
    expect(requiredPermissions(changes).map((n) => n.permission)).toEqual([PERMISSIONS.TEAM_MANAGE]);
  });

  it('does not let a self-edit smuggle a role change through: the role is judged separately', () => {
    const stored = base();
    const next = base();
    next.users[0].name = 'Fine';
    next.users[0].role = 'owner';
    stored.users[0].role = 'accountant';
    const changes = protectedChanges(stored, next, next.users[0].id);
    expect(changes.team.roleChanges).toHaveLength(1);
    expect(requiredPermissions(changes).map((n) => n.permission)).toContain(PERMISSIONS.TEAM_MANAGE);
  });
});

describe('inspectClientAuditEvents — client-written audit events are reported, never trusted', () => {
  const event = (over = {}) => ({ id: 'aud_a', practiceId: 'prac_main', actorUserId: 'u_sarah', action: 'job.transition', entityType: 'job', entityId: 'j1', occurredAt: '2026-09-11T10:00:00.000Z', source: 'ui', correlationId: 'c', ...over });

  it('counts new events, ignores ones already stored, and flags any claiming to be the server', () => {
    const stored = { auditEvents: [event({ id: 'aud_old' })] };
    const next = { auditEvents: [event({ id: 'aud_old' }), event({ id: 'aud_new1' }), event({ id: 'aud_new2', source: 'system' }), event({ id: 'aud_new3', source: 'api' })] };
    const result = inspectClientAuditEvents(stored, next, 'u_sarah');
    expect(result.added).toBe(3);
    expect(result.forgedSource).toEqual(['aud_new2', 'aud_new3']);
  });

  it('does not accuse events that were already on file, even if they say "system"', () => {
    const stored = { auditEvents: [event({ id: 'aud_legacy', source: 'system' })] };
    expect(inspectClientAuditEvents(stored, stored, 'u_sarah').forgedSource).toEqual([]);
  });

  it('counts removals and events attributed to someone other than the signed-in user', () => {
    const stored = { auditEvents: [event({ id: 'aud_1' }), event({ id: 'aud_2' })] };
    const next = { auditEvents: [event({ id: 'aud_1' }), event({ id: 'aud_3', actorUserId: 'u_farhan' })] };
    const result = inspectClientAuditEvents(stored, next, 'u_sarah');
    expect(result.removed).toBe(1);
    expect(result.actorMismatch).toBe(1);
  });

  it('treats a first-ever write as all-new', () => {
    const result = inspectClientAuditEvents(null, { auditEvents: [event({ source: 'system' })] }, 'u_sarah');
    expect(result.added).toBe(1);
    expect(result.forgedSource).toHaveLength(1);
  });
});
