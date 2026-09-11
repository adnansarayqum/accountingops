import { describe, expect, it } from 'vitest';
import { buildImportedClientRecords, mergeCompanyPeople, mergeCompanyProfile, PLACEHOLDER_CONTACT_NAME, type ClientRosterRow } from '../clientImport';
import type { CompanyPeopleResponse, CompanyPerson, CompanyProfile } from '../../integrations/companiesHouseTypes';

const today = '2026-09-11';
const practiceId = 'prac_test';
const ownerUserId = 'u_owner';

describe('buildImportedClientRecords', () => {
  it('creates a client, placeholder contact, identifiers, and an accounts job from a full row', () => {
    const row: ClientRosterRow = {
      name: 'Example Trading Ltd',
      companyNumber: '12345678',
      utr: '1234567890',
      chAuthCode: 'ABC123',
      accountsPeriodEnd: '2026-06-30',
      accountsDue: '2027-03-31',
      confirmationStatementDue: '2026-11-15',
    };
    const built = buildImportedClientRecords([row], practiceId, ownerUserId, today);

    expect(built.clients).toHaveLength(1);
    const client = built.clients[0];
    expect(client.name).toBe('Example Trading Ltd');
    expect(client.type).toBe('limited_company');
    expect(client.lifecycle).toBe('active');
    expect(client.ownerUserId).toBe(ownerUserId);

    expect(built.contacts).toHaveLength(1);
    expect(built.contacts[0].clientId).toBe(client.id);

    const idKinds = built.identifiers.map((i) => i.kind).sort();
    expect(idKinds).toEqual(['ch_auth_code', 'company_number', 'utr']);
    expect(built.identifiers.every((i) => i.clientId === client.id)).toBe(true);

    // Two obligations/jobs: annual accounts and confirmation statement.
    expect(built.obligations).toHaveLength(2);
    expect(built.jobs).toHaveLength(2);

    const accountsJob = built.jobs.find((j) => j.serviceCode === 'annual_accounts')!;
    expect(accountsJob.periodEnd).toBe('2026-06-30');
    expect(accountsJob.dueDate).toBe('2027-03-31');
    expect(accountsJob.status).toBe('waiting_for_records');
    expect(built.requestItems.some((r) => r.jobId === accountsJob.id)).toBe(true);

    const csJob = built.jobs.find((j) => j.serviceCode === 'confirmation_statement')!;
    expect(csJob.dueDate).toBe('2026-11-15');
    expect(csJob.periodEnd).toBe('2026-11-01'); // 14 days before the due date
  });

  it('creates a client with no jobs when no dates are given', () => {
    const row: ClientRosterRow = { name: 'No Dates Ltd', companyNumber: '87654321' };
    const built = buildImportedClientRecords([row], practiceId, ownerUserId, today);
    expect(built.clients).toHaveLength(1);
    expect(built.jobs).toHaveLength(0);
    expect(built.obligations).toHaveLength(0);
    expect(built.identifiers.map((i) => i.kind)).toEqual(['company_number']);
  });

  it('imports multiple rows independently', () => {
    const rows: ClientRosterRow[] = [
      { name: 'Alpha Ltd', companyNumber: '11111111', accountsPeriodEnd: '2026-03-31', accountsDue: '2026-12-31' },
      { name: 'Beta Ltd', companyNumber: '22222222' },
    ];
    const built = buildImportedClientRecords(rows, practiceId, ownerUserId, today);
    expect(built.clients).toHaveLength(2);
    expect(built.clients.map((c) => c.name)).toEqual(['Alpha Ltd', 'Beta Ltd']);
    expect(built.jobs).toHaveLength(1);
  });

  it('carries Companies House enrichment fields through onto the created client', () => {
    const row: ClientRosterRow = {
      name: 'Enriched Ltd',
      companyNumber: '99998888',
      registeredOffice: { formatted: '1 High Street, London, EC1A 1AA' },
      companiesHouseStatus: 'active',
      sicCodes: ['62012'],
      incorporatedOn: '2018-05-01',
    };
    const built = buildImportedClientRecords([row], practiceId, ownerUserId, today);
    const client = built.clients[0];
    expect(client.registeredOffice?.formatted).toBe('1 High Street, London, EC1A 1AA');
    expect(client.companiesHouseStatus).toBe('active');
    expect(client.sicCodes).toEqual(['62012']);
    expect(client.incorporatedOn).toBe('2018-05-01');
  });

  it('creates one Person plus one PersonRole per director and per PSC', () => {
    const row: ClientRosterRow = {
      name: 'People Ltd',
      companyNumber: '55556666',
      directors: [fakePerson({ name: 'Jane Smith', role: 'director' })],
      pscs: [fakePerson({ name: 'John Jones', role: 'psc' })],
    };
    const built = buildImportedClientRecords([row], practiceId, ownerUserId, today);
    const client = built.clients[0];

    expect(built.people.map((p) => p.fullName).sort()).toEqual(['Jane Smith', 'John Jones']);
    expect(built.personRoles).toHaveLength(2);
    expect(built.personRoles.every((r) => r.clientId === client.id)).toBe(true);
    expect(built.personRoles.every((r) => r.identityVerification === 'not_started')).toBe(true);
    expect(built.personRoles.every((r) => r.personalCodeCaptured === false)).toBe(true);
    const roleKinds = built.personRoles.map((r) => r.kind).sort();
    expect(roleKinds).toEqual(['director', 'psc']);
  });

  it('shares one Person between a director and PSC role for the same name', () => {
    const row: ClientRosterRow = {
      name: 'Sole Director Ltd',
      companyNumber: '77778888',
      directors: [fakePerson({ name: 'Alex Carter', role: 'director' })],
      pscs: [fakePerson({ name: 'Alex Carter', role: 'psc' })],
    };
    const built = buildImportedClientRecords([row], practiceId, ownerUserId, today);
    expect(built.people).toHaveLength(1);
    expect(built.personRoles).toHaveLength(2);
    expect(built.personRoles.every((r) => r.personId === built.people[0].id)).toBe(true);
    expect(built.personRoles.map((r) => r.kind).sort()).toEqual(['director', 'psc']);
  });

  it('creates no people when the row has no directors or PSCs', () => {
    const row: ClientRosterRow = { name: 'No People Ltd', companyNumber: '99990000' };
    const built = buildImportedClientRecords([row], practiceId, ownerUserId, today);
    expect(built.people).toHaveLength(0);
    expect(built.personRoles).toHaveLength(0);
  });

  it('names the primary contact after the first director, instead of a generic placeholder', () => {
    const row: ClientRosterRow = {
      name: 'Named Contact Ltd',
      companyNumber: '11112222',
      directors: [fakePerson({ name: 'Priya Patel', role: 'director' }), fakePerson({ name: 'Second Director', role: 'director' })],
    };
    const built = buildImportedClientRecords([row], practiceId, ownerUserId, today);
    expect(built.contacts[0].name).toBe('Priya Patel');
  });

  it('falls back to the placeholder contact name when no directors were found', () => {
    const row: ClientRosterRow = { name: 'No Directors Ltd', companyNumber: '33334444' };
    const built = buildImportedClientRecords([row], practiceId, ownerUserId, today);
    expect(built.contacts[0].name).toBe(PLACEHOLDER_CONTACT_NAME);
  });
});

