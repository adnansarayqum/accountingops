import { describe, expect, it } from 'vitest';
import { buildImportedClientRecords, type ClientRosterRow } from '../clientImport';

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
});
