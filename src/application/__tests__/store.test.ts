import { beforeEach, describe, expect, it } from 'vitest';
import { findMissingCorporationTax } from '../../domain/corporationTax';
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

      expect(result).toEqual({ clientsUpdated: 2, peopleAdded: 1, verificationsConfirmed: 0 });
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

describe('application store — retention', () => {
  beforeEach(() => {
    configureRepository(new MemoryRepository());
    useAppStore.setState({ data: buildFixtureData(today), today, ready: true, currentUserId: 'u_adnan' });
  });

  it('caps the feeds after every change, keeping the newest entries', async () => {
    const { RETENTION } = await import('../../domain/retention');
    const d = structuredClone(useAppStore.getState().data);
    d.activities = Array.from({ length: RETENTION.activities }, (_, i) => ({ ...d.activities[0], id: `act_old_${i}` }));
    d.notifications = Array.from({ length: RETENTION.notifications }, (_, i) => ({ ...d.notifications[0], id: `ntf_old_${i}`, read: true }));
    d.auditEvents = Array.from({ length: RETENTION.auditEvents }, (_, i) => ({ ...d.auditEvents[0], id: `aud_old_${i}`, action: 'job.transition', before: { status: 'x' }, after: { status: 'y' } }));
    useAppStore.setState({ data: d });

    useAppStore.getState().sendReminder({ jobId: 'job_abc_accounts', channel: 'whatsapp', recipient: '077', body: 'capped', documentsRequested: [], stage: 'Firm' });

    const s = useAppStore.getState().data;
    expect(s.activities).toHaveLength(RETENTION.activities);
    expect(s.activities[0].kind).toBe('reminder_sent');
    expect(s.activities.at(-1)!.id).toBe(`act_old_${RETENTION.activities - 2}`);
    expect(s.auditEvents).toHaveLength(RETENTION.auditEvents);
    expect(s.auditEvents[0].action).toBe('communication.send');
    expect(s.auditEvents[0].after).toBeDefined();
    expect(s.auditEvents[RETENTION.auditDetail]).not.toHaveProperty('after');
    expect(s.notifications.length).toBeLessThanOrEqual(RETENTION.notifications);
    // Business records are never trimmed.
    expect(s.communications.find((c) => c.body === 'capped')).toBeDefined();
  });

  it('records only a sample of names for a bulk import, not the whole roster', () => {
    const rows = Array.from({ length: 60 }, (_, i) => ({ name: `Bulk Import ${i} Ltd`, companyNumber: String(20000000 + i) }));
    useAppStore.getState().importClients(rows);
    const entry = useAppStore.getState().data.auditEvents.find((e) => e.action === 'client.import')!;
    expect(entry.after).toMatchObject({ count: 60 });
    expect((entry.after as { names: string[] }).names).toHaveLength(20);
  });
});

