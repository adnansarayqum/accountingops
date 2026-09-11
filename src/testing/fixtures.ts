/**
 * Test-fixture dataset used by unit tests and e2e scenarios. Every record
 * is fictional. This is NOT loaded by the app itself — a real practice
 * always starts empty (see `src/application/emptyState.ts`) — it exists
 * purely so tests have a rich, realistic, deterministic dataset to run
 * against without repeating the same fixture-building logic everywhere.
 *
 * Dates are generated relative to `today` so the fixture never goes stale.
 * The dataset is built as *stories*, not random rows: each client exists to
 * demonstrate a specific operational condition (see docs/TEST_SCENARIOS.md).
 */
import { addDays, addMonths, isoDateTimeDaysAgo } from '../domain/dates';
import { buildReminderSequences, SERVICES } from '../domain/catalog';
import type {
  Activity,
  Approval,
  Channel,
  Client,
  ClientIdentifier,
  ClientType,
  Communication,
  Contact,
  Document,
  FilingRecord,
  IdentifierKind,
  InboxItem,
  InformationRequestItem,
  IsoDate,
  Job,
  JobStatus,
  MtdReadiness,
  Notification,
  Obligation,
  OnboardingCase,
  OnboardingStage,
  Person,
  PersonRole,
  PracticeData,
  ServiceCode,
  ServiceSubscription,
  User,
  WaitingOn,
} from '../domain/types';

export const FIXTURE_PRACTICE_ID = 'prac_fixture';

export const FIXTURE_USERS: User[] = [
  { id: 'u_adnan', practiceId: FIXTURE_PRACTICE_ID, name: 'Adnan Sarayqum', initials: 'AS', role: 'owner', weeklyCapacityHours: 32, colour: 'blue' },
  { id: 'u_sarah', practiceId: FIXTURE_PRACTICE_ID, name: 'Sarah Mitchell', initials: 'SM', role: 'manager', weeklyCapacityHours: 36, colour: 'violet' },
  { id: 'u_michael', practiceId: FIXTURE_PRACTICE_ID, name: 'Michael Okafor', initials: 'MO', role: 'accountant', weeklyCapacityHours: 36, colour: 'emerald' },
  { id: 'u_priya', practiceId: FIXTURE_PRACTICE_ID, name: 'Priya Shah', initials: 'PS', role: 'accountant', weeklyCapacityHours: 16, colour: 'amber' },
];

const FIXTURE_REMINDER_SEQUENCES = buildReminderSequences(FIXTURE_PRACTICE_ID);

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

interface ClientSpec {
  id: string;
  name: string;
  type: ClientType;
  owner: string;
  backup?: string;
  contact: { name: string; role: string; email: string; phone: string; whatsapp?: boolean };
  extraContacts?: { name: string; role: string; email: string; phone: string }[];
  preferred: Channel;
  yearEnd?: string;
  sector?: string;
  avgResponse: number;
  identifiers: Partial<Record<IdentifierKind, string>>;
  services: ServiceCode[];
  lifecycle?: Client['lifecycle'];
  createdDaysAgo: number;
  notes?: string;
}

interface JobSpec {
  id: string;
  client: string;
  service: ServiceCode;
  /** Days from today until due. */
  dueIn: number;
  status: JobStatus;
  waitingOn?: WaitingOn;
  assignee?: string;
  reviewer?: string;
  hours?: number;
  /** Days ago the status last changed. */
  changedDaysAgo: number;
  /** Requirement labels with their status. Defaults to service defaults, all missing. */
  docs?: { label: string; status: 'missing' | 'requested' | 'received'; receivedDaysAgo?: number }[];
  filedDaysAgo?: number;
  chasingPaused?: boolean;
  periodMonths?: number;
  /** Override period end (days from today). Defaults derived from due date. */
  periodEndIn?: number;
}

