import { describe, expect, it } from 'vitest';
import { validatePracticeData } from '../practiceDataShape.mjs';

const EVERY_COLLECTION = [
  'users', 'clients', 'contacts', 'identifiers', 'people', 'personRoles', 'subscriptions', 'obligations', 'jobs',
  'requestItems', 'documents', 'communications', 'reminderSequences', 'approvals', 'filings', 'activities',
  'auditEvents', 'inboxItems', 'notifications', 'onboardingCases', 'mtdReadiness', 'wipEntries', 'timeEntries',
];

function fullSnapshot() {
  const data = { practice: { id: 'prac_main', name: 'Test Practice' } };
  for (const key of EVERY_COLLECTION) data[key] = [];
  return data;
}

describe('validatePracticeData', () => {
  it('accepts a complete snapshot', () => {
    expect(validatePracticeData(fullSnapshot())).toBeNull();
  });

  it('accepts a snapshot with rows in every collection and extra unknown keys', () => {
    const data = fullSnapshot();
    data.clients = [{ id: 'cl_1', name: 'Example Ltd' }];
    data.somethingNewerThanThisServer = { any: 'thing' };
    expect(validatePracticeData(data)).toBeNull();
  });

  it('accepts an older snapshot that predates a newer optional collection', () => {
    const data = fullSnapshot();
    delete data.mtdReadiness;
    expect(validatePracticeData(data)).toBeNull();
  });

  it('rejects things that are not a snapshot at all', () => {
    expect(validatePracticeData(undefined)).toBe('not_an_object');
    expect(validatePracticeData(null)).toBe('not_an_object');
    expect(validatePracticeData('{}')).toBe('not_an_object');
    expect(validatePracticeData([])).toBe('not_an_object');
    expect(validatePracticeData({})).toBe('practice_missing');
  });

  it('rejects a snapshot without a practice id', () => {
    expect(validatePracticeData({ practice: {}, users: [], clients: [] })).toBe('practice_id_missing');
    expect(validatePracticeData({ practice: { id: '  ' }, users: [], clients: [] })).toBe('practice_id_missing');
    expect(validatePracticeData({ practice: { id: 42 }, users: [], clients: [] })).toBe('practice_id_missing');
  });

  it('rejects a snapshot missing the core collections', () => {
    const data = fullSnapshot();
    delete data.clients;
    expect(validatePracticeData(data)).toBe('clients_missing');
    const noUsers = fullSnapshot();
    delete noUsers.users;
    expect(validatePracticeData(noUsers)).toBe('users_missing');
  });

  it('rejects a known collection that is present but not an array', () => {
    for (const key of EVERY_COLLECTION) {
      const data = fullSnapshot();
      data[key] = 'not-an-array';
      expect(validatePracticeData(data)).toMatch(new RegExp(`^${key}_`));
    }
  });

  it('accepts clients with a valid AML rating and turnover, present or absent', () => {
    const data = fullSnapshot();
    data.clients = [
      { id: 'cl_1', name: 'No compliance fields at all' },
      { id: 'cl_2', name: 'Rated, no turnover', amlRiskRating: 'high' },
      { id: 'cl_3', name: 'Zero turnover is valid', amlRiskRating: 'low', rolling12MonthTurnover: 0 },
      { id: 'cl_4', name: 'Explicit nulls', amlRiskRating: null, rolling12MonthTurnover: null },
    ];
    expect(validatePracticeData(data)).toBeNull();
  });

  it('rejects a client whose AML rating is outside the known set', () => {
    const data = fullSnapshot();
    data.clients = [{ id: 'cl_1', name: 'Example Ltd', amlRiskRating: 'extreme' }];
    expect(validatePracticeData(data)).toBe('client_aml_rating_invalid');
  });

  it('rejects a client whose turnover is negative, non-finite, or not a number', () => {
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY, '90000']) {
      const data = fullSnapshot();
      data.clients = [{ id: 'cl_1', name: 'Example Ltd', rolling12MonthTurnover: bad }];
      expect(validatePracticeData(data)).toBe('client_turnover_invalid');
    }
  });

  it('rejects a client row that is not an object', () => {
    const data = fullSnapshot();
    data.clients = [null];
    expect(validatePracticeData(data)).toBe('client_not_an_object');
  });
});
