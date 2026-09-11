import { describe, expect, it } from 'vitest';
import { buildImportedClientRecords, mergeCompanyProfile, type ClientRosterRow } from '../clientImport';
import type { CompanyProfile } from '../../integrations/companiesHouseTypes';

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
});

function fakeProfile(overrides: Partial<CompanyProfile> = {}): CompanyProfile {
  return {
    companyNumber: '12345678',
    companyName: 'Fake Ltd',
    companyStatus: 'active',
    companyType: 'ltd',
    dateOfCreation: '2015-01-01',
    sicCodes: ['62012'],
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
});