describe('application store — merging duplicate people', () => {
  beforeEach(() => {
    configureRepository(new MemoryRepository());
    const data = structuredClone(buildFixtureData(today));
    // Dave Thompson again, the way an older import wrote him: surname first,
    // a director role at the same client (which Dave already holds) and one
    // at another client (which he doesn't).
    data.people.push({ id: 'p_dave_dup', practiceId: data.practice.id, fullName: 'THOMPSON, Dave' });
    data.personRoles.push(
      { id: 'pr_dup_1', practiceId: data.practice.id, personId: 'p_dave_dup', clientId: 'cl_abc', kind: 'director', identityVerification: 'not_started', personalCodeCaptured: false, evidenceStatus: 'none' },
      { id: 'pr_dup_2', practiceId: data.practice.id, personId: 'p_dave_dup', clientId: 'cl_greenfield', kind: 'director', identityVerification: 'in_progress', personalCodeCaptured: false, evidenceStatus: 'received' },
    );
    useAppStore.setState({ data, today, ready: true, currentUserId: 'u_adnan', toasts: [] });
  });

  it('merges the duplicate into the existing record as one saved change, with an activity and an audit entry', () => {
    const before = useAppStore.getState().data;
    expect(before.people.some((p) => p.id === 'p_dave_dup')).toBe(true);

    const summary = useAppStore.getState().mergeDuplicatePeople();
    expect(summary).toEqual({ peopleRemoved: 1, rolesMoved: 1, rolesCombined: 1 });

    const s = useAppStore.getState().data;
    expect(s.people.some((p) => p.id === 'p_dave_dup')).toBe(false);
    expect(s.people.find((p) => p.id === 'p_dave')?.fullName).toBe('Dave Thompson');
    expect(s.personRoles.find((r) => r.id === 'pr_dup_1')).toBeUndefined();
    expect(s.personRoles.find((r) => r.id === 'pr_dup_2')).toMatchObject({ personId: 'p_dave' });
    // Dave's verified director role at ABC is untouched by the not-started duplicate.
    expect(s.personRoles.find((r) => r.id === 'pr_1')).toMatchObject({ identityVerification: 'verified', evidenceStatus: 'checked' });
    expect(s.activities[0]).toMatchObject({ kind: 'client_updated', message: '1 duplicate person merged (Dave Thompson).' });
    expect(s.auditEvents[0]).toMatchObject({ action: 'people.merge', after: { peopleRemoved: 1, groups: [{ kept: 'p_dave', removed: ['p_dave_dup'], clientIds: ['cl_abc', 'cl_greenfield'] }] } });
    expect(useAppStore.getState().unsaved).toBe(true);
  });

  it('does nothing — and saves nothing — when there are no duplicates', () => {
    useAppStore.getState().mergeDuplicatePeople();
    const afterFirst = useAppStore.getState().data;
    const activities = afterFirst.activities.length;
    useAppStore.setState({ unsaved: false });
    expect(useAppStore.getState().mergeDuplicatePeople()).toEqual({ peopleRemoved: 0, rolesMoved: 0, rolesCombined: 0 });
    expect(useAppStore.getState().data).toBe(afterFirst);
    expect(useAppStore.getState().data.activities).toHaveLength(activities);
    expect(useAppStore.getState().unsaved).toBe(false);
  });
});

describe('application store — generating corporation tax obligations', () => {
  beforeEach(() => {
    configureRepository(new MemoryRepository());
    const data = structuredClone(buildFixtureData(today));
    // The state a spreadsheet import leaves behind: a limited company with an
    // accounts obligation and no corporation tax anywhere.
    data.obligations = data.obligations.filter((o) => o.serviceCode !== 'corporation_tax');
    data.jobs = data.jobs.filter((j) => j.serviceCode !== 'corporation_tax');
    data.subscriptions = data.subscriptions.filter((sub) => sub.serviceCode !== 'corporation_tax');
    useAppStore.setState({ data, today, ready: true, currentUserId: 'u_adnan', toasts: [] });
  });

  it('creates a CT600 job per limited company as one saved change, with an activity and an audit entry', () => {
    const expected = findMissingCorporationTax(useAppStore.getState().data, today);
    expect(expected.length).toBeGreaterThan(0);

    const summary = useAppStore.getState().generateCorporationTaxObligations();
    expect(summary.jobsCreated).toBe(expected.length);
    expect(summary.clientsUpdated).toBe(expected.length);

    const s = useAppStore.getState().data;
    const created = s.jobs.filter((j) => j.serviceCode === 'corporation_tax');
    expect(created).toHaveLength(expected.length);
    for (const row of expected) {
      const job = created.find((j) => j.clientId === row.clientId)!;
      expect(job.dueDate).toBe(row.dueDate);
      expect(job.periodEnd).toBe(row.periodEnd);
      expect(s.requestItems.some((r) => r.jobId === job.id)).toBe(true);
      expect(s.subscriptions.some((sub) => sub.clientId === row.clientId && sub.serviceCode === 'corporation_tax')).toBe(true);
    }
    expect(s.activities[0]).toMatchObject({ kind: 'note', message: `Corporation tax added for ${expected.length} clients.` });
    expect(s.auditEvents[0]).toMatchObject({ action: 'obligations.corporation_tax', after: { jobsCreated: expected.length } });
    expect(useAppStore.getState().unsaved).toBe(true);
  });

  it('does nothing — and saves nothing — on a second run', () => {
    useAppStore.getState().generateCorporationTaxObligations();
    const afterFirst = useAppStore.getState().data;
    const activities = afterFirst.activities.length;
    useAppStore.setState({ unsaved: false });
    expect(useAppStore.getState().generateCorporationTaxObligations()).toEqual({ clientsUpdated: 0, jobsCreated: 0, overdueCreated: 0 });
    expect(useAppStore.getState().data).toBe(afterFirst);
    expect(useAppStore.getState().data.activities).toHaveLength(activities);
    expect(useAppStore.getState().unsaved).toBe(false);
  });
});

