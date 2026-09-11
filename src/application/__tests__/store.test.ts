import { beforeEach, describe, expect, it } from 'vitest';
import { configureRepository, useAppStore } from '../store';
import { PLACEHOLDER_CONTACT_NAME } from '../clientImport';
import { MemoryRepository } from '../persistence/memoryRepository';
import { computeDerived } from '../selectors';
import { buildFixtureData } from '../../testing/fixtures';

const today = '2026-09-11';

describe('application store — primary workflow', () => {
  beforeEach(() => {
    configureRepository(new MemoryRepository());
    useAppStore.setState({ data: buildFixtureData(today), today, ready: true, currentUserId: 'u_adnan' });
  });

  const items = (jobId: string) => useAppStore.getState().data.requestItems.filter((i) => i.jobId === jobId);
  const job = (id: string) => useAppStore.getState().data.jobs.find((j) => j.id === id)!;

  it('sends a simulated reminder and logs communication + activity', () => {
    const before = useAppStore.getState().data.communications.length;
    useAppStore.getState().sendReminder({ jobId: 'job_abc_accounts', channel: 'whatsapp', recipient: '077', body: 'hello', documentsRequested: ['Loan statement'], stage: 'Firm' });
    const s = useAppStore.getState().data;
    expect(s.communications.length).toBe(before + 1);
    expect(s.communications.find((c) => c.body === 'hello')?.simulated).toBe(true);
    expect(s.activities[0].kind).toBe('reminder_sent');
    expect(s.auditEvents[0].action).toBe('communication.send');
  });

  it('confirming an inbox item attaches the document and updates the checklist', () => {
    useAppStore.getState().confirmInboxItem('inb_abc_loan');
    const s = useAppStore.getState().data;
    expect(s.inboxItems.find((i) => i.id === 'inb_abc_loan')?.status).toBe('confirmed');
    const loan = items('job_abc_accounts').find((i) => i.label === 'Loan statement');
    expect(loan?.status).toBe('received');
    expect(s.documents.some((d) => d.fileName === 'ABC-Lloyds-Loan-Statement.pdf' && d.jobId === 'job_abc_accounts')).toBe(true);
    const d = computeDerived(s, useAppStore.getState().today);
    expect(d.jobViewById.get('job_abc_accounts')?.completeness.percent).toBe(83);
    expect(job('job_abc_accounts').status).toBe('waiting_for_records');
  });

  it('receiving the final document stops chasing and moves the job to ready to start', () => {
    useAppStore.getState().confirmInboxItem('inb_abc_loan');
    const expenses = items('job_abc_accounts').find((i) => i.label === 'Director expenses')!;
    useAppStore.getState().markItemReceived(expenses.id);
    const s = useAppStore.getState();
    expect(job('job_abc_accounts').status).toBe('ready_to_start');
    expect(job('job_abc_accounts').waitingOn).toBe('accountant');
    const d = computeDerived(s.data, s.today);
    const view = d.jobViewById.get('job_abc_accounts')!;
    expect(view.completeness.complete).toBe(true);
    expect(view.chasing.required).toBe(false);
    expect(d.attention.some((a) => a.jobId === 'job_abc_accounts')).toBe(false);
    expect(s.data.activities[0].message).toMatch(/Chasing stopped/);
  });

  it('records approvals and moves through the checkpoints', () => {
    useAppStore.getState().recordApproval('job_brown_accounts', 'client', 'approved', 'Gareth Brown');
    expect(job('job_brown_accounts').status).toBe('ready_to_file');
    expect(job('job_brown_accounts').waitingOn).toBe('nothing');
  });

  it('filing a recurring job generates the next one exactly once', () => {
    const before = useAppStore.getState().data.jobs.length;
    const { nextJob } = useAppStore.getState().fileJob('job_khan_vat');
    const s = useAppStore.getState().data;
    expect(job('job_khan_vat').status).toBe('filed');
    expect(s.filings.find((f) => f.jobId === 'job_khan_vat')?.simulated).toBe(true);
    expect(nextJob).toBeDefined();
    expect(s.jobs.length).toBe(before + 1);
    expect(nextJob!.obligationId).toBe('ob_khan_vat');
    expect(s.requestItems.filter((i) => i.jobId === nextJob!.id).length).toBe(3);
    // A second attempt to generate for the same obligation/period is a no-op.
    const dup = s.jobs.filter((j) => j.obligationId === 'ob_khan_vat' && j.periodKey === nextJob!.periodKey);
    expect(dup.length).toBe(1);
  });

  it('refuses invalid transitions', () => {
    expect(() => useAppStore.getState().transitionJob('job_abc_accounts', 'filed')).toThrow();
  });

  it('reassigning a job updates capacity and creates an activity', () => {
    useAppStore.getState().reassignJob('job_northern_vat', 'u_priya');
    const s = useAppStore.getState();
    expect(job('job_northern_vat').assigneeUserId).toBe('u_priya');
    expect(s.data.activities[0].kind).toBe('job_reassigned');
    const d = computeDerived(s.data, s.today);
    expect(d.capacity[30].rows.find((r) => r.user.id === 'u_priya')?.jobs.some((j) => j.id === 'job_northern_vat')).toBe(true);
  });

  it('creates a client with an onboarding case', () => {
    const c = useAppStore.getState().createClient({ name: 'Test Co Ltd', type: 'limited_company', ownerUserId: 'u_adnan', contactName: 'Tess Test', preferredChannel: 'email', services: ['annual_accounts'], identifiers: { company_number: '12121212' } });
    const s = useAppStore.getState().data;
    expect(s.clients.find((x) => x.id === c.id)?.lifecycle).toBe('onboarding');
    expect(s.onboardingCases.find((o) => o.clientId === c.id)).toBeDefined();
    expect(s.identifiers.find((i) => i.clientId === c.id)?.kind).toBe('company_number');
  });

  it('imports clients in bulk and skips rows whose company number is already on file', () => {
    const before = useAppStore.getState().data.clients.length;
    const { created, skipped } = useAppStore.getState().importClients([
      { name: 'Imported Co Ltd', companyNumber: '99999999', accountsPeriodEnd: '2026-06-30', accountsDue: '2027-03-31' },
    ]);
    expect(created).toBe(1);
    expect(skipped).toEqual([]);
    const s = useAppStore.getState().data;
    expect(s.clients.length).toBe(before + 1);
    const imported = s.clients.find((c) => c.name === 'Imported Co Ltd')!;
    expect(imported.lifecycle).toBe('active');
    expect(s.jobs.some((j) => j.clientId === imported.id && j.serviceCode === 'annual_accounts')).toBe(true);
    expect(s.activities[0].kind).toBe('client_created');

    // Re-importing the same company number is a no-op, not a duplicate.
    const second = useAppStore.getState().importClients([{ name: 'Imported Co Ltd', companyNumber: '99999999' }]);
    expect(second.created).toBe(0);
    expect(second.skipped).toHaveLength(1);
    expect(useAppStore.getState().data.clients.length).toBe(before + 1);
  });

  it('records an audit event when an identifier is revealed', () => {
    useAppStore.getState().recordIdentifierReveal('cl_abc', 'utr');
    expect(useAppStore.getState().data.auditEvents[0].action).toBe('identifier.reveal');
  });

  describe('refreshClientFromCompaniesHouse', () => {
    it('updates company fields from a fresh profile', () => {
      const { peopleAdded } = useAppStore.getState().refreshClientFromCompaniesHouse(
        'cl_abc',
        {
          companyNumber: '00000001',
          companyName: 'ABC Ltd',
          companyStatus: 'active',
          companyType: 'ltd',
          dateOfCreation: '2010-01-01',
          sicCodes: ['62012'],
          previousNames: ['OLD ABC LTD'],
          registeredOfficeAddress: { formatted: '1 New Address, London' },
          accountingReferenceDate: null,
          nextAccountsDueOn: null,
          nextAccountsPeriodEndOn: null,
          nextConfirmationStatementDueOn: null,
          source: 'companies_house',
        },
        null,
      );
      expect(peopleAdded).toBe(0);
      const client = useAppStore.getState().data.clients.find((c) => c.id === 'cl_abc')!;
      expect(client.registeredOffice?.formatted).toBe('1 New Address, London');
      expect(client.companiesHouseStatus).toBe('active');
      expect(client.sicCodes).toEqual(['62012']);
      expect(client.previousNames).toEqual(['OLD ABC LTD']);
    });

    it('adds a new director without duplicating an already-linked person and role', () => {
      // cl_abc already has Dave Thompson as both director and PSC (see testing/fixtures.ts).
      const before = useAppStore.getState().data;
      const peopleBefore = before.people.length;
      const rolesBefore = before.personRoles.filter((r) => r.clientId === 'cl_abc').length;

      const { peopleAdded } = useAppStore.getState().refreshClientFromCompaniesHouse('cl_abc', null, {
        directors: [{ name: 'Dave Thompson', role: 'director', appointedOn: null, dateOfBirth: null, nationality: null, occupation: null, naturesOfControl: [] }],
        pscs: [{ name: 'Brand New Person', role: 'psc', appointedOn: null, dateOfBirth: null, nationality: null, occupation: null, naturesOfControl: ['Owns 75-100% of shares'] }],
        source: 'companies_house',
      });

      expect(peopleAdded).toBe(1);
      const after = useAppStore.getState().data;
      expect(after.people.length).toBe(peopleBefore + 1);
      const clientRoles = after.personRoles.filter((r) => r.clientId === 'cl_abc');
      expect(clientRoles.length).toBe(rolesBefore + 1);
      const newPerson = after.people.find((p) => p.fullName === 'Brand New Person')!;
      const newRole = clientRoles.find((r) => r.personId === newPerson.id)!;
      expect(newRole.kind).toBe('psc');
      expect(newRole.naturesOfControl).toEqual(['Owns 75-100% of shares']);
      expect(newRole.identityVerification).toBe('not_started');
    });

    it('replaces a placeholder primary-contact name with the first director once one is known', () => {
      useAppStore.getState().importClients([{ name: 'Placeholder Contact Ltd', companyNumber: '55554444' }]);
      const client = useAppStore.getState().data.clients.find((c) => c.name === 'Placeholder Contact Ltd')!;
      const contactBefore = useAppStore.getState().data.contacts.find((c) => c.id === client.primaryContactId)!;
      expect(contactBefore.name).toBe(PLACEHOLDER_CONTACT_NAME);

      useAppStore.getState().refreshClientFromCompaniesHouse(client.id, null, {
        directors: [{ name: 'Real Director Name', role: 'director', appointedOn: null, dateOfBirth: null, nationality: null, occupation: null, naturesOfControl: [] }],
        pscs: [],
        source: 'companies_house',
      });

      const contactAfter = useAppStore.getState().data.contacts.find((c) => c.id === client.primaryContactId)!;
      expect(contactAfter.name).toBe('Real Director Name');
    });

    it('does not overwrite a contact name the practice has already filled in', () => {
      // cl_abc's primary contact already has a real name in the fixture, not the placeholder.
      const client = useAppStore.getState().data.clients.find((c) => c.id === 'cl_abc')!;
      const contactBefore = useAppStore.getState().data.contacts.find((c) => c.id === client.primaryContactId)!;
      expect(contactBefore.name).not.toBe(PLACEHOLDER_CONTACT_NAME);

      useAppStore.getState().refreshClientFromCompaniesHouse('cl_abc', null, {
        directors: [{ name: 'Someone Else Entirely', role: 'director', appointedOn: null, dateOfBirth: null, nationality: null, occupation: null, naturesOfControl: [] }],
        pscs: [],
        source: 'companies_house',
      });

      const contactAfter = useAppStore.getState().data.contacts.find((c) => c.id === client.primaryContactId)!;
      expect(contactAfter.name).toBe(contactBefore.name);
    });

    it('is a no-op when both profile and people are null', () => {
      const before = useAppStore.getState().data;
      const { peopleAdded } = useAppStore.getState().refreshClientFromCompaniesHouse('cl_abc', null, null);
      expect(peopleAdded).toBe(0);
      expect(useAppStore.getState().data.people.length).toBe(before.people.length);
      expect(useAppStore.getState().data.personRoles.length).toBe(before.personRoles.length);
    });
  });
});
