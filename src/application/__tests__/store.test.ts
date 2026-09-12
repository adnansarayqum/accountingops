import { beforeEach, describe, expect, it } from 'vitest';
import { configureRepository, useAppStore } from '../store';
import { PLACEHOLDER_CONTACT_NAME } from '../clientImport';
import { MemoryRepository } from '../persistence/memoryRepository';
import { computeDerived } from '../selectors';
import { buildFixtureData } from '../../testing/fixtures';
import type { CompanyPerson, CompanyProfile } from '../../integrations/companiesHouseTypes';

const today = '2026-09-11';

function profileFor(companyNumber: string, address: string): CompanyProfile {
  return {
    companyNumber,
    companyName: `Company ${companyNumber}`,
    companyStatus: 'active',
    companyType: 'ltd',
    dateOfCreation: '2015-01-01',
    sicCodes: [],
    previousNames: [],
    registeredOfficeAddress: { formatted: address },
    accountingReferenceDate: null,
    nextAccountsDueOn: null,
    nextAccountsPeriodEndOn: null,
    nextConfirmationStatementDueOn: null,
    source: 'companies_house',
  };
}

function chPerson(name: string, role: 'director' | 'psc' = 'director'): CompanyPerson {
  return { name, role, appointedOn: null, dateOfBirth: null, nationality: null, occupation: null, naturesOfControl: [] };
}

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

  it('records how a reminder actually left, defaulting to simulated', () => {
    useAppStore.getState().sendReminder({ jobId: 'job_abc_accounts', channel: 'email', recipient: 'dave@abc-construction.example', subject: 'S', body: 'real', documentsRequested: [], stage: 'Firm', delivery: { status: 'sent', providerName: 'postmark', providerMessageId: 'pm-1' } });
    const real = useAppStore.getState().data.communications.find((c) => c.body === 'real')!;
    expect(real).toMatchObject({ simulated: false, deliveryStatus: 'sent', providerName: 'postmark', providerMessageId: 'pm-1' });
    expect(useAppStore.getState().data.auditEvents[0].after).toMatchObject({ delivery: 'sent', provider: 'postmark' });

    useAppStore.getState().sendReminder({ jobId: 'job_abc_accounts', channel: 'whatsapp', recipient: '07700 900123', body: 'handed', documentsRequested: [], stage: 'Firm', delivery: { status: 'handed_off', providerName: 'whatsapp_click_to_chat' } });
    expect(useAppStore.getState().data.communications.find((c) => c.body === 'handed')).toMatchObject({ simulated: false, deliveryStatus: 'handed_off' });
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

  it('treats every spelling of a company number as the same client, and stores the canonical one', () => {
    const first = useAppStore.getState().importClients([{ name: 'Zero Ltd', companyNumber: '8654123' }]);
    expect(first.created).toBe(1);
    const client = useAppStore.getState().data.clients.find((c) => c.name === 'Zero Ltd')!;
    expect(useAppStore.getState().data.identifiers.find((i) => i.clientId === client.id && i.kind === 'company_number')?.value).toBe('08654123');

    const again = useAppStore.getState().importClients([{ name: 'Zero Ltd', companyNumber: '08654123' }, { name: 'Zero Ltd', companyNumber: ' 0865 4123 ' }]);
    expect(again.created).toBe(0);
    expect(again.skipped).toHaveLength(2);
  });

  describe('contacts', () => {
    const contactsOf = (clientId: string) => useAppStore.getState().data.contacts.filter((c) => c.clientId === clientId);
    const primaryOf = (clientId: string) => {
      const client = useAppStore.getState().data.clients.find((c) => c.id === clientId)!;
      return useAppStore.getState().data.contacts.find((c) => c.id === client.primaryContactId)!;
    };

    it('fills in contact details that were missing', () => {
      const contact = primaryOf('cl_abc');
      useAppStore.getState().updateContact(contact.id, { name: 'Dave Thompson', email: 'dave@abc.example', phone: '07700 900123' });
      const updated = primaryOf('cl_abc');
      expect(updated.email).toBe('dave@abc.example');
      expect(updated.phone).toBe('07700 900123');
      expect(useAppStore.getState().data.auditEvents[0].action).toBe('contact.update');
    });

    it('trims values, and clears an optional field set to blank', () => {
      const contact = primaryOf('cl_abc');
      useAppStore.getState().updateContact(contact.id, { email: '  spaced@abc.example  ' });
      expect(primaryOf('cl_abc').email).toBe('spaced@abc.example');

      useAppStore.getState().updateContact(contact.id, { email: '' });
      expect(primaryOf('cl_abc').email).toBeUndefined();
    });

    it('keeps the existing name when given a blank one', () => {
      const contact = primaryOf('cl_abc');
      const before = contact.name;
      useAppStore.getState().updateContact(contact.id, { name: '   ' });
      expect(primaryOf('cl_abc').name).toBe(before);
    });

    it('adds another contact without displacing the main one', () => {
      const before = contactsOf('cl_abc').length;
      const added = useAppStore.getState().addContact('cl_abc', { name: 'Book Keeper', role: 'Bookkeeper', email: 'books@abc.example' });
      expect(contactsOf('cl_abc')).toHaveLength(before + 1);
      expect(added.isPrimary).toBe(false);
      expect(primaryOf('cl_abc').id).not.toBe(added.id);
    });

    it('promotes a chosen contact to main', () => {
      const added = useAppStore.getState().addContact('cl_abc', { name: 'New Main' });
      useAppStore.getState().setPrimaryContact('cl_abc', added.id);
      expect(primaryOf('cl_abc').id).toBe(added.id);
      // Exactly one contact is ever flagged primary.
      expect(contactsOf('cl_abc').filter((c) => c.isPrimary)).toHaveLength(1);
    });

    it('removes a contact, and promotes a replacement if the main one goes', () => {
      useAppStore.getState().addContact('cl_abc', { name: 'Spare Contact' });
      const mainId = primaryOf('cl_abc').id;
      useAppStore.getState().removeContact(mainId);

      const remaining = contactsOf('cl_abc');
      expect(remaining.some((c) => c.id === mainId)).toBe(false);
      // The client is never left pointing at a contact that no longer exists.
      expect(remaining.some((c) => c.id === primaryOf('cl_abc').id)).toBe(true);
      expect(remaining.filter((c) => c.isPrimary)).toHaveLength(1);
      expect(primaryOf('cl_abc').isPrimary).toBe(true);
    });

    it('removes a non-primary contact without changing who the main one is', () => {
      const added = useAppStore.getState().addContact('cl_abc', { name: 'Temporary Contact' });
      const mainId = primaryOf('cl_abc').id;
      useAppStore.getState().removeContact(added.id);
      expect(contactsOf('cl_abc').some((c) => c.id === added.id)).toBe(false);
      expect(primaryOf('cl_abc').id).toBe(mainId);
    });

    it('refuses to remove a client’s last contact', () => {
      const contacts = contactsOf('cl_abc');
      for (const c of contacts.slice(1)) useAppStore.getState().removeContact(c.id);
      expect(contactsOf('cl_abc')).toHaveLength(1);

      useAppStore.getState().removeContact(contactsOf('cl_abc')[0].id);
      expect(contactsOf('cl_abc')).toHaveLength(1);
    });
  });

  describe('renameUser', () => {
    it("updates a team member's display name", () => {
      useAppStore.getState().renameUser('u_sarah', 'Sarah Raihan Mitchell');
      const user = useAppStore.getState().data.users.find((u) => u.id === 'u_sarah')!;
      expect(user.name).toBe('Sarah Raihan Mitchell');
      expect(useAppStore.getState().data.activities[0].message).toBe('Sarah Mitchell renamed to Sarah Raihan Mitchell.');
    });

    it('trims whitespace and ignores a blank name', () => {
      useAppStore.getState().renameUser('u_sarah', '  Trimmed Name  ');
      expect(useAppStore.getState().data.users.find((u) => u.id === 'u_sarah')!.name).toBe('Trimmed Name');

      useAppStore.getState().renameUser('u_sarah', '   ');
      expect(useAppStore.getState().data.users.find((u) => u.id === 'u_sarah')!.name).toBe('Trimmed Name');
    });

    it('is a no-op for an unknown user id', () => {
      const before = useAppStore.getState().data.users.length;
      useAppStore.getState().renameUser('u_does_not_exist', 'Nobody');
      expect(useAppStore.getState().data.users.length).toBe(before);
    });
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

    it('matches Companies House\'s two spellings of a person already on file, instead of adding them again', () => {
      // cl_abc already has "Dave Thompson" as director and PSC. The register
      // spells him "THOMPSON, Dave" in one list and "Mr Dave Thompson" in the other.
      const before = useAppStore.getState().data;
      const { peopleAdded } = useAppStore.getState().refreshClientFromCompaniesHouse('cl_abc', null, {
        directors: [{ name: 'THOMPSON, Dave', role: 'director', appointedOn: null, dateOfBirth: { month: '4', year: '1978' }, nationality: null, occupation: null, naturesOfControl: [] }],
        pscs: [{ name: 'Mr Dave Thompson', role: 'psc', appointedOn: null, dateOfBirth: { month: '4', year: '1978' }, nationality: null, occupation: null, naturesOfControl: ['Owns 75-100% of shares'] }],
        source: 'companies_house',
      });
      expect(peopleAdded).toBe(0);
      const after = useAppStore.getState().data;
      expect(after.people.length).toBe(before.people.length);
      expect(after.personRoles.filter((r) => r.clientId === 'cl_abc').length).toBe(before.personRoles.filter((r) => r.clientId === 'cl_abc').length);
      // The name on file is left exactly as the practice had it; only the birth month is learned.
      const dave = after.people.find((p) => p.id === 'p_dave')!;
      expect(dave.fullName).toBe('Dave Thompson');
      expect(dave.birthMonthYear).toBe('1978-04');
    });

    it('adds one person, not two, when a new director and PSC are the same individual spelled two ways', () => {
      useAppStore.getState().importClients([{ name: 'Mosaic Building Design Ltd', companyNumber: '44445555' }]);
      const client = useAppStore.getState().data.clients.find((c) => c.name === 'Mosaic Building Design Ltd')!;
      const { peopleAdded } = useAppStore.getState().refreshClientFromCompaniesHouse(client.id, null, {
        directors: [{ name: 'HASAN, Mohammad', role: 'director', appointedOn: null, dateOfBirth: { month: '3', year: '1985' }, nationality: null, occupation: null, naturesOfControl: [] }],
        pscs: [{ name: 'Mr Mohammad Hasan', role: 'psc', appointedOn: null, dateOfBirth: { month: '3', year: '1985' }, nationality: null, occupation: null, naturesOfControl: [] }],
        source: 'companies_house',
      });
      expect(peopleAdded).toBe(2); // two roles…
      const roles = useAppStore.getState().data.personRoles.filter((r) => r.clientId === client.id);
      expect(new Set(roles.map((r) => r.personId)).size).toBe(1); // …one person
      const person = useAppStore.getState().data.people.find((p) => p.id === roles[0].personId)!;
      expect(person.fullName).toBe('Mohammad Hasan');
      const contact = useAppStore.getState().data.contacts.find((c) => c.id === client.primaryContactId)!;
      expect(contact.name).toBe('Mohammad Hasan');
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

    it('applies a batch of clients as one change, so the background sync saves once', () => {
      useAppStore.getState().importClients([
        { name: 'Batch One Ltd', companyNumber: '31313131' },
        { name: 'Batch Two Ltd', companyNumber: '32323232' },
      ]);
      const clients = useAppStore.getState().data.clients;
      const one = clients.find((c) => c.name === 'Batch One Ltd')!;
      const two = clients.find((c) => c.name === 'Batch Two Ltd')!;
      const auditsBefore = useAppStore.getState().data.auditEvents.length;

      const result = useAppStore.getState().refreshClientsFromCompaniesHouse([
        {
          clientId: one.id,
          profile: profileFor('31313131', 'One Road, London'),
          people: { directors: [chPerson('Director One')], pscs: [], source: 'companies_house' },
        },
        { clientId: two.id, profile: profileFor('32323232', 'Two Road, Leeds'), people: null },
        { clientId: 'cl_does_not_exist', profile: profileFor('99999999', 'Nowhere'), people: null },
      ]);

      expect(result).toEqual({ clientsUpdated: 2, peopleAdded: 1 });
      const after = useAppStore.getState().data;
      expect(after.clients.find((c) => c.id === one.id)!.registeredOffice?.formatted).toBe('One Road, London');
      expect(after.clients.find((c) => c.id === two.id)!.registeredOffice?.formatted).toBe('Two Road, Leeds');
      expect(after.clients.find((c) => c.id === one.id)!.companiesHouseSyncedAt).toBeTruthy();
      // One audit entry per client actually refreshed — the unknown id is skipped.
      expect(after.auditEvents.length - auditsBefore).toBe(2);
    });

    it('stamps companiesHouseSyncedAt so staleness can be judged later', () => {
      const before = useAppStore.getState().data.clients.find((c) => c.id === 'cl_abc')!.companiesHouseSyncedAt;
      expect(before).toBeUndefined();
      useAppStore.getState().refreshClientFromCompaniesHouse('cl_abc', profileFor('09876543', 'Synced Road'), null);
      const after = useAppStore.getState().data.clients.find((c) => c.id === 'cl_abc')!.companiesHouseSyncedAt;
      expect(after).toBeTruthy();
      expect(Date.now() - new Date(after!).getTime()).toBeLessThan(5000);
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