describe('application store — AML review and turnover', () => {
  beforeEach(() => {
    configureRepository(new MemoryRepository());
    useAppStore.setState({ data: structuredClone(buildFixtureData(today)), today, ready: true, currentUserId: 'u_adnan', toasts: [] });
  });

  it('records an AML review dated today, with the rating and note, and leaves an audit trail', () => {
    useAppStore.getState().recordAmlReview('cl_abc', { rating: 'high', note: '  Cash-heavy trade.  ' });
    const s = useAppStore.getState().data;
    expect(s.clients.find((c) => c.id === 'cl_abc')).toMatchObject({ amlRiskRating: 'high', amlLastReviewedOn: today, amlReviewNote: 'Cash-heavy trade.' });
    expect(s.activities[0]).toMatchObject({ kind: 'client_updated', clientId: 'cl_abc', message: 'AML review recorded for ABC Construction Ltd: high risk.' });
    expect(s.auditEvents[0]).toMatchObject({ action: 'client.aml_review', entityId: 'cl_abc', after: { amlRiskRating: 'high', amlLastReviewedOn: today } });
    expect(useAppStore.getState().unsaved).toBe(true);
  });

  it('records turnover dated today, rounds to whole pounds, and clears it on null', () => {
    useAppStore.getState().recordTurnover('cl_abc', 76_499.6);
    expect(useAppStore.getState().data.clients.find((c) => c.id === 'cl_abc')).toMatchObject({ rolling12MonthTurnover: 76_500, turnoverRecordedOn: today });
    useAppStore.getState().recordTurnover('cl_abc', null);
    const client = useAppStore.getState().data.clients.find((c) => c.id === 'cl_abc')!;
    expect(client.rolling12MonthTurnover).toBeUndefined();
    expect(client.turnoverRecordedOn).toBeUndefined();
  });

  it('ignores a negative or non-finite turnover rather than storing nonsense', () => {
    useAppStore.getState().recordTurnover('cl_abc', -1);
    expect(useAppStore.getState().data.clients.find((c) => c.id === 'cl_abc')!.rolling12MonthTurnover).toBeUndefined();
  });
});

