import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ENUMS, validateSnapshotSchema } from '../snapshotSchema.mjs';
import { validatePracticeData } from '../practiceDataShape.mjs';
import { buildFixtureData } from '../../../src/testing/fixtures';
import { buildEmptyPracticeData } from '../../../src/application/emptyState';

const clone = (value) => structuredClone(value);
const fixture = () => clone(buildFixtureData('2026-09-11'));

/** The TypeScript domain model is the source of truth for the shape; read it as text so drift is a test failure, not a production 400. */
const TYPES_SOURCE = readFileSync(path.resolve(process.cwd(), 'src/domain/types.ts'), 'utf8');

function literals(unionText) {
  return [...unionText.matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

/** `export type Name = 'a' | 'b' ...;` */
function namedUnion(name) {
  const match = TYPES_SOURCE.match(new RegExp(`export type ${name}\\s*=\\s*([^;]+);`));
  if (!match) throw new Error(`type ${name} not found in types.ts`);
  return literals(match[1]);
}

/** `field: 'a' | 'b';` inside `export interface Name { ... }` */
function inlineUnion(interfaceName, field) {
  const block = TYPES_SOURCE.match(new RegExp(`export interface ${interfaceName}\\b[^{]*\\{([\\s\\S]*?)\\n\\}`));
  if (!block) throw new Error(`interface ${interfaceName} not found in types.ts`);
  const line = block[1].match(new RegExp(`\\n\\s*${field}\\??:\\s*([^;]+);`));
  if (!line) throw new Error(`${interfaceName}.${field} not found in types.ts`);
  return literals(line[1]);
}

describe('the server enumerations match the domain types', () => {
  const named = {
    userRole: 'UserRole',
    clientType: 'ClientType',
    clientLifecycle: 'ClientLifecycle',
    amlRiskRating: 'AmlRiskRating',
    channel: 'Channel',
    identifierKind: 'IdentifierKind',
    personRoleKind: 'PersonRoleKind',
    identityVerificationStatus: 'IdentityVerificationStatus',
    serviceCode: 'ServiceCode',
    jobStatus: 'JobStatus',
    waitingOn: 'WaitingOn',
    requestItemStatus: 'RequestItemStatus',
    communicationDirection: 'CommunicationDirection',
    approvalKind: 'ApprovalKind',
  };
  for (const [key, typeName] of Object.entries(named)) {
    it(`${key} = ${typeName}`, () => {
      expect([...ENUMS[key]].sort()).toEqual(namedUnion(typeName).sort());
    });
  }

  const inline = {
    approvalStatus: ['Approval', 'status'],
    auditSource: ['AuditEvent', 'source'],
    deliveryStatus: ['Communication', 'deliveryStatus'],
    filingDestination: ['FilingRecord', 'destination'],
    filingEvidenceStatus: ['FilingRecord', 'evidenceStatus'],
    wipStatus: ['WipEntry', 'status'],
  };
  for (const [key, [iface, field]] of Object.entries(inline)) {
    it(`${key} = ${iface}.${field}`, () => {
      expect([...ENUMS[key]].sort()).toEqual(inlineUnion(iface, field).sort());
    });
  }
});

describe('validateSnapshotSchema — data the app really produces is accepted', () => {
  it('accepts the full test fixture, every collection populated', () => {
    expect(validateSnapshotSchema(fixture())).toBeNull();
    expect(validatePracticeData(fixture())).toBeNull();
  });

  it("accepts a brand-new practice exactly as the client's empty state builds it", () => {
    expect(validatePracticeData(clone(buildEmptyPracticeData()))).toBeNull();
  });

  it('accepts a snapshot from before newer collections existed', () => {
    const { wipEntries: _w, timeEntries: _t, ...older } = fixture();
    expect(validatePracticeData(older)).toBeNull();
  });

  it('keeps fields it has no rule for, and treats null like absent on optional fields', () => {
    const data = fixture();
    data.clients[0].someFieldFromANewerClient = { nested: true };
    data.clients[0].amlRiskRating = null;
    data.jobs[0].assigneeUserId = null;
    expect(validatePracticeData(data)).toBeNull();
  });

  it('accepts partial timing thresholds, and none at all', () => {
    const data = fixture();
    data.practice.thresholds = { dueSoonDays: 21 };
    expect(validatePracticeData(data)).toBeNull();
    delete data.practice.thresholds;
    expect(validatePracticeData(data)).toBeNull();
  });
});

describe('validateSnapshotSchema — critical structures are enforced', () => {
  /** Applies `edit` to a fresh fixture and returns the reason the schema gives. */
  const reasonFor = (edit) => {
    const data = fixture();
    edit(data);
    return validateSnapshotSchema(data);
  };

  it.each([
    ['a team member with an unknown role', (d) => (d.users[0].role = 'superuser'), 'users[0].role_invalid'],
    ['a team member with no role at all', (d) => delete d.users[0].role, 'users[0].role_missing'],
    ['a team member with no id', (d) => (d.users[1].id = ''), 'users[1].id_invalid'],
    ['negative weekly capacity', (d) => (d.users[0].weeklyCapacityHours = -5), 'users[0].weeklyCapacityHours_invalid'],
    ['two team members with one id', (d) => (d.users[1].id = d.users[0].id), 'users_duplicate_id'],
    ['a job in a status the app has never had', (d) => (d.jobs[2].status = 'approved'), 'jobs[2].status_invalid'],
    ['a job waiting on something unknown', (d) => (d.jobs[0].waitingOn = 'the_moon'), 'jobs[0].waitingOn_invalid'],
    ['a job with no client', (d) => delete d.jobs[0].clientId, 'jobs[0].clientId_missing'],
    ['an impossible due date', (d) => (d.jobs[0].dueDate = '2026-02-31'), 'jobs[0].dueDate_invalid'],
    ['a due date that is not a date', (d) => (d.jobs[0].dueDate = 'next Tuesday'), 'jobs[0].dueDate_invalid'],
    ['negative estimated hours', (d) => (d.jobs[0].estimatedHours = -1), 'jobs[0].estimatedHours_invalid'],
    ['non-finite estimated hours', (d) => (d.jobs[0].estimatedHours = Number.POSITIVE_INFINITY), 'jobs[0].estimatedHours_invalid'],
    ['a client with an unknown lifecycle', (d) => (d.clients[0].lifecycle = 'archived'), 'clients[0].lifecycle_invalid'],
    ['a client whose name is not a string', (d) => (d.clients[0].name = 42), 'clients[0].name_invalid'],
    ['an identifier of unknown kind', (d) => (d.identifiers[0].kind = 'passport'), 'identifiers[0].kind_invalid'],
    ['a communication on an unknown channel', (d) => (d.communications[0].channel = 'carrier_pigeon'), 'communications[0].channel_invalid'],
    ['an approval with an unknown status', (d) => (d.approvals[0].status = 'maybe'), 'approvals[0].status_invalid'],
    ['a scalar where a collection row belongs', (d) => (d.documents = ['not a row']), 'documents[0].not_an_object'],
    ['a row with no id in an unruled collection', (d) => (d.people = [{ fullName: 'No Id' }]), 'people[0].id_missing'],
    ['a practice with no name', (d) => (d.practice.name = ''), 'practice.name_invalid'],
    ['a practice in a timezone that does not exist', (d) => (d.practice.timezone = 'Mars/Olympus'), 'practice.timezone_invalid'],
    ['a negative threshold', (d) => (d.practice.thresholds = { dueSoonDays: -3 }), 'practice.thresholds_invalid'],
    ['thresholds that are not an object', (d) => (d.practice.thresholds = 14), 'practice.thresholds_invalid'],
  ])('refuses %s', (_label, edit, expected) => {
    expect(reasonFor(edit)).toBe(expected);
  });

  it('reasons name the field and never echo the value', () => {
    const reason = reasonFor((d) => (d.users[0].role = 'SECRET-VALUE-XYZ'));
    expect(reason).toBe('users[0].role_invalid');
    expect(reason).not.toContain('SECRET');
  });

  it('refuses an audit event with no source, an unknown source, or a bad timestamp', () => {
    const event = { id: 'aud_1', practiceId: 'prac_main', action: 'x.y', entityType: 'client', entityId: 'c1', occurredAt: '2026-09-11T10:00:00.000Z', source: 'ui', correlationId: 'corr' };
    const withEvent = (patch) => {
      const d = fixture();
      d.auditEvents = [{ ...event, ...patch }];
      return validateSnapshotSchema(d);
    };
    expect(withEvent({})).toBeNull();
    expect(withEvent({ source: undefined })).toBe('auditEvents[0].source_missing');
    expect(withEvent({ source: 'server' })).toBe('auditEvents[0].source_invalid');
    expect(withEvent({ occurredAt: 'yesterday' })).toBe('auditEvents[0].occurredAt_invalid');
    expect(withEvent({ action: '' })).toBe('auditEvents[0].action_invalid');
    expect(withEvent({ entityId: undefined })).toBe('auditEvents[0].entityId_missing');
  });

  it('is reached through validatePracticeData, after the structural gate, and keeps the legacy reasons first', () => {
    const data = fixture();
    data.clients[0].amlRiskRating = 'critical';
    expect(validatePracticeData(data)).toBe('client_aml_rating_invalid');
    const data2 = fixture();
    data2.jobs[0].status = 'nonsense';
    expect(validatePracticeData(data2)).toBe('jobs[0].status_invalid');
    expect(validatePracticeData({ practice: { id: 'p', name: 'n' }, users: [], clients: [], jobs: 'nope' })).toBe('jobs_not_an_array');
  });

  it('bounds a collection so a request cannot make every later read enormous', () => {
    const data = fixture();
    data.activities = Array.from({ length: 100_001 }, (_, i) => ({ id: `a${i}` }));
    expect(validateSnapshotSchema(data)).toBe('activities_too_large');
  });
});