export function buildFixtureData(today: IsoDate): PracticeData {
  const ago = (days: number, hour = 9, minute = 0) => isoDateTimeDaysAgo(today, days, hour, minute);
  const inDays = (n: number) => addDays(today, n);

  const clientSpecs: ClientSpec[] = [
    {
      id: 'cl_abc',
      name: 'ABC Construction Ltd',
      type: 'limited_company',
      owner: 'u_adnan',
      backup: 'u_sarah',
      contact: { name: 'Dave Thompson', role: 'Director', email: 'dave@abc-construction.example', phone: '07700 900123', whatsapp: true },
      extraContacts: [{ name: 'Lisa Thompson', role: 'Company secretary', email: 'lisa@abc-construction.example', phone: '07700 900124' }],
      preferred: 'whatsapp',
      yearEnd: '31 December',
      sector: 'Construction',
      avgResponse: 11,
      identifiers: { utr: '1234567890', company_number: '09876543', vat_number: 'GB123456789', paye_reference: '123/AB45678', accounts_office_ref: '123PA00045678' },
      services: ['annual_accounts', 'corporation_tax', 'vat', 'payroll', 'confirmation_statement'],
      createdDaysAgo: 900,
      notes: 'Prefers WhatsApp. Dave is on site most days — best reached after 4pm.',
    },
    {
      id: 'cl_khan',
      name: 'Khan Consulting Ltd',
      type: 'limited_company',
      owner: 'u_sarah',
      backup: 'u_michael',
      contact: { name: 'Amira Khan', role: 'Director', email: 'amira@khanconsulting.example', phone: '07700 900201', whatsapp: true },
      preferred: 'email',
      yearEnd: '31 March',
      sector: 'IT consultancy',
      avgResponse: 2,
      identifiers: { utr: '2345678901', company_number: '11223344', vat_number: 'GB234567890', paye_reference: '120/KC12345' },
      services: ['annual_accounts', 'corporation_tax', 'vat', 'payroll', 'confirmation_statement'],
      createdDaysAgo: 700,
    },
    {
      id: 'cl_brown',
      name: 'Brown Property Ltd',
      type: 'limited_company',
      owner: 'u_michael',
      backup: 'u_adnan',
      contact: { name: 'Gareth Brown', role: 'Director', email: 'gareth@brownproperty.example', phone: '07700 900310', whatsapp: true },
      preferred: 'email',
      yearEnd: '30 November',
      sector: 'Property investment',
      avgResponse: 6,
      identifiers: { utr: '3456789012', company_number: '10293847', vat_number: 'GB345678901' },
      services: ['annual_accounts', 'corporation_tax', 'confirmation_statement'],
      createdDaysAgo: 1200,
    },
    {
      id: 'cl_greenfield',
      name: 'Greenfield Design Ltd',
      type: 'limited_company',
      owner: 'u_priya',
      backup: 'u_sarah',
      contact: { name: 'Tom Greenfield', role: 'Director', email: 'tom@greenfielddesign.example', phone: '07700 900415', whatsapp: true },
      preferred: 'email',
      yearEnd: '30 June',
      sector: 'Design agency',
      avgResponse: 4,
      identifiers: { utr: '4567890123', company_number: '12345678', vat_number: 'GB456789012', paye_reference: '475/GD98765' },
      services: ['annual_accounts', 'corporation_tax', 'vat', 'payroll', 'confirmation_statement'],
      createdDaysAgo: 400,
    },
    {
      id: 'cl_malik',
      name: 'Sarah Malik',
      type: 'sole_trader',
      owner: 'u_priya',
      backup: 'u_michael',
      contact: { name: 'Sarah Malik', role: 'Proprietor', email: 'sarah@malikphysio.example', phone: '07700 900520', whatsapp: true },
      preferred: 'whatsapp',
      yearEnd: '5 April',
      sector: 'Physiotherapy',
      avgResponse: 5,
      identifiers: { utr: '5678901234', nino: 'QQ123456C' },
      services: ['self_assessment', 'mtd_income_tax'],
      createdDaysAgo: 600,
    },
    {
      id: 'cl_northern',
      name: 'Northern Foods Ltd',
      type: 'limited_company',
      owner: 'u_sarah',
      backup: 'u_adnan',
      contact: { name: 'Helen Fraser', role: 'Finance manager', email: 'helen.fraser@northernfoods.example', phone: '07700 900630', whatsapp: false },
      extraContacts: [{ name: 'Robert Fraser', role: 'Managing director', email: 'robert@northernfoods.example', phone: '07700 900631' }],
      preferred: 'email',
      yearEnd: '31 March',
      sector: 'Food manufacturing',
      avgResponse: 1,
      identifiers: { utr: '6789012345', company_number: '07654321', vat_number: 'GB567890123', paye_reference: '951/NF44556', accounts_office_ref: '951PB00044556' },
      services: ['annual_accounts', 'corporation_tax', 'vat', 'payroll', 'confirmation_statement', 'bookkeeping_review'],
      createdDaysAgo: 1500,
      notes: 'Largest client. Monthly payroll for 42 staff. Helen is very organised.',
    },
    {
      id: 'cl_patel',
      name: 'Patel & Daughters',
      type: 'partnership',
      owner: 'u_michael',
      backup: 'u_priya',
      contact: { name: 'Raj Patel', role: 'Partner', email: 'raj@patelpharmacy.example', phone: '07700 900740', whatsapp: true },
      extraContacts: [{ name: 'Nisha Patel', role: 'Partner', email: 'nisha@patelpharmacy.example', phone: '07700 900741' }],
      preferred: 'sms',
      yearEnd: '31 December',
      sector: 'Pharmacy',
      avgResponse: 19,
      identifiers: { utr: '7890123456', vat_number: 'GB678901234', paye_reference: '083/PD11223' },
      services: ['annual_accounts', 'vat', 'payroll', 'self_assessment'],
      createdDaysAgo: 2000,
      notes: 'Chronically late with records. Raj responds to SMS but rarely to email.',
    },
    {
      id: 'cl_whitfield',
      name: 'James Whitfield',
      type: 'landlord',
      owner: 'u_adnan',
      backup: 'u_priya',
      contact: { name: 'James Whitfield', role: 'Landlord', email: 'james.whitfield@example.com', phone: '07700 900850', whatsapp: true },
      preferred: 'email',
      yearEnd: '5 April',
      sector: 'Residential lettings (4 properties)',
      avgResponse: 2,
      identifiers: { utr: '8901234567', nino: 'AB123456D' },
      services: ['self_assessment', 'mtd_income_tax'],
      createdDaysAgo: 800,
    },
    {
      id: 'cl_carter',
      name: 'Dr Emily Carter',
      type: 'individual',
      owner: 'u_priya',
      contact: { name: 'Emily Carter', role: 'Client', email: 'emily.carter@example.com', phone: '07700 900960', whatsapp: false },
      preferred: 'email',
      yearEnd: '5 April',
      sector: 'GP locum / company director',
      avgResponse: 3,
      identifiers: { utr: '9012345678', nino: 'CD654321A' },
      services: ['self_assessment'],
      createdDaysAgo: 300,
    },
    {
      id: 'cl_oakwood',
      name: 'Oakwood Joinery Ltd',
      type: 'limited_company',
      owner: 'u_michael',
      backup: 'u_sarah',
      contact: { name: 'Steve Oakes', role: 'Director', email: 'steve@oakwoodjoinery.example', phone: '07700 901070', whatsapp: true },
      preferred: 'whatsapp',
      yearEnd: '31 August',
      sector: 'Joinery',
      avgResponse: 8,
      identifiers: { utr: '1122334455', company_number: '13579246', vat_number: 'GB789012345', paye_reference: '577/OJ33445' },
      services: ['annual_accounts', 'corporation_tax', 'vat', 'payroll', 'confirmation_statement'],
      createdDaysAgo: 500,
    },
    {
      id: 'cl_hartley',
      name: 'Hartley Bakery Ltd',
      type: 'limited_company',
      owner: 'u_priya',
      backup: 'u_michael',
      contact: { name: 'Jo Hartley', role: 'Director', email: 'jo@hartleybakery.example', phone: '07700 901180', whatsapp: true },
      preferred: 'email',
      yearEnd: '31 January',
      sector: 'Bakery',
      avgResponse: 3,
      identifiers: { utr: '2233445566', company_number: '14680235', vat_number: 'GB890123456', paye_reference: '120/HB55667' },
      services: ['annual_accounts', 'corporation_tax', 'vat', 'payroll', 'confirmation_statement'],
      createdDaysAgo: 650,
    },
    {
      id: 'cl_lumen',
      name: 'Lumen Digital Ltd',
      type: 'limited_company',
      owner: 'u_michael',
      backup: 'u_adnan',
      contact: { name: 'Chloe Adams', role: 'Director', email: 'chloe@lumendigital.example', phone: '07700 901290', whatsapp: true },
      preferred: 'email',
      yearEnd: '31 October',
      sector: 'Software',
      avgResponse: 4,
      identifiers: { utr: '3344556677', company_number: '15791357', vat_number: 'GB901234567' },
      services: ['annual_accounts', 'corporation_tax', 'vat', 'confirmation_statement'],
      createdDaysAgo: 350,
    },
    {
      id: 'cl_fenwick',
      name: 'Fenwick Plumbing',
      type: 'sole_trader',
      owner: 'u_adnan',
      backup: 'u_michael',
      contact: { name: 'Mark Fenwick', role: 'Proprietor', email: 'mark@fenwickplumbing.example', phone: '07700 901300', whatsapp: true },
      preferred: 'whatsapp',
      yearEnd: '5 April',
      sector: 'Plumbing & heating',
      avgResponse: 3,
      identifiers: { utr: '4455667788', nino: 'EF987654B', vat_number: 'GB012345678' },
      services: ['self_assessment', 'vat', 'mtd_income_tax'],
      createdDaysAgo: 450,
    },
    {
      id: 'cl_ashby',
      name: 'Peter & Anne Ashby',
      type: 'landlord',
      owner: 'u_sarah',
      contact: { name: 'Anne Ashby', role: 'Landlord', email: 'anne.ashby@example.com', phone: '07700 901410', whatsapp: false },
      preferred: 'email',
      yearEnd: '5 April',
      sector: 'Holiday lets (2 properties)',
      avgResponse: 2,
      identifiers: { utr: '5566778899', nino: 'GH246810C' },
      services: ['self_assessment'],
      createdDaysAgo: 1100,
    },
    {
      id: 'cl_bluebell',
      name: 'Bluebell Nursery Ltd',
      type: 'limited_company',
      owner: 'u_priya',
      contact: { name: 'Rachel Moore', role: 'Director', email: 'rachel@bluebellnursery.example', phone: '07700 901520', whatsapp: true },
      preferred: 'email',
      yearEnd: '31 August',
      sector: 'Childcare',
      avgResponse: 3,
      identifiers: { company_number: '16135791' },
      services: ['annual_accounts', 'corporation_tax', 'payroll'],
      lifecycle: 'onboarding',
      createdDaysAgo: 9,
    },
    {
      id: 'cl_summit',
      name: 'Summit Fitness Ltd',
      type: 'limited_company',
      owner: 'u_michael',
      contact: { name: 'Ben Carver', role: 'Director', email: 'ben@summitfitness.example', phone: '07700 901630', whatsapp: true },
      preferred: 'whatsapp',
      yearEnd: '31 December',
      sector: 'Gym',
      avgResponse: 2,
      identifiers: { utr: '6677889900', company_number: '17246802', vat_number: 'GB112233445' },
      services: ['annual_accounts', 'corporation_tax', 'vat'],
      lifecycle: 'onboarding',
      createdDaysAgo: 24,
    },
    {
      id: 'cl_meadow',
      name: 'Meadow Vets Ltd',
      type: 'limited_company',
      owner: 'u_sarah',
      backup: 'u_priya',
      contact: { name: 'Dr Alan Reid', role: 'Director', email: 'alan@meadowvets.example', phone: '07700 901740', whatsapp: false },
      preferred: 'email',
      yearEnd: '30 September',
      sector: 'Veterinary practice',
      avgResponse: 2,
      identifiers: { utr: '7788990011', company_number: '18357913', vat_number: 'GB223344556', paye_reference: '846/MV77889' },
      services: ['annual_accounts', 'corporation_tax', 'vat', 'payroll', 'confirmation_statement'],
      createdDaysAgo: 950,
    },
    {
      id: 'cl_crescent',
      name: 'Crescent Café Ltd',
      type: 'limited_company',
      owner: 'u_adnan',
      backup: 'u_priya',
      contact: { name: 'Yusuf Demir', role: 'Director', email: 'yusuf@crescentcafe.example', phone: '07700 901850', whatsapp: true },
      preferred: 'whatsapp',
      yearEnd: '31 January',
      sector: 'Hospitality',
      avgResponse: 9,
      identifiers: { utr: '8899001122', company_number: '19468024', vat_number: 'GB334455667', paye_reference: '120/CC99001' },
      services: ['annual_accounts', 'corporation_tax', 'vat', 'payroll'],
      createdDaysAgo: 280,
    },
  ];

  const clients: Client[] = [];
  const contacts: Contact[] = [];
  const identifiers: ClientIdentifier[] = [];
  const subscriptions: ServiceSubscription[] = [];

  for (const s of clientSpecs) {
    const primaryId = `ct_${s.id.slice(3)}_1`;
    clients.push({
      id: s.id,
      practiceId: FIXTURE_PRACTICE_ID,
      name: s.name,
      type: s.type,
      lifecycle: s.lifecycle ?? 'active',
      ownerUserId: s.owner,
      backupOwnerUserId: s.backup,
      primaryContactId: primaryId,
      preferredChannel: s.preferred,
      yearEnd: s.yearEnd,
      sector: s.sector,
      notes: s.notes,
      averageResponseDays: s.avgResponse,
      createdAt: ago(s.createdDaysAgo),
    });
    contacts.push({
      id: primaryId,
      practiceId: FIXTURE_PRACTICE_ID,
      clientId: s.id,
      name: s.contact.name,
      role: s.contact.role,
      email: s.contact.email,
      phone: s.contact.phone,
      whatsapp: s.contact.whatsapp === false ? undefined : s.contact.phone,
      isPrimary: true,
    });
    s.extraContacts?.forEach((c, i) => {
      contacts.push({ id: `ct_${s.id.slice(3)}_${i + 2}`, practiceId: FIXTURE_PRACTICE_ID, clientId: s.id, name: c.name, role: c.role, email: c.email, phone: c.phone, isPrimary: false });
    });
    for (const [kind, value] of Object.entries(s.identifiers) as [IdentifierKind, string][]) {
      identifiers.push({ id: `idf_${s.id.slice(3)}_${kind}`, practiceId: FIXTURE_PRACTICE_ID, clientId: s.id, kind, value, sensitive: kind !== 'company_number' });
    }
    for (const code of s.services) {
      subscriptions.push({ id: `sub_${s.id.slice(3)}_${code}`, practiceId: FIXTURE_PRACTICE_ID, clientId: s.id, serviceCode: code, startedOn: inDays(-s.createdDaysAgo), active: true });
    }
  }

  // -------------------------------------------------------------------------
  // Jobs
  // -------------------------------------------------------------------------
  const jobSpecs: JobSpec[] = [
    // ABC Construction — primary showcase
    {
      id: 'job_abc_accounts',
      client: 'cl_abc',
      service: 'annual_accounts',
      dueIn: 12,
      status: 'waiting_for_records',
      assignee: 'u_adnan',
      hours: 14,
      changedDaysAgo: 34,
      docs: [
        { label: 'Bank statements', status: 'received', receivedDaysAgo: 21 },
        { label: 'Sales invoices', status: 'received', receivedDaysAgo: 21 },
        { label: 'Payroll records', status: 'received', receivedDaysAgo: 18 },
        { label: 'Purchase invoices', status: 'received', receivedDaysAgo: 16 },
        { label: 'Loan statement', status: 'requested' },
        { label: 'Director expenses', status: 'requested' },
      ],
    },
    { id: 'job_abc_ct', client: 'cl_abc', service: 'corporation_tax', dueIn: 102, status: 'waiting_for_records', waitingOn: 'accountant', assignee: 'u_adnan', changedDaysAgo: 34, docs: [{ label: 'Approved accounts', status: 'missing' }, { label: 'Capital allowances schedule', status: 'received', receivedDaysAgo: 10 }] },
    { id: 'job_abc_vat', client: 'cl_abc', service: 'vat', dueIn: 26, status: 'in_progress', assignee: 'u_priya', changedDaysAgo: 3, docs: [{ label: 'Sales invoices', status: 'received', receivedDaysAgo: 4 }, { label: 'Purchase invoices', status: 'received', receivedDaysAgo: 4 }, { label: 'Bank statements', status: 'received', receivedDaysAgo: 4 }] },
    { id: 'job_abc_payroll', client: 'cl_abc', service: 'payroll', dueIn: 8, status: 'ready_to_start', assignee: 'u_priya', hours: 4, changedDaysAgo: 2, docs: [{ label: 'Timesheets', status: 'received', receivedDaysAgo: 2 }, { label: 'Starter/leaver forms', status: 'received', receivedDaysAgo: 2 }] },
    { id: 'job_abc_payroll_prev', client: 'cl_abc', service: 'payroll', dueIn: -22, status: 'filed', assignee: 'u_priya', changedDaysAgo: 25, filedDaysAgo: 25, docs: [{ label: 'Timesheets', status: 'received', receivedDaysAgo: 30 }] },
    { id: 'job_abc_cs', client: 'cl_abc', service: 'confirmation_statement', dueIn: 140, status: 'ready_to_start', assignee: 'u_adnan', changedDaysAgo: 5, docs: [{ label: 'Director confirmation', status: 'received', receivedDaysAgo: 5 }, { label: 'PSC confirmation', status: 'received', receivedDaysAgo: 5 }, { label: 'Registered office check', status: 'received', receivedDaysAgo: 5 }] },
    { id: 'job_abc_accounts_prev', client: 'cl_abc', service: 'annual_accounts', dueIn: -353, status: 'filed', assignee: 'u_adnan', changedDaysAgo: 360, filedDaysAgo: 360, docs: [{ label: 'Bank statements', status: 'received', receivedDaysAgo: 400 }] },

    // Khan Consulting — VAT ready to file
    { id: 'job_khan_vat', client: 'cl_khan', service: 'vat', dueIn: 6, status: 'ready_to_file', assignee: 'u_sarah', reviewer: 'u_adnan', changedDaysAgo: 1, docs: [{ label: 'Sales invoices', status: 'received', receivedDaysAgo: 9 }, { label: 'Purchase invoices', status: 'received', receivedDaysAgo: 9 }, { label: 'Bank statements', status: 'received', receivedDaysAgo: 9 }] },
    { id: 'job_khan_accounts', client: 'cl_khan', service: 'annual_accounts', dueIn: 110, status: 'in_progress', assignee: 'u_sarah', changedDaysAgo: 6, docs: [{ label: 'Bank statements', status: 'received', receivedDaysAgo: 12 }, { label: 'Sales invoices', status: 'received', receivedDaysAgo: 12 }, { label: 'Purchase invoices', status: 'received', receivedDaysAgo: 12 }, { label: 'Payroll records', status: 'received', receivedDaysAgo: 12 }] },
    { id: 'job_khan_payroll', client: 'cl_khan', service: 'payroll', dueIn: 8, status: 'in_progress', assignee: 'u_priya', changedDaysAgo: 1, docs: [{ label: 'Timesheets', status: 'received', receivedDaysAgo: 1 }] },
    { id: 'job_khan_vat_prev', client: 'cl_khan', service: 'vat', dueIn: -85, status: 'filed', assignee: 'u_sarah', changedDaysAgo: 90, filedDaysAgo: 90, docs: [{ label: 'Sales invoices', status: 'received', receivedDaysAgo: 100 }] },
    { id: 'job_khan_cs', client: 'cl_khan', service: 'confirmation_statement', dueIn: 75, status: 'waiting_for_records', assignee: 'u_sarah', changedDaysAgo: 4, docs: [{ label: 'Director confirmation', status: 'missing' }, { label: 'PSC confirmation', status: 'missing' }, { label: 'Registered office check', status: 'received', receivedDaysAgo: 4 }] },

    // Brown Property — waiting for client approval
    { id: 'job_brown_accounts', client: 'cl_brown', service: 'annual_accounts', dueIn: 20, status: 'waiting_client_approval', assignee: 'u_michael', reviewer: 'u_adnan', changedDaysAgo: 11, hours: 10, docs: [{ label: 'Bank statements', status: 'received', receivedDaysAgo: 40 }, { label: 'Rental income schedule', status: 'received', receivedDaysAgo: 40 }, { label: 'Mortgage statements', status: 'received', receivedDaysAgo: 35 }, { label: 'Purchase invoices', status: 'received', receivedDaysAgo: 35 }] },
    { id: 'job_brown_ct', client: 'cl_brown', service: 'corporation_tax', dueIn: 110, status: 'waiting_for_records', waitingOn: 'accountant', assignee: 'u_michael', changedDaysAgo: 11, docs: [{ label: 'Approved accounts', status: 'missing' }] },
    { id: 'job_brown_cs', client: 'cl_brown', service: 'confirmation_statement', dueIn: -40, status: 'filed', assignee: 'u_michael', changedDaysAgo: 44, filedDaysAgo: 44, docs: [{ label: 'Director confirmation', status: 'received', receivedDaysAgo: 50 }] },

    // Greenfield Design — identity verification blocker
    { id: 'job_greenfield_cs', client: 'cl_greenfield', service: 'confirmation_statement', dueIn: 18, status: 'in_progress', assignee: 'u_priya', changedDaysAgo: 6, docs: [{ label: 'Director confirmation', status: 'received', receivedDaysAgo: 6 }, { label: 'PSC confirmation', status: 'received', receivedDaysAgo: 6 }, { label: 'Registered office check', status: 'received', receivedDaysAgo: 6 }] },
    { id: 'job_greenfield_vat', client: 'cl_greenfield', service: 'vat', dueIn: 26, status: 'waiting_for_records', assignee: 'u_priya', changedDaysAgo: 8, docs: [{ label: 'Sales invoices', status: 'received', receivedDaysAgo: 3 }, { label: 'Purchase invoices', status: 'requested' }, { label: 'Bank statements', status: 'received', receivedDaysAgo: 3 }] },
    { id: 'job_greenfield_accounts', client: 'cl_greenfield', service: 'annual_accounts', dueIn: 200, status: 'waiting_for_records', assignee: 'u_priya', changedDaysAgo: 30, docs: [{ label: 'Bank statements', status: 'missing' }, { label: 'Sales invoices', status: 'missing' }, { label: 'Purchase invoices', status: 'missing' }, { label: 'Payroll records', status: 'missing' }] },
    { id: 'job_greenfield_payroll', client: 'cl_greenfield', service: 'payroll', dueIn: 8, status: 'ready_to_start', assignee: 'u_priya', hours: 4, changedDaysAgo: 1, docs: [{ label: 'Timesheets', status: 'received', receivedDaysAgo: 1 }] },

    // Sarah Malik — MTD readiness, SA
    { id: 'job_malik_sa', client: 'cl_malik', service: 'self_assessment', dueIn: 142, status: 'waiting_for_records', assignee: 'u_priya', changedDaysAgo: 40, docs: [{ label: 'Income summary', status: 'received', receivedDaysAgo: 12 }, { label: 'Expense summary', status: 'requested' }, { label: 'Bank interest', status: 'requested' }, { label: 'Pension contributions', status: 'requested' }] },
    { id: 'job_malik_mtd', client: 'cl_malik', service: 'mtd_income_tax', dueIn: 56, status: 'waiting_for_records', assignee: 'u_priya', changedDaysAgo: 10, docs: [{ label: 'Income summary', status: 'missing' }, { label: 'Expense summary', status: 'missing' }, { label: 'Bank statements', status: 'missing' }] },
    { id: 'job_malik_sa_prev', client: 'cl_malik', service: 'self_assessment', dueIn: -223, status: 'filed', assignee: 'u_priya', changedDaysAgo: 230, filedDaysAgo: 230, docs: [{ label: 'Income summary', status: 'received', receivedDaysAgo: 250 }] },

    // Northern Foods — large workload, healthy
    { id: 'job_northern_accounts', client: 'cl_northern', service: 'annual_accounts', dueIn: 110, status: 'in_progress', assignee: 'u_sarah', reviewer: 'u_adnan', hours: 40, changedDaysAgo: 9, docs: [{ label: 'Bank statements', status: 'received', receivedDaysAgo: 20 }, { label: 'Sales invoices', status: 'received', receivedDaysAgo: 20 }, { label: 'Purchase invoices', status: 'received', receivedDaysAgo: 20 }, { label: 'Payroll records', status: 'received', receivedDaysAgo: 20 }, { label: 'Stock valuation', status: 'received', receivedDaysAgo: 15 }, { label: 'Loan statement', status: 'received', receivedDaysAgo: 15 }] },
    { id: 'job_northern_ct', client: 'cl_northern', service: 'corporation_tax', dueIn: 200, status: 'waiting_for_records', waitingOn: 'accountant', assignee: 'u_sarah', changedDaysAgo: 9, docs: [{ label: 'Approved accounts', status: 'missing' }, { label: 'Capital allowances schedule', status: 'missing' }, { label: 'R&D summary', status: 'received', receivedDaysAgo: 5 }] },
    { id: 'job_northern_vat', client: 'cl_northern', service: 'vat', dueIn: 26, status: 'in_progress', assignee: 'u_michael', changedDaysAgo: 2, hours: 5, docs: [{ label: 'Sales invoices', status: 'received', receivedDaysAgo: 3 }, { label: 'Purchase invoices', status: 'received', receivedDaysAgo: 3 }, { label: 'Bank statements', status: 'received', receivedDaysAgo: 3 }] },
    { id: 'job_northern_payroll', client: 'cl_northern', service: 'payroll', dueIn: 8, status: 'in_progress', assignee: 'u_priya', hours: 8, changedDaysAgo: 1, docs: [{ label: 'Timesheets', status: 'received', receivedDaysAgo: 1 }, { label: 'Starter/leaver forms', status: 'received', receivedDaysAgo: 1 }] },
    { id: 'job_northern_bk', client: 'cl_northern', service: 'bookkeeping_review', dueIn: 15, status: 'ready_to_start', assignee: 'u_michael', changedDaysAgo: 1, docs: [{ label: 'Bank statements', status: 'received', receivedDaysAgo: 1 }, { label: 'Receipts bundle', status: 'received', receivedDaysAgo: 1 }] },
    { id: 'job_northern_cs', client: 'cl_northern', service: 'confirmation_statement', dueIn: 95, status: 'waiting_for_records', assignee: 'u_sarah', changedDaysAgo: 3, docs: [{ label: 'Director confirmation', status: 'requested' }, { label: 'PSC confirmation', status: 'requested' }, { label: 'Registered office check', status: 'received', receivedDaysAgo: 3 }] },
    { id: 'job_northern_vat_prev', client: 'cl_northern', service: 'vat', dueIn: -65, status: 'filed', assignee: 'u_michael', changedDaysAgo: 70, filedDaysAgo: 70, docs: [{ label: 'Sales invoices', status: 'received', receivedDaysAgo: 80 }] },
    { id: 'job_northern_payroll_prev', client: 'cl_northern', service: 'payroll', dueIn: -22, status: 'filed', assignee: 'u_priya', changedDaysAgo: 24, filedDaysAgo: 24, docs: [{ label: 'Timesheets', status: 'received', receivedDaysAgo: 30 }] },
    { id: 'job_northern_payroll_prev2', client: 'cl_northern', service: 'payroll', dueIn: -53, status: 'filed', assignee: 'u_priya', changedDaysAgo: 55, filedDaysAgo: 55, docs: [{ label: 'Timesheets', status: 'received', receivedDaysAgo: 60 }] },

    // Patel & Daughters — overdue, chronic chaser
    { id: 'job_patel_accounts', client: 'cl_patel', service: 'annual_accounts', dueIn: -3, status: 'waiting_for_records', assignee: 'u_michael', hours: 12, changedDaysAgo: 60, docs: [{ label: 'Bank statements', status: 'requested' }, { label: 'Sales invoices', status: 'received', receivedDaysAgo: 22 }, { label: 'Purchase invoices', status: 'received', receivedDaysAgo: 22 }, { label: 'Payroll records', status: 'received', receivedDaysAgo: 22 }, { label: 'Stock valuation', status: 'requested' }] },
    { id: 'job_patel_vat', client: 'cl_patel', service: 'vat', dueIn: 26, status: 'waiting_for_records', assignee: 'u_michael', changedDaysAgo: 12, docs: [{ label: 'Sales invoices', status: 'missing' }, { label: 'Purchase invoices', status: 'missing' }, { label: 'Bank statements', status: 'missing' }] },
    { id: 'job_patel_sa_raj', client: 'cl_patel', service: 'self_assessment', dueIn: 142, status: 'waiting_for_records', assignee: 'u_michael', changedDaysAgo: 40, docs: [{ label: 'Partnership profit share', status: 'missing' }, { label: 'Bank interest', status: 'missing' }] },
    { id: 'job_patel_payroll', client: 'cl_patel', service: 'payroll', dueIn: 8, status: 'waiting_for_records', assignee: 'u_priya', changedDaysAgo: 5, docs: [{ label: 'Timesheets', status: 'requested' }] },
    { id: 'job_patel_vat_prev', client: 'cl_patel', service: 'vat', dueIn: -60, status: 'filed', assignee: 'u_michael', changedDaysAgo: 58, filedDaysAgo: 58, docs: [{ label: 'Sales invoices', status: 'received', receivedDaysAgo: 59 }] },

    // James Whitfield — healthy landlord
    { id: 'job_whitfield_sa', client: 'cl_whitfield', service: 'self_assessment', dueIn: 142, status: 'ready_to_start', assignee: 'u_adnan', changedDaysAgo: 4, docs: [{ label: 'Rental income schedule', status: 'received', receivedDaysAgo: 4 }, { label: 'Mortgage interest statements', status: 'received', receivedDaysAgo: 4 }, { label: 'Bank interest', status: 'received', receivedDaysAgo: 4 }] },
    { id: 'job_whitfield_mtd', client: 'cl_whitfield', service: 'mtd_income_tax', dueIn: 56, status: 'in_progress', assignee: 'u_adnan', changedDaysAgo: 2, docs: [{ label: 'Income summary', status: 'received', receivedDaysAgo: 2 }, { label: 'Expense summary', status: 'received', receivedDaysAgo: 2 }, { label: 'Bank statements', status: 'received', receivedDaysAgo: 2 }] },
    { id: 'job_whitfield_sa_prev', client: 'cl_whitfield', service: 'self_assessment', dueIn: -223, status: 'filed', assignee: 'u_adnan', changedDaysAgo: 260, filedDaysAgo: 260, docs: [{ label: 'Rental income schedule', status: 'received', receivedDaysAgo: 280 }] },

    // Dr Emily Carter — SA ready to start
    { id: 'job_carter_sa', client: 'cl_carter', service: 'self_assessment', dueIn: 142, status: 'ready_to_start', assignee: 'u_priya', changedDaysAgo: 3, docs: [{ label: 'P60 / P45', status: 'received', receivedDaysAgo: 3 }, { label: 'Dividend vouchers', status: 'received', receivedDaysAgo: 3 }, { label: 'Locum income summary', status: 'received', receivedDaysAgo: 3 }, { label: 'Pension contributions', status: 'received', receivedDaysAgo: 3 }] },

    // Oakwood Joinery — VAT due in 5 days, 40% missing
    { id: 'job_oakwood_vat', client: 'cl_oakwood', service: 'vat', dueIn: 5, status: 'waiting_for_records', assignee: 'u_michael', changedDaysAgo: 19, docs: [{ label: 'Sales invoices', status: 'received', receivedDaysAgo: 6 }, { label: 'Bank statements', status: 'received', receivedDaysAgo: 6 }, { label: 'Card terminal statements', status: 'received', receivedDaysAgo: 6 }, { label: 'Purchase invoices', status: 'requested' }, { label: 'Fuel receipts', status: 'requested' }] },
    { id: 'job_oakwood_accounts', client: 'cl_oakwood', service: 'annual_accounts', dueIn: 258, status: 'waiting_for_records', assignee: 'u_michael', changedDaysAgo: 11, docs: [{ label: 'Bank statements', status: 'missing' }, { label: 'Sales invoices', status: 'missing' }, { label: 'Purchase invoices', status: 'missing' }, { label: 'Payroll records', status: 'missing' }] },
    { id: 'job_oakwood_payroll', client: 'cl_oakwood', service: 'payroll', dueIn: 8, status: 'ready_to_start', assignee: 'u_priya', changedDaysAgo: 2, docs: [{ label: 'Timesheets', status: 'received', receivedDaysAgo: 2 }] },

    // Hartley Bakery — internal review with no reviewer
    { id: 'job_hartley_accounts', client: 'cl_hartley', service: 'annual_accounts', dueIn: 41, status: 'internal_review', assignee: 'u_priya', changedDaysAgo: 8, hours: 10, docs: [{ label: 'Bank statements', status: 'received', receivedDaysAgo: 30 }, { label: 'Sales invoices', status: 'received', receivedDaysAgo: 30 }, { label: 'Purchase invoices', status: 'received', receivedDaysAgo: 30 }, { label: 'Payroll records', status: 'received', receivedDaysAgo: 30 }] },
    { id: 'job_hartley_vat', client: 'cl_hartley', service: 'vat', dueIn: 26, status: 'ready_to_start', assignee: 'u_priya', changedDaysAgo: 2, docs: [{ label: 'Sales invoices', status: 'received', receivedDaysAgo: 2 }, { label: 'Purchase invoices', status: 'received', receivedDaysAgo: 2 }, { label: 'Bank statements', status: 'received', receivedDaysAgo: 2 }] },
    { id: 'job_hartley_payroll', client: 'cl_hartley', service: 'payroll', dueIn: 8, status: 'waiting_for_records', assignee: 'u_priya', changedDaysAgo: 3, docs: [{ label: 'Timesheets', status: 'requested' }, { label: 'Starter/leaver forms', status: 'received', receivedDaysAgo: 3 }] },

    // Lumen Digital — stale in progress
    { id: 'job_lumen_accounts', client: 'cl_lumen', service: 'annual_accounts', dueIn: 50, status: 'in_progress', assignee: 'u_michael', changedDaysAgo: 16, hours: 9, docs: [{ label: 'Bank statements', status: 'received', receivedDaysAgo: 40 }, { label: 'Sales invoices', status: 'received', receivedDaysAgo: 40 }, { label: 'Purchase invoices', status: 'received', receivedDaysAgo: 40 }] },
    { id: 'job_lumen_vat', client: 'cl_lumen', service: 'vat', dueIn: 26, status: 'waiting_for_records', changedDaysAgo: 5, docs: [{ label: 'Sales invoices', status: 'requested' }, { label: 'Purchase invoices', status: 'requested' }, { label: 'Bank statements', status: 'received', receivedDaysAgo: 5 }] },
    { id: 'job_lumen_cs', client: 'cl_lumen', service: 'confirmation_statement', dueIn: 88, status: 'waiting_for_records', assignee: 'u_michael', changedDaysAgo: 2, docs: [{ label: 'Director confirmation', status: 'missing' }, { label: 'PSC confirmation', status: 'missing' }, { label: 'Registered office check', status: 'missing' }] },

    // Fenwick Plumbing — MTD ready, healthy
    { id: 'job_fenwick_vat', client: 'cl_fenwick', service: 'vat', dueIn: 26, status: 'in_progress', assignee: 'u_adnan', changedDaysAgo: 2, docs: [{ label: 'Sales invoices', status: 'received', receivedDaysAgo: 3 }, { label: 'Purchase invoices', status: 'received', receivedDaysAgo: 3 }, { label: 'Bank statements', status: 'received', receivedDaysAgo: 3 }] },
    { id: 'job_fenwick_sa', client: 'cl_fenwick', service: 'self_assessment', dueIn: 142, status: 'waiting_for_records', assignee: 'u_adnan', changedDaysAgo: 20, docs: [{ label: 'Income summary', status: 'received', receivedDaysAgo: 10 }, { label: 'Expense summary', status: 'received', receivedDaysAgo: 10 }, { label: 'Bank interest', status: 'missing' }, { label: 'Pension contributions', status: 'missing' }] },
    { id: 'job_fenwick_mtd', client: 'cl_fenwick', service: 'mtd_income_tax', dueIn: 56, status: 'ready_to_start', assignee: 'u_adnan', changedDaysAgo: 1, docs: [{ label: 'Income summary', status: 'received', receivedDaysAgo: 1 }, { label: 'Expense summary', status: 'received', receivedDaysAgo: 1 }, { label: 'Bank statements', status: 'received', receivedDaysAgo: 1 }] },

    // Ashby — SA ready to file, deadline close
    { id: 'job_ashby_sa', client: 'cl_ashby', service: 'self_assessment', dueIn: 3, status: 'ready_to_file', assignee: 'u_sarah', reviewer: 'u_adnan', changedDaysAgo: 2, docs: [{ label: 'Rental income schedule', status: 'received', receivedDaysAgo: 30 }, { label: 'Mortgage interest statements', status: 'received', receivedDaysAgo: 30 }, { label: 'Bank interest', status: 'received', receivedDaysAgo: 30 }] },
    { id: 'job_ashby_sa_prev', client: 'cl_ashby', service: 'self_assessment', dueIn: -362, status: 'filed', assignee: 'u_sarah', changedDaysAgo: 370, filedDaysAgo: 370, docs: [{ label: 'Rental income schedule', status: 'received', receivedDaysAgo: 380 }] },

    // Meadow Vets — payroll, healthy
    { id: 'job_meadow_payroll', client: 'cl_meadow', service: 'payroll', dueIn: 8, status: 'waiting_for_records', assignee: 'u_priya', hours: 4, changedDaysAgo: 2, docs: [{ label: 'Timesheets', status: 'requested' }, { label: 'Starter/leaver forms', status: 'received', receivedDaysAgo: 2 }] },
    { id: 'job_meadow_vat', client: 'cl_meadow', service: 'vat', dueIn: 26, status: 'ready_to_start', assignee: 'u_sarah', changedDaysAgo: 1, docs: [{ label: 'Sales invoices', status: 'received', receivedDaysAgo: 1 }, { label: 'Purchase invoices', status: 'received', receivedDaysAgo: 1 }, { label: 'Bank statements', status: 'received', receivedDaysAgo: 1 }] },
    { id: 'job_meadow_accounts', client: 'cl_meadow', service: 'annual_accounts', dueIn: 290, status: 'waiting_for_records', assignee: 'u_sarah', changedDaysAgo: 6, docs: [{ label: 'Bank statements', status: 'missing' }, { label: 'Sales invoices', status: 'missing' }, { label: 'Purchase invoices', status: 'missing' }, { label: 'Payroll records', status: 'missing' }] },
    { id: 'job_meadow_vat_prev', client: 'cl_meadow', service: 'vat', dueIn: -65, status: 'filed', assignee: 'u_sarah', changedDaysAgo: 68, filedDaysAgo: 68, docs: [{ label: 'Sales invoices', status: 'received', receivedDaysAgo: 75 }] },
    { id: 'job_meadow_cs', client: 'cl_meadow', service: 'confirmation_statement', dueIn: -120, status: 'filed', assignee: 'u_sarah', changedDaysAgo: 125, filedDaysAgo: 125, docs: [{ label: 'Director confirmation', status: 'received', receivedDaysAgo: 130 }] },

    // Crescent Café — slow, accounts due in 45 days, one reminder sent
    { id: 'job_crescent_accounts', client: 'cl_crescent', service: 'annual_accounts', dueIn: 45, status: 'waiting_for_records', assignee: 'u_adnan', changedDaysAgo: 28, docs: [{ label: 'Bank statements', status: 'received', receivedDaysAgo: 14 }, { label: 'Sales invoices', status: 'requested' }, { label: 'Purchase invoices', status: 'requested' }, { label: 'Payroll records', status: 'received', receivedDaysAgo: 14 }, { label: 'Till reports', status: 'requested' }] },
    { id: 'job_crescent_vat', client: 'cl_crescent', service: 'vat', dueIn: 26, status: 'waiting_for_records', assignee: 'u_adnan', changedDaysAgo: 7, docs: [{ label: 'Sales invoices', status: 'missing' }, { label: 'Purchase invoices', status: 'missing' }, { label: 'Bank statements', status: 'missing' }] },
    { id: 'job_crescent_payroll', client: 'cl_crescent', service: 'payroll', dueIn: 8, status: 'waiting_for_records', assignee: 'u_priya', changedDaysAgo: 3, docs: [{ label: 'Timesheets', status: 'requested' }] },

    // Unassigned job to show up in capacity
    { id: 'job_hartley_ct', client: 'cl_hartley', service: 'corporation_tax', dueIn: 130, status: 'waiting_for_records', waitingOn: 'accountant', changedDaysAgo: 8, docs: [{ label: 'Approved accounts', status: 'missing' }] },
  ];

  const jobs: Job[] = [];
  const requestItems: InformationRequestItem[] = [];
  const documents: Document[] = [];
  const obligations: Obligation[] = [];

  const periodMonthsFor = (code: ServiceCode) => (SERVICES[code].frequency === 'annual' ? 12 : SERVICES[code].frequency === 'quarterly' ? 3 : 1);
  const dueOffsetFor = (code: ServiceCode): number => {
    switch (code) {
      case 'annual_accounts':
        return 270; // 9 months after year end (Companies House private company)
      case 'corporation_tax':
        return 365; // 12 months after year end
      case 'vat':
      case 'mtd_income_tax':
        return 38; // 1 month + 7 days
      case 'payroll':
      case 'bookkeeping_review':
        return 19; // RTI / month + 19
      case 'self_assessment':
        return 301; // 31 January following 5 April
      case 'confirmation_statement':
        return 14;
    }
  };

  for (const j of jobSpecs) {
    const service = SERVICES[j.service];
    const dueDate = inDays(j.dueIn);
    const months = j.periodMonths ?? periodMonthsFor(j.service);
    const periodEnd = snapPeriodEnd(addDays(dueDate, -dueOffsetFor(j.service)), j.service);
    const periodStart = addDays(addMonths(periodEnd, -months), 1);
    const [y, m] = periodEnd.split('-').map(Number);
    const periodKey = service.frequency === 'annual' ? `${y}` : service.frequency === 'quarterly' ? `${y}-Q${Math.ceil(m / 3)}` : `${y}-${String(m).padStart(2, '0')}`;
    const name = nameForJob(j.service, periodKey, periodEnd);
    const obligationId = `ob_${j.client.slice(3)}_${j.service}`;
    const waitingOn: WaitingOn = j.waitingOn ?? defaultWaiting(j.status);
    jobs.push({
      id: j.id,
      practiceId: FIXTURE_PRACTICE_ID,
      clientId: j.client,
      obligationId,
      serviceCode: j.service,
      name,
      periodKey,
      periodStart,
      periodEnd,
      dueDate,
      status: j.status,
      waitingOn,
      assigneeUserId: j.assignee,
      reviewerUserId: j.reviewer,
      estimatedHours: j.hours ?? service.defaultEstimatedHours,
      statusChangedAt: ago(j.changedDaysAgo, 10, 15),
      createdAt: ago(j.changedDaysAgo + 20, 9),
      filedAt: j.filedDaysAgo !== undefined ? ago(j.filedDaysAgo, 15, 40) : undefined,
      chasingPaused: j.chasingPaused,
    });
    const docs = j.docs ?? service.defaultRequirements.map((label) => ({ label, status: 'missing' as const }));
    docs.forEach((d, i) => {
      const itemId = `req_${j.id.slice(4)}_${i}`;
      let documentId: string | undefined;
      if (d.status === 'received') {
        documentId = `doc_${j.id.slice(4)}_${i}`;
        documents.push({
          id: documentId,
          practiceId: FIXTURE_PRACTICE_ID,
          clientId: j.client,
          jobId: j.id,
          fileName: `${slug(clientSpecs.find((c) => c.id === j.client)!.name)}-${slug(d.label)}.pdf`,
          documentType: d.label,
          receivedAt: ago(d.receivedDaysAgo ?? 5, 11, 20),
          source: i % 3 === 0 ? 'email' : i % 3 === 1 ? 'portal' : 'inbox',
          sizeKb: 120 + ((i * 37 + j.id.length * 11) % 900),
        });
      }
      requestItems.push({
        id: itemId,
        practiceId: FIXTURE_PRACTICE_ID,
        jobId: j.id,
        clientId: j.client,
        label: d.label,
        documentType: d.label,
        status: d.status,
        requestedAt: d.status !== 'missing' ? ago(j.changedDaysAgo, 9) : undefined,
        receivedAt: d.status === 'received' ? ago(d.receivedDaysAgo ?? 5, 11, 20) : undefined,
        documentId,
        required: true,
      });
    });
    // Obligation (one per client/service, keyed to the latest period end)
    const existing = obligations.find((o) => o.id === obligationId);
    if (!existing) {
      obligations.push({
        id: obligationId,
        practiceId: FIXTURE_PRACTICE_ID,
        clientId: j.client,
        serviceCode: j.service,
        name: service.frequency === 'quarterly' ? `Quarterly ${service.name}` : service.frequency === 'monthly' ? `Monthly ${service.name}` : `Annual ${service.name}`,
        frequency: service.frequency,
        lastPeriodEnd: periodEnd,
        dueOffsetDays: dueOffsetFor(j.service),
        periodLengthMonths: months,
      });
    } else if (periodEnd > existing.lastPeriodEnd) {
      existing.lastPeriodEnd = periodEnd;
    }
  }

  // -------------------------------------------------------------------------
  // Communications
  // -------------------------------------------------------------------------
  const communications: Communication[] = [];
  const comm = (c: Omit<Communication, 'id' | 'practiceId' | 'simulated'> & { id: string }) => {
    communications.push({ ...c, practiceId: FIXTURE_PRACTICE_ID, simulated: true });
  };

  comm({
    id: 'cm_abc_1',
    clientId: 'cl_abc',
    jobId: 'job_abc_accounts',
    direction: 'outbound',
    channel: 'email',
    recipient: 'dave@abc-construction.example',
    subject: 'ABC Construction Ltd — Annual Accounts: documents still needed',
    body: 'Hi Dave,\n\nThanks for sending your bank statements, sales invoices, payroll records and purchase invoices. We\'re still waiting for your loan statement and director expenses before we can complete your accounts. The deadline is 30 days away and we want to leave enough time to do a thorough job.\n\nBest wishes,\nAdnan Sarayqum\nFarhan & Raihan',
    sentAt: ago(18, 9, 12),
    sentByUserId: 'u_adnan',
    reminderStage: 'Email (30 days)',
    documentsRequested: ['Loan statement', 'Director expenses'],
    responseStatus: 'awaiting',
  });
  comm({
    id: 'cm_abc_2',
    clientId: 'cl_abc',
    jobId: 'job_abc_accounts',
    direction: 'outbound',
    channel: 'email',
    recipient: 'dave@abc-construction.example',
    subject: 'ABC Construction Ltd — Annual Accounts: two items outstanding',
    body: 'Hi Dave,\n\nA quick follow-up — we\'re still missing the loan statement and director expenses for the accounts. The filing deadline is in 14 days. Could you send them over this week?\n\nBest wishes,\nAdnan Sarayqum\nFarhan & Raihan',
    sentAt: ago(2, 14, 5),
    sentByUserId: 'u_adnan',
    reminderStage: 'Email + WhatsApp (14 days)',
    documentsRequested: ['Loan statement', 'Director expenses'],
    responseStatus: 'awaiting',
  });
  comm({
    id: 'cm_abc_0',
    clientId: 'cl_abc',
    jobId: 'job_abc_accounts',
    direction: 'inbound',
    channel: 'email',
    recipient: 'adnan@northgate.example',
    subject: 'Re: Year-end records',
    body: 'Hi Adnan, bank statements and invoices attached. Payroll reports to follow from Lisa. Cheers, Dave',
    sentAt: ago(21, 16, 45),
    responseStatus: 'n/a',
  });
  comm({
    id: 'cm_abc_vat',
    clientId: 'cl_abc',
    jobId: 'job_abc_vat',
    direction: 'inbound',
    channel: 'portal',
    recipient: 'portal',
    body: 'Uploaded Q3 sales and purchase invoices via the client portal.',
    sentAt: ago(4, 10, 2),
    responseStatus: 'n/a',
  });
  comm({
    id: 'cm_brown_1',
    clientId: 'cl_brown',
    jobId: 'job_brown_accounts',
    direction: 'outbound',
    channel: 'email',
    recipient: 'gareth@brownproperty.example',
    subject: 'Brown Property Ltd — accounts ready for your approval',
    body: 'Hi Gareth,\n\nYour accounts for the year are now complete and attached for review. Once you\'re happy, please reply to confirm approval and we\'ll file with Companies House.\n\nBest wishes,\nMichael Okafor\nFarhan & Raihan',
    sentAt: ago(11, 11, 30),
    sentByUserId: 'u_michael',
    reminderStage: 'Approval request',
    responseStatus: 'awaiting',
  });
  comm({
    id: 'cm_patel_1',
    clientId: 'cl_patel',
    jobId: 'job_patel_accounts',
    direction: 'outbound',
    channel: 'email',
    recipient: 'raj@patelpharmacy.example',
    subject: 'Patel & Daughters — year-end records needed',
    body: 'Hi Raj,\n\nWe\'re still waiting for your bank statements and stock valuation for the year-end accounts. The deadline is in 30 days.\n\nBest wishes,\nMichael Okafor',
    sentAt: ago(33, 9, 0),
    sentByUserId: 'u_michael',
    reminderStage: 'Email (30 days)',
    documentsRequested: ['Bank statements', 'Stock valuation'],
    responseStatus: 'awaiting',
  });
  comm({
    id: 'cm_patel_2',
    clientId: 'cl_patel',
    jobId: 'job_patel_accounts',
    direction: 'outbound',
    channel: 'sms',
    recipient: '07700 900740',
    body: 'Hi Raj, we still need your bank statements and stock valuation for the accounts. Deadline is in 14 days. Reply here or email us. — Farhan & Raihan',
    sentAt: ago(17, 12, 10),
    sentByUserId: 'u_michael',
    reminderStage: 'Email + WhatsApp (14 days)',
    documentsRequested: ['Bank statements', 'Stock valuation'],
    responseStatus: 'awaiting',
  });
  comm({
    id: 'cm_patel_3',
    clientId: 'cl_patel',
    jobId: 'job_patel_accounts',
    direction: 'outbound',
    channel: 'sms',
    recipient: '07700 900740',
    body: 'Hi Raj, urgent: the accounts deadline is in 3 days and we still need your bank statements and stock valuation. Please send today. — Farhan & Raihan',
    sentAt: ago(6, 9, 30),
    sentByUserId: 'u_michael',
    reminderStage: 'Urgent reminder (3 days)',
    documentsRequested: ['Bank statements', 'Stock valuation'],
    responseStatus: 'awaiting',
  });
  comm({
    id: 'cm_oakwood_1',
    clientId: 'cl_oakwood',
    jobId: 'job_oakwood_vat',
    direction: 'outbound',
    channel: 'whatsapp',
    recipient: '07700 901070',
    body: 'Hi Steve, thanks for the sales invoices, bank statements and card terminal statements. We\'re still waiting for your purchase invoices and fuel receipts for the VAT return. The deadline is in 10 days. — Michael, Farhan & Raihan',
    sentAt: ago(5, 15, 20),
    sentByUserId: 'u_michael',
    reminderStage: 'Email + WhatsApp (10 days)',
    documentsRequested: ['Purchase invoices', 'Fuel receipts'],
    responseStatus: 'awaiting',
  });
  comm({
    id: 'cm_crescent_1',
    clientId: 'cl_crescent',
    jobId: 'job_crescent_accounts',
    direction: 'outbound',
    channel: 'whatsapp',
    recipient: '07700 901850',
    body: 'Hi Yusuf, thanks for the bank statements and payroll records. We still need your sales invoices, purchase invoices and till reports for the accounts. No rush yet, but sending them when you get a moment keeps everything on track. — Adnan, Farhan & Raihan',
    sentAt: ago(14, 10, 0),
    sentByUserId: 'u_adnan',
    reminderStage: 'Friendly email (90 days)',
    documentsRequested: ['Sales invoices', 'Purchase invoices', 'Till reports'],
    responseStatus: 'awaiting',
  });
  comm({
    id: 'cm_khan_1',
    clientId: 'cl_khan',
    jobId: 'job_khan_vat',
    direction: 'inbound',
    channel: 'email',
    recipient: 'sarah@northgate.example',
    subject: 'Q3 VAT records',
    body: 'Hi Sarah, everything for Q3 attached. Let me know if you need anything else. Amira',
    sentAt: ago(9, 8, 50),
    responseStatus: 'n/a',
  });
  comm({
    id: 'cm_northern_1',
    clientId: 'cl_northern',
    jobId: 'job_northern_accounts',
    direction: 'inbound',
    channel: 'email',
    recipient: 'sarah@northgate.example',
    subject: 'Year-end pack',
    body: 'Hi Sarah, full year-end pack uploaded to the portal including stock valuation and loan statements. Helen',
    sentAt: ago(15, 9, 5),
    responseStatus: 'n/a',
  });
  comm({
    id: 'cm_malik_1',
    clientId: 'cl_malik',
    jobId: 'job_malik_sa',
    direction: 'outbound',
    channel: 'whatsapp',
    recipient: '07700 900520',
    body: 'Hi Sarah, thanks for the income summary. We\'re still waiting for your expense summary, bank interest and pension contributions for your tax return. No rush yet — the deadline is a few months away. — Priya, Farhan & Raihan',
    sentAt: ago(12, 13, 0),
    sentByUserId: 'u_priya',
    reminderStage: 'Friendly email (120 days)',
    documentsRequested: ['Expense summary', 'Bank interest', 'Pension contributions'],
    responseStatus: 'awaiting',
  });
  comm({
    id: 'cm_greenfield_1',
    clientId: 'cl_greenfield',
    jobId: 'job_greenfield_cs',
    direction: 'outbound',
    channel: 'email',
    recipient: 'tom@greenfielddesign.example',
    subject: 'Greenfield Design Ltd — director identity verification',
    body: 'Hi Tom,\n\nCompanies House now requires all directors and PSCs to verify their identity before we can file the confirmation statement. You have already verified, but we still need Olivia to complete verification and share her personal code.\n\nBest wishes,\nPriya Shah',
    sentAt: ago(6, 10, 0),
    sentByUserId: 'u_priya',
    responseStatus: 'awaiting',
  });

  // -------------------------------------------------------------------------
  // Approvals & filings
  // -------------------------------------------------------------------------
  const approvals: Approval[] = [
    { id: 'ap_brown_internal', practiceId: FIXTURE_PRACTICE_ID, jobId: 'job_brown_accounts', kind: 'internal', status: 'approved', requestedAt: ago(13), decidedAt: ago(12), reviewerName: 'Adnan Sarayqum', note: 'Reviewed — depreciation policy consistent with prior year.' },
    { id: 'ap_brown_client', practiceId: FIXTURE_PRACTICE_ID, jobId: 'job_brown_accounts', kind: 'client', status: 'pending', requestedAt: ago(11) },
    { id: 'ap_khan_internal', practiceId: FIXTURE_PRACTICE_ID, jobId: 'job_khan_vat', kind: 'internal', status: 'approved', requestedAt: ago(2), decidedAt: ago(1), reviewerName: 'Adnan Sarayqum' },
    { id: 'ap_khan_client', practiceId: FIXTURE_PRACTICE_ID, jobId: 'job_khan_vat', kind: 'client', status: 'approved', requestedAt: ago(1), decidedAt: ago(1, 16), reviewerName: 'Amira Khan', note: 'Approved by email.' },
    { id: 'ap_ashby_internal', practiceId: FIXTURE_PRACTICE_ID, jobId: 'job_ashby_sa', kind: 'internal', status: 'approved', requestedAt: ago(4), decidedAt: ago(3), reviewerName: 'Adnan Sarayqum' },
    { id: 'ap_ashby_client', practiceId: FIXTURE_PRACTICE_ID, jobId: 'job_ashby_sa', kind: 'client', status: 'approved', requestedAt: ago(3), decidedAt: ago(2), reviewerName: 'Anne Ashby' },
    { id: 'ap_hartley_internal', practiceId: FIXTURE_PRACTICE_ID, jobId: 'job_hartley_accounts', kind: 'internal', status: 'pending', requestedAt: ago(8) },
  ];

  const filings: FilingRecord[] = jobs
    .filter((j) => j.status === 'filed' && j.filedAt)
    .map((j, i) => ({
      id: `fil_${j.id.slice(4)}`,
      practiceId: FIXTURE_PRACTICE_ID,
      jobId: j.id,
      filedAt: j.filedAt!,
      filedByUserId: j.assigneeUserId ?? 'u_adnan',
      submissionReference: `SIM-${String(100200 + i * 37).padStart(6, '0')}`,
      destination: j.serviceCode === 'annual_accounts' || j.serviceCode === 'confirmation_statement' ? 'Companies House' : 'HMRC',
      evidenceStatus: 'simulated',
      simulated: true,
    }));

  // -------------------------------------------------------------------------
  // People (directors / PSCs)
  // -------------------------------------------------------------------------
  const people: Person[] = [
    { id: 'p_dave', practiceId: FIXTURE_PRACTICE_ID, fullName: 'Dave Thompson', dateOfBirth: '1978-04-12' },
    { id: 'p_lisa', practiceId: FIXTURE_PRACTICE_ID, fullName: 'Lisa Thompson', dateOfBirth: '1980-09-03' },
    { id: 'p_amira', practiceId: FIXTURE_PRACTICE_ID, fullName: 'Amira Khan', dateOfBirth: '1985-01-22' },
    { id: 'p_gareth', practiceId: FIXTURE_PRACTICE_ID, fullName: 'Gareth Brown', dateOfBirth: '1969-11-30' },
    { id: 'p_tom', practiceId: FIXTURE_PRACTICE_ID, fullName: 'Tom Greenfield', dateOfBirth: '1987-06-14' },
    { id: 'p_olivia', practiceId: FIXTURE_PRACTICE_ID, fullName: 'Olivia Greenfield', dateOfBirth: '1989-02-27' },
    { id: 'p_helen', practiceId: FIXTURE_PRACTICE_ID, fullName: 'Helen Fraser', dateOfBirth: '1975-08-08' },
    { id: 'p_robert', practiceId: FIXTURE_PRACTICE_ID, fullName: 'Robert Fraser', dateOfBirth: '1971-03-19' },
    { id: 'p_steve', practiceId: FIXTURE_PRACTICE_ID, fullName: 'Steve Oakes', dateOfBirth: '1982-12-01' },
    { id: 'p_jo', practiceId: FIXTURE_PRACTICE_ID, fullName: 'Jo Hartley', dateOfBirth: '1990-05-25' },
    { id: 'p_chloe', practiceId: FIXTURE_PRACTICE_ID, fullName: 'Chloe Adams', dateOfBirth: '1992-10-10' },
    { id: 'p_alan', practiceId: FIXTURE_PRACTICE_ID, fullName: 'Dr Alan Reid', dateOfBirth: '1968-07-16' },
    { id: 'p_yusuf', practiceId: FIXTURE_PRACTICE_ID, fullName: 'Yusuf Demir', dateOfBirth: '1984-04-04' },
    { id: 'p_rachel', practiceId: FIXTURE_PRACTICE_ID, fullName: 'Rachel Moore', dateOfBirth: '1986-01-15' },
    { id: 'p_ben', practiceId: FIXTURE_PRACTICE_ID, fullName: 'Ben Carver', dateOfBirth: '1991-09-09' },
  ];

  const role = (id: string, personId: string, clientId: string, kind: PersonRole['kind'], verification: PersonRole['identityVerification'], code: boolean, evidence: PersonRole['evidenceStatus']): PersonRole => ({
    id,
    practiceId: FIXTURE_PRACTICE_ID,
    personId,
    clientId,
    kind,
    identityVerification: verification,
    personalCodeCaptured: code,
    evidenceStatus: evidence,
  });

  const personRoles: PersonRole[] = [
    role('pr_1', 'p_dave', 'cl_abc', 'director', 'verified', true, 'checked'),
    role('pr_2', 'p_dave', 'cl_abc', 'psc', 'verified', true, 'checked'),
    role('pr_3', 'p_lisa', 'cl_abc', 'director', 'verified', true, 'checked'),
    role('pr_4', 'p_amira', 'cl_khan', 'director', 'verified', true, 'checked'),
    role('pr_5', 'p_amira', 'cl_khan', 'psc', 'verified', true, 'checked'),
    role('pr_6', 'p_gareth', 'cl_brown', 'director', 'verified', true, 'checked'),
    role('pr_7', 'p_gareth', 'cl_brown', 'psc', 'verified', true, 'checked'),
    role('pr_8', 'p_tom', 'cl_greenfield', 'director', 'verified', true, 'checked'),
    role('pr_9', 'p_olivia', 'cl_greenfield', 'director', 'not_started', false, 'requested'),
    role('pr_10', 'p_olivia', 'cl_greenfield', 'psc', 'not_started', false, 'requested'),
    role('pr_11', 'p_helen', 'cl_northern', 'director', 'verified', true, 'checked'),
    role('pr_12', 'p_robert', 'cl_northern', 'director', 'verified', true, 'checked'),
    role('pr_13', 'p_robert', 'cl_northern', 'psc', 'verified', true, 'checked'),
    role('pr_14', 'p_steve', 'cl_oakwood', 'director', 'in_progress', true, 'received'),
    role('pr_15', 'p_jo', 'cl_hartley', 'director', 'verified', true, 'checked'),
    role('pr_16', 'p_chloe', 'cl_lumen', 'director', 'in_progress', false, 'requested'),
    role('pr_17', 'p_alan', 'cl_meadow', 'director', 'verified', true, 'checked'),
    role('pr_18', 'p_yusuf', 'cl_crescent', 'director', 'not_started', false, 'none'),
    role('pr_19', 'p_rachel', 'cl_bluebell', 'director', 'in_progress', false, 'received'),
    role('pr_20', 'p_ben', 'cl_summit', 'director', 'verified', true, 'checked'),
  ];

  // -------------------------------------------------------------------------
  // MTD readiness
  // -------------------------------------------------------------------------
  const mtdReadiness: MtdReadiness[] = [
    { id: 'mtd_malik', practiceId: FIXTURE_PRACTICE_ID, clientId: 'cl_malik', incomeBand: '30k_50k', startYear: '2027/28', signedUp: false, softwareReady: false, agentAuthorised: true, accountingBasis: 'cash', nextQuarterlyDue: inDays(56) },
    { id: 'mtd_whitfield', practiceId: FIXTURE_PRACTICE_ID, clientId: 'cl_whitfield', incomeBand: 'over_50k', startYear: '2026/27', signedUp: true, softwareReady: true, agentAuthorised: true, accountingBasis: 'cash', nextQuarterlyDue: inDays(56) },
    { id: 'mtd_fenwick', practiceId: FIXTURE_PRACTICE_ID, clientId: 'cl_fenwick', incomeBand: 'over_50k', startYear: '2026/27', signedUp: true, softwareReady: true, agentAuthorised: true, accountingBasis: 'accruals', nextQuarterlyDue: inDays(56) },
    { id: 'mtd_carter', practiceId: FIXTURE_PRACTICE_ID, clientId: 'cl_carter', incomeBand: '20k_30k', startYear: '2028/29', signedUp: false, softwareReady: true, agentAuthorised: true, accountingBasis: 'cash' },
    { id: 'mtd_ashby', practiceId: FIXTURE_PRACTICE_ID, clientId: 'cl_ashby', incomeBand: 'under_20k', startYear: '—', signedUp: false, softwareReady: false, agentAuthorised: true, accountingBasis: 'cash' },
    { id: 'mtd_patel', practiceId: FIXTURE_PRACTICE_ID, clientId: 'cl_patel', incomeBand: 'over_50k', startYear: '2026/27', signedUp: false, softwareReady: true, agentAuthorised: false, accountingBasis: 'accruals', nextQuarterlyDue: inDays(56) },
  ];

  // -------------------------------------------------------------------------
  // Onboarding
  // -------------------------------------------------------------------------
  const checklist = (done: string[]): OnboardingCase['checklist'] => {
    const items: [string, string, OnboardingStage][] = [
      ['contact', 'Client contact information', 'details_requested'],
      ['utr', 'UTR', 'hmrc_ch_details'],
      ['nino', 'NI number (directors)', 'hmrc_ch_details'],
      ['company_number', 'Company number', 'hmrc_ch_details'],
      ['vat', 'VAT number', 'hmrc_ch_details'],
      ['paye', 'PAYE reference', 'hmrc_ch_details'],
      ['year_end', 'Accounting year end', 'hmrc_ch_details'],
      ['services', 'Services agreed', 'services'],
      ['id_docs', 'ID documents', 'identity_aml'],
      ['aml', 'AML risk assessment', 'identity_aml'],
      ['engagement', 'Engagement letter signed', 'engagement'],
      ['agent_auth', 'Agent authorisation (64-8)', 'engagement'],
      ['ch_identity', 'Companies House identity verification', 'identity_aml'],
    ];
    return items.map(([key, label, stage]) => ({ key, label, stage, done: done.includes(key) }));
  };

  const onboardingCases: OnboardingCase[] = [
    { id: 'ob_bluebell', practiceId: FIXTURE_PRACTICE_ID, clientId: 'cl_bluebell', stage: 'identity_aml', startedAt: ago(9), checklist: checklist(['contact', 'company_number', 'year_end', 'services', 'id_docs']) },
    { id: 'ob_summit', practiceId: FIXTURE_PRACTICE_ID, clientId: 'cl_summit', stage: 'engagement', startedAt: ago(24), checklist: checklist(['contact', 'utr', 'nino', 'company_number', 'vat', 'year_end', 'services', 'id_docs', 'aml', 'ch_identity', 'engagement']) },
  ];

  // -------------------------------------------------------------------------
  // Smart Inbox
  // -------------------------------------------------------------------------
  const inboxItems: InboxItem[] = [
    {
      id: 'inb_abc_loan',
      practiceId: FIXTURE_PRACTICE_ID,
      fileName: 'ABC-Lloyds-Loan-Statement.pdf',
      receivedAt: ago(0, 8, 42),
      source: 'email',
      sender: 'dave@abc-construction.example',
      sizeKb: 412,
      suggestion: { clientId: 'cl_abc', jobId: 'job_abc_accounts', documentType: 'Loan statement', period: 'Year to 31 December', extractedReference: 'Lloyds Business Loan 4471', extractedDate: addDays(today, -30), confidence: 0.97, rationale: 'Sender matches ABC Construction primary contact. Document header reads "Business Loan Statement". Loan statement is outstanding on the Annual Accounts job.' },
      status: 'pending',
    },
    {
      id: 'inb_hmrc_ct',
      practiceId: FIXTURE_PRACTICE_ID,
      fileName: 'HMRC_CT_Notice.pdf',
      receivedAt: ago(0, 7, 55),
      source: 'scan',
      sender: 'Post — scanned',
      sizeKb: 233,
      suggestion: { clientId: 'cl_northern', jobId: 'job_northern_ct', documentType: 'Corporation Tax notice to deliver', period: '2025/26', extractedReference: 'UTR ending 2345', extractedDate: addDays(today, -4), confidence: 0.94, rationale: 'UTR on the letter matches Northern Foods Ltd. Notice relates to the open Corporation Tax job.' },
      status: 'pending',
    },
    {
      id: 'inb_oakwood_purchases',
      practiceId: FIXTURE_PRACTICE_ID,
      fileName: 'Oakwood_Purchase_Invoices_Q3.zip',
      receivedAt: ago(0, 9, 10),
      source: 'portal',
      sender: 'steve@oakwoodjoinery.example',
      sizeKb: 3840,
      suggestion: { clientId: 'cl_oakwood', jobId: 'job_oakwood_vat', documentType: 'Purchase invoices', period: 'Q3', confidence: 0.89, rationale: 'Uploaded from Oakwood Joinery portal account. File name references Q3 purchase invoices, which are outstanding on the VAT return.' },
      status: 'pending',
    },
    {
      id: 'inb_greenfield_ch',
      practiceId: FIXTURE_PRACTICE_ID,
      fileName: 'Companies_House_Reminder_12345678.pdf',
      receivedAt: ago(1, 16, 20),
      source: 'email',
      sender: 'noreply@companieshouse.example',
      sizeKb: 98,
      suggestion: { clientId: 'cl_greenfield', jobId: 'job_greenfield_cs', documentType: 'Companies House correspondence', period: 'Confirmation statement', extractedReference: 'Company 12345678', extractedDate: addDays(today, -1), confidence: 0.91, rationale: 'Company number 12345678 matches Greenfield Design Ltd. Letter is a confirmation statement reminder.' },
      status: 'pending',
    },
    {
      id: 'inb_payroll_sept',
      practiceId: FIXTURE_PRACTICE_ID,
      fileName: 'payroll_hours_sept.xlsx',
      receivedAt: ago(1, 11, 5),
      source: 'email',
      sender: 'reception@meadowvets.example',
      sizeKb: 44,
      suggestion: { clientId: 'cl_meadow', jobId: 'job_meadow_payroll', documentType: 'Timesheets', period: 'This month', confidence: 0.72, rationale: 'Sender domain matches Meadow Vets Ltd but the sender is not a known contact. Spreadsheet columns look like timesheets.' },
      status: 'pending',
    },
    {
      id: 'inb_barclays',
      practiceId: FIXTURE_PRACTICE_ID,
      fileName: 'Barclays-Statement-Aug.pdf',
      receivedAt: ago(2, 9, 30),
      source: 'email',
      sender: 'raj@patelpharmacy.example',
      sizeKb: 511,
      suggestion: { clientId: 'cl_patel', jobId: 'job_patel_accounts', documentType: 'Bank statements', period: 'August', extractedReference: 'Account ending 7731', confidence: 0.88, rationale: 'Sender is Patel & Daughters primary contact. Bank statements are outstanding on the overdue Annual Accounts job.' },
      status: 'pending',
    },
  ];

  // -------------------------------------------------------------------------
  // Activity feed
  // -------------------------------------------------------------------------
  const activities: Activity[] = [
    { id: 'act_1', practiceId: FIXTURE_PRACTICE_ID, kind: 'reminder_sent', message: 'Email reminder sent to ABC Construction Ltd for Annual Accounts (loan statement, director expenses).', clientId: 'cl_abc', jobId: 'job_abc_accounts', actorUserId: 'u_adnan', occurredAt: ago(2, 14, 5) },
    { id: 'act_2', practiceId: FIXTURE_PRACTICE_ID, kind: 'document_received', message: 'Q3 sales and purchase invoices received from ABC Construction Ltd via portal.', clientId: 'cl_abc', jobId: 'job_abc_vat', occurredAt: ago(4, 10, 2) },
    { id: 'act_3', practiceId: FIXTURE_PRACTICE_ID, kind: 'status_changed', message: 'Khan Consulting Ltd VAT return moved to Ready to file after client approval.', clientId: 'cl_khan', jobId: 'job_khan_vat', actorUserId: 'u_sarah', occurredAt: ago(1, 16, 30) },
    { id: 'act_4', practiceId: FIXTURE_PRACTICE_ID, kind: 'approval_recorded', message: 'Client approval recorded for Khan Consulting Ltd VAT return (Amira Khan).', clientId: 'cl_khan', jobId: 'job_khan_vat', actorUserId: 'u_sarah', occurredAt: ago(1, 16, 0) },
    { id: 'act_5', practiceId: FIXTURE_PRACTICE_ID, kind: 'job_reassigned', message: 'Sarah Mitchell reassigned Northern Foods Ltd VAT return to Michael Okafor.', clientId: 'cl_northern', jobId: 'job_northern_vat', actorUserId: 'u_sarah', occurredAt: ago(2, 9, 15) },
    { id: 'act_6', practiceId: FIXTURE_PRACTICE_ID, kind: 'reminder_sent', message: 'WhatsApp reminder sent to Oakwood Joinery Ltd for VAT return (purchase invoices, fuel receipts).', clientId: 'cl_oakwood', jobId: 'job_oakwood_vat', actorUserId: 'u_michael', occurredAt: ago(5, 15, 20) },
    { id: 'act_7', practiceId: FIXTURE_PRACTICE_ID, kind: 'reminder_sent', message: 'Urgent SMS reminder sent to Patel & Daughters for Annual Accounts.', clientId: 'cl_patel', jobId: 'job_patel_accounts', actorUserId: 'u_michael', occurredAt: ago(6, 9, 30) },
    { id: 'act_8', practiceId: FIXTURE_PRACTICE_ID, kind: 'status_changed', message: 'Hartley Bakery Ltd Annual Accounts sent for internal review.', clientId: 'cl_hartley', jobId: 'job_hartley_accounts', actorUserId: 'u_priya', occurredAt: ago(8, 17, 10) },
    { id: 'act_9', practiceId: FIXTURE_PRACTICE_ID, kind: 'approval_recorded', message: 'Client approval requested from Brown Property Ltd for Annual Accounts.', clientId: 'cl_brown', jobId: 'job_brown_accounts', actorUserId: 'u_michael', occurredAt: ago(11, 11, 30) },
    { id: 'act_10', practiceId: FIXTURE_PRACTICE_ID, kind: 'onboarding_updated', message: 'Bluebell Nursery Ltd moved to Identity / AML stage.', clientId: 'cl_bluebell', actorUserId: 'u_priya', occurredAt: ago(3, 12, 0) },
    { id: 'act_11', practiceId: FIXTURE_PRACTICE_ID, kind: 'document_received', message: 'Year-end pack received from Northern Foods Ltd (6 documents).', clientId: 'cl_northern', jobId: 'job_northern_accounts', occurredAt: ago(15, 9, 5) },
    { id: 'act_12', practiceId: FIXTURE_PRACTICE_ID, kind: 'job_filed', message: 'Northern Foods Ltd payroll filed (simulated submission).', clientId: 'cl_northern', jobId: 'job_northern_payroll_prev', actorUserId: 'u_priya', occurredAt: ago(24, 15, 40) },
    { id: 'act_13', practiceId: FIXTURE_PRACTICE_ID, kind: 'document_received', message: 'Rental income schedule and mortgage statements received from James Whitfield.', clientId: 'cl_whitfield', jobId: 'job_whitfield_sa', occurredAt: ago(4, 14, 22) },
    { id: 'act_14', practiceId: FIXTURE_PRACTICE_ID, kind: 'client_created', message: 'Summit Fitness Ltd added as a new lead.', clientId: 'cl_summit', actorUserId: 'u_michael', occurredAt: ago(24, 10, 0) },
  ];

  const notifications: Notification[] = [
    { id: 'ntf_1', practiceId: FIXTURE_PRACTICE_ID, title: 'New documents in Smart Inbox', body: '6 documents are waiting for review, including a loan statement for ABC Construction Ltd.', kind: 'document', createdAt: ago(0, 8, 45), read: false },
    { id: 'ntf_2', practiceId: FIXTURE_PRACTICE_ID, title: 'Deadline approaching', body: 'Oakwood Joinery Ltd VAT return is due in 5 days with 2 documents missing.', kind: 'deadline', clientId: 'cl_oakwood', jobId: 'job_oakwood_vat', createdAt: ago(0, 7, 0), read: false },
    { id: 'ntf_3', practiceId: FIXTURE_PRACTICE_ID, title: 'Job now ready to file', body: 'Khan Consulting Ltd VAT return has client approval and is ready to file.', kind: 'job', clientId: 'cl_khan', jobId: 'job_khan_vat', createdAt: ago(1, 16, 31), read: false },
    { id: 'ntf_4', practiceId: FIXTURE_PRACTICE_ID, title: 'Job reassigned to you', body: 'Sarah Mitchell reassigned Northern Foods Ltd VAT return to Michael Okafor.', kind: 'job', clientId: 'cl_northern', jobId: 'job_northern_vat', createdAt: ago(2, 9, 16), read: true },
    { id: 'ntf_5', practiceId: FIXTURE_PRACTICE_ID, title: 'Overdue', body: 'Patel & Daughters Annual Accounts are now overdue by 3 days.', kind: 'deadline', clientId: 'cl_patel', jobId: 'job_patel_accounts', createdAt: ago(3, 0, 5), read: true },
  ];

  return {
    practice: { id: FIXTURE_PRACTICE_ID, name: 'Farhan & Raihan', timezone: 'Europe/London' },
    users: FIXTURE_USERS,
    clients,
    contacts,
    identifiers,
    people,
    personRoles,
    subscriptions,
    obligations,
    jobs,
    requestItems,
    documents,
    communications,
    reminderSequences: FIXTURE_REMINDER_SEQUENCES,
    approvals,
    filings,
    activities,
    auditEvents: [],
    inboxItems,
    notifications,
    onboardingCases,
    mtdReadiness,
  };
}