describe('application store — applying client portal activity', () => {
  beforeEach(() => {
    configureRepository(new MemoryRepository());
    useAppStore.setState({ data: structuredClone(buildFixtureData(today)), today, ready: true, currentUserId: 'u_adnan', toasts: [] });
  });

  const base = { linkId: 'pl_1', clientId: 'cl_abc', jobId: 'job_abc_accounts', createdAt: '2026-09-12T10:00:00Z', decision: null, actorName: null, note: null, requestItemId: null, uploadId: null, fileName: null, sizeKb: null } as const;

  it('marks the requested item received through the ordinary action, keeping a handle to the stored file', () => {
    const item = useAppStore.getState().data.requestItems.find((i) => i.jobId === 'job_abc_accounts' && i.status !== 'received')!;
    const result = useAppStore.getState().applyPortalActivity([{ ...base, id: 'pa_1', kind: 'upload', requestItemId: item.id, uploadId: 'up_1', fileName: 'loan.pdf', sizeKb: 88 }]);
    expect(result).toEqual({ applied: ['pa_1'], skipped: [] });
    const after = useAppStore.getState().data;
    expect(after.requestItems.find((i) => i.id === item.id)).toMatchObject({ status: 'received' });
    const doc = after.documents.find((d) => d.portalUploadId === 'up_1');
    expect(doc).toMatchObject({ fileName: 'loan.pdf', source: 'portal', sizeKb: 88, jobId: 'job_abc_accounts' });
    expect(after.activities[0].message).toContain('received');
  });

  it('keeps a file sent against no particular request as a document on the job', () => {
    const before = useAppStore.getState().data.documents.length;
    const result = useAppStore.getState().applyPortalActivity([{ ...base, id: 'pa_2', kind: 'upload', uploadId: 'up_2', fileName: 'extra.pdf', sizeKb: 12 }]);
    expect(result.applied).toEqual(['pa_2']);
    const after = useAppStore.getState().data;
    expect(after.documents).toHaveLength(before + 1);
    expect(after.documents.find((d) => d.portalUploadId === 'up_2')).toMatchObject({ source: 'portal', documentType: 'Other' });
  });

  it('records a client approval exactly as an accountant would, moving the job on', () => {
    const data = useAppStore.getState().data;
    const job = data.jobs.find((j) => j.status === 'waiting_client_approval')!;
    const result = useAppStore.getState().applyPortalActivity([{ ...base, id: 'pa_3', clientId: job.clientId, jobId: job.id, kind: 'approval', decision: 'approved', actorName: 'Jane Smith', note: 'Fine.' }]);
    expect(result.applied).toEqual(['pa_3']);
    const after = useAppStore.getState().data;
    expect(after.jobs.find((j) => j.id === job.id)).toMatchObject({ status: 'ready_to_file', waitingOn: 'nothing' });
    expect(after.approvals.find((a) => a.jobId === job.id && a.kind === 'client')).toMatchObject({ status: 'approved', reviewerName: 'Jane Smith (via portal)', note: 'Fine.' });
  });

  it('skips activity for a job it cannot match, and reports it so it is not offered forever', () => {
    const result = useAppStore.getState().applyPortalActivity([
      { ...base, id: 'pa_4', jobId: 'job_gone', kind: 'upload', uploadId: 'up_4', fileName: 'x.pdf', sizeKb: 1 },
      { ...base, id: 'pa_5', clientId: 'cl_wrong', kind: 'upload', uploadId: 'up_5', fileName: 'y.pdf', sizeKb: 1 },
    ]);
    expect(result).toEqual({ applied: [], skipped: ['pa_4', 'pa_5'] });
  });
});