function fakePerson(overrides: Partial<CompanyPerson> = {}): CompanyPerson {
  return {
    name: 'Sample Person',
    role: 'director',
    appointedOn: '2020-01-01',
    dateOfBirth: { month: '5', year: '1980' },
    nationality: 'British',
    occupation: 'Director',
    naturesOfControl: [],
    ...overrides,
  };
}

describe('mergeCompanyPeople', () => {
  it('sets directors and PSCs from a Companies House people lookup', () => {
    const row: ClientRosterRow = { name: 'Bare Ltd', companyNumber: '12345678' };
    const people: CompanyPeopleResponse = { directors: [fakePerson({ name: 'Jane Smith' })], pscs: [fakePerson({ name: 'John Jones', role: 'psc' })], source: 'companies_house' };
    const merged = mergeCompanyPeople(row, people);
    expect(merged.directors).toEqual(people.directors);
    expect(merged.pscs).toEqual(people.pscs);
  });
});

function fakeProfile(overrides: Partial<CompanyProfile> = {}): CompanyProfile {
  return {
    companyNumber: '12345678',
    companyName: 'Fake Ltd',
    companyStatus: 'active',
    companyType: 'ltd',
    dateOfCreation: '2015-01-01',
    sicCodes: ['62012'],
    previousNames: [],
    registeredOfficeAddress: { formatted: '1 Fake Street, London' },
    accountingReferenceDate: { day: '31', month: '12' },
    nextAccountsDueOn: '2027-09-30',
    nextAccountsPeriodEndOn: '2026-12-31',
    nextConfirmationStatementDueOn: '2026-08-01',
    source: 'companies_house',
    ...overrides,
  };
}