function defaultWaiting(status: JobStatus): WaitingOn {
  switch (status) {
    case 'waiting_for_records':
    case 'waiting_client_approval':
      return 'client';
    case 'internal_review':
      return 'senior_review';
    case 'ready_to_file':
    case 'filed':
      return 'nothing';
    default:
      return 'accountant';
  }
}

function nameForJob(code: ServiceCode, periodKey: string, periodEnd: string): string {
  const service = SERVICES[code];
  const [y, m] = periodEnd.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  switch (service.frequency) {
    case 'quarterly':
      return `${service.name} ${periodKey.replace('-', ' ')}`;
    case 'monthly':
      return `${service.name} ${months[m - 1]} ${y}`;
    default:
      return `${periodKey} ${service.name}`;
  }
}

/**
 * Demo-relative due dates produce ragged period ends; snap them to the
 * nearest month end (or 5 April for Self Assessment) so periods read
 * like real statutory periods.
 */
function snapPeriodEnd(iso: IsoDate, code: ServiceCode): IsoDate {
  const [y, m, d] = iso.split('-').map(Number);
  if (code === 'self_assessment' || code === 'mtd_income_tax') {
    if (code === 'self_assessment') return `${m > 4 || (m === 4 && d >= 5) ? y : y - 1}-04-05`;
  }
  if (d <= 15) {
    const prev = new Date(y, m - 1, 0);
    return toIso(prev);
  }
  return toIso(new Date(y, m, 0));
}

function toIso(d: Date): IsoDate {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function slug(s: string): string {
  return s.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
}