describe('application store — identity verification confirmed by Companies House', () => {
  beforeEach(() => {
    configureRepository(new MemoryRepository());
    useAppStore.setState({ data: structuredClone(buildFixtureData(today)), today, ready: true, currentUserId: 'u_adnan', toasts: [] });
  });

  const olivia = () => useAppStore.getState().data.personRoles.filter((r) => r.personId === 'p_olivia');
  const verified = (name: string, role: 'director' | 'psc' = 'director') => ({ ...chPerson(name, role), identityVerification: { verifiedOn: '2026-03-04', statementDueOn: null, verifiedBy: null } });

  it('marks an existing not-started role verified when Companies House says so, with an activity and an audit entry', () => {
    expect(olivia().map((r) => r.identityVerification)).toEqual(['not_started', 'not_started']);
    const result = useAppStore.getState().refreshClientFromCompaniesHouse('cl_greenfield', profileFor('09876543', 'Somewhere'), {
      directors: [verified('GREENFIELD, Olivia')],
      pscs: [verified('Mrs Olivia Greenfield', 'psc')],
      source: 'companies_house',
    });
    expect(result).toEqual({ peopleAdded: 0, verificationsConfirmed: 2 });
    for (const role of olivia()) {
      expect(role).toMatchObject({ identityVerification: 'verified', identityVerificationSource: 'companies_house', identityVerifiedOn: '2026-03-04' });
      // Companies House confirms identity, not that the practice captured a personal code or checked evidence.
      expect(role.personalCodeCaptured).toBe(false);
      expect(role.evidenceStatus).toBe('requested');
    }
    const s = useAppStore.getState().data;
    expect(s.activities.map((a) => a.message)).toContain('Olivia Greenfield (director) identity verification confirmed by Companies House for Greenfield Design Ltd.');
    expect(s.activities[0].message).toContain('2 identity verifications confirmed');
    expect(s.auditEvents.filter((e) => e.action === 'person_role.verification')).toHaveLength(2);
    expect(s.auditEvents.find((e) => e.action === 'person_role.verification')?.after).toMatchObject({ identityVerification: 'verified', source: 'companies_house', verifiedOn: '2026-03-04' });
    // It clears the Needs Attention flag on the client's confirmation statement,
    // which fired before the refresh (Olivia's two roles were not started).
    const flagged = (data: typeof s) => computeDerived(data, today).attention.filter((a) => a.clientId === 'cl_greenfield' && a.ruleCode === 'identity_incomplete');
    expect(flagged(buildFixtureData(today))).toHaveLength(1);
    expect(flagged(s)).toEqual([]);
  });

  it('records what Companies House said about every role it matched — a date, a due date, or nothing', () => {
    useAppStore.getState().refreshClientFromCompaniesHouse('cl_greenfield', null, {
      directors: [
        { ...chPerson('GREENFIELD, Olivia'), identityVerification: { verifiedOn: null, statementDueOn: '2026-10-05', verifiedBy: null } },
        chPerson('GREENFIELD, Tom'),
      ],
      pscs: [{ ...chPerson('Mrs Olivia Greenfield', 'psc'), identityVerification: { verifiedOn: '2026-03-04', statementDueOn: null, verifiedBy: null } }],
      source: 'companies_house',
    });
    const roles = useAppStore.getState().data.personRoles;
    expect(roles.find((r) => r.id === 'pr_9')?.companiesHouseVerification).toMatchObject({ verifiedOn: null, dueOn: '2026-10-05' });
    expect(roles.find((r) => r.id === 'pr_10')?.companiesHouseVerification).toMatchObject({ verifiedOn: '2026-03-04', dueOn: null });
    expect(roles.find((r) => r.id === 'pr_8')?.companiesHouseVerification).toMatchObject({ verifiedOn: null, dueOn: null });
    expect(roles.find((r) => r.id === 'pr_8')?.companiesHouseVerification?.checkedAt).toBeTruthy();
    // A due date alone never changes the practice's status.
    expect(roles.find((r) => r.id === 'pr_9')?.identityVerification).toBe('not_started');
  });

  it('never downgrades: Companies House saying nothing leaves a status alone, and a hand-set status is kept', () => {
    useAppStore.getState().updatePersonRoleVerification('pr_9', 'in_progress');
    useAppStore.getState().refreshClientFromCompaniesHouse('cl_greenfield', null, {
      directors: [chPerson('GREENFIELD, Olivia'), { ...chPerson('GREENFIELD, Tom'), identityVerification: { verifiedOn: null, statementDueOn: '2026-12-01', verifiedBy: null } }],
      pscs: [],
      source: 'companies_house',
    });
    expect(useAppStore.getState().data.personRoles.find((r) => r.id === 'pr_9')).toMatchObject({ identityVerification: 'in_progress', identityVerificationSource: 'practice' });
    expect(useAppStore.getState().data.personRoles.find((r) => r.id === 'pr_8')!.identityVerification).toBe('verified'); // Tom, verified by hand in the fixture
    expect(useAppStore.getState().data.auditEvents.filter((e) => e.action === 'person_role.verification' && (e.after as { source?: string }).source === 'companies_house')).toEqual([]);
  });

  it('records a newly added role as verified straight away when Companies House already says so', () => {
    const result = useAppStore.getState().refreshClientFromCompaniesHouse('cl_greenfield', null, {
      directors: [verified('NEWLY, Verified')],
      pscs: [],
      source: 'companies_house',
    });
    expect(result).toEqual({ peopleAdded: 1, verificationsConfirmed: 1 });
    const person = useAppStore.getState().data.people.find((p) => p.fullName === 'Verified Newly')!;
    expect(useAppStore.getState().data.personRoles.find((r) => r.personId === person.id)).toMatchObject({ identityVerification: 'verified', identityVerificationSource: 'companies_house' });
  });

  it('a later change by hand takes over from the Companies House confirmation', () => {
    useAppStore.getState().refreshClientFromCompaniesHouse('cl_greenfield', null, { directors: [verified('GREENFIELD, Olivia')], pscs: [], source: 'companies_house' });
    useAppStore.getState().updatePersonRoleVerification('pr_9', 'expired');
    const role = useAppStore.getState().data.personRoles.find((r) => r.id === 'pr_9')!;
    expect(role).toMatchObject({ identityVerification: 'expired', identityVerificationSource: 'practice' });
    expect(role.identityVerifiedOn).toBeUndefined();
  });
});