describe('mergeCompanyProfile', () => {
  it('fills in fields the spreadsheet never had (registered office, SIC codes, incorporation date)', () => {
    const row: ClientRosterRow = { name: 'Bare Ltd', companyNumber: '12345678' };
    const merged = mergeCompanyProfile(row, fakeProfile());
    expect(merged.registeredOffice?.formatted).toBe('1 Fake Street, London');
    expect(merged.companiesHouseStatus).toBe('active');
    expect(merged.sicCodes).toEqual(['62012']);
    expect(merged.incorporatedOn).toBe('2015-01-01');
  });

  it('overrides the spreadsheet’s own dates with Companies House’s — Companies House wins', () => {
    const row: ClientRosterRow = { name: 'Stale Dates Ltd', companyNumber: '12345678', accountsPeriodEnd: '2020-01-01', accountsDue: '2020-06-01', confirmationStatementDue: '2020-03-01' };
    const merged = mergeCompanyProfile(row, fakeProfile());
    expect(merged.accountsPeriodEnd).toBe('2026-12-31');
    expect(merged.accountsDue).toBe('2027-09-30');
    expect(merged.confirmationStatementDue).toBe('2026-08-01');
  });

  it('keeps the spreadsheet value when Companies House has none for a field', () => {
    const row: ClientRosterRow = { name: 'Partial Ltd', companyNumber: '12345678', confirmationStatementDue: '2026-03-01' };
    const merged = mergeCompanyProfile(row, fakeProfile({ nextConfirmationStatementDueOn: null, sicCodes: [] }));
    expect(merged.confirmationStatementDue).toBe('2026-03-01');
    // sicCodes: an empty array from Companies House doesn't overwrite nothing with nothing more usefully than keeping undefined.
    expect(merged.sicCodes).toBeUndefined();
  });

  it('tolerates a profile with no previousNames field at all, rather than throwing', () => {
    // A real server response always includes previousNames (mapCompanyProfile defaults it to
    // []), but nothing enforces that at runtime for values coming over the wire — this must not
    // throw just because a caller's mock or a malformed response omits the field entirely.
    const row: ClientRosterRow = { name: 'No Field Ltd', companyNumber: '12345678' };
    const { previousNames: _omit, ...profileWithoutPreviousNames } = fakeProfile();
    expect(() => mergeCompanyProfile(row, profileWithoutPreviousNames as CompanyProfile)).not.toThrow();
    expect(mergeCompanyProfile(row, profileWithoutPreviousNames as CompanyProfile).previousNames).toBeUndefined();
  });
});