describe('application store — timing thresholds (Settings)', () => {
  beforeEach(() => {
    configureRepository(new MemoryRepository());
    useAppStore.setState({ data: buildFixtureData(today), today, ready: true, currentUserId: 'u_adnan', toasts: [] });
  });

  it('merges a patch into the practice thresholds, leaving fields not mentioned untouched, as one saved change', () => {
    expect(useAppStore.getState().data.practice.thresholds).toBeUndefined();
    useAppStore.getState().updatePracticeThresholds({ staleJobDays: 21 });
    expect(useAppStore.getState().data.practice.thresholds).toEqual({ staleJobDays: 21 });
    expect(useAppStore.getState().unsaved).toBe(true);

    useAppStore.getState().updatePracticeThresholds({ reviewWaitDays: 5 });
    expect(useAppStore.getState().data.practice.thresholds).toEqual({ staleJobDays: 21, reviewWaitDays: 5 });

    const s = useAppStore.getState().data;
    expect(s.activities[0]).toMatchObject({ kind: 'note', message: 'Timing thresholds updated.' });
    expect(s.auditEvents[0]).toMatchObject({ action: 'practice.thresholds', before: { staleJobDays: 21 }, after: { staleJobDays: 21, reviewWaitDays: 5 } });
  });

  it('overwrites an existing value for a field named again', () => {
    useAppStore.getState().updatePracticeThresholds({ dueSoonDays: 21 });
    useAppStore.getState().updatePracticeThresholds({ dueSoonDays: 7 });
    expect(useAppStore.getState().data.practice.thresholds).toEqual({ dueSoonDays: 7 });
  });

  it('drops an invalid value from the patch and keeps the well-formed ones, never touching or saving anything when the whole patch is bad', () => {
    useAppStore.getState().updatePracticeThresholds({ dueSoonDays: 10, staleJobDays: -1 });
    expect(useAppStore.getState().data.practice.thresholds).toEqual({ dueSoonDays: 10 });

    useAppStore.setState({ unsaved: false });
    const activitiesBefore = useAppStore.getState().data.activities.length;
    useAppStore.getState().updatePracticeThresholds({ approvalWaitDays: 0, reviewWaitDays: 3.5 });
    expect(useAppStore.getState().data.practice.thresholds).toEqual({ dueSoonDays: 10 });
    expect(useAppStore.getState().data.activities.length).toBe(activitiesBefore);
    expect(useAppStore.getState().unsaved).toBe(false);
  });
});
