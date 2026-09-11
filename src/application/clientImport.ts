import { addDays, addMonths, daysBetween, nowIso } from '../domain/dates';
import { SERVICES } from '../domain/catalog';
import { jobNameFor, periodKeyFor } from '../domain/rules';
import { newId } from './ids';
import { birthMonthYearOf, isSamePerson, normalisePersonName } from '../domain/personNames';
import type { Client, ClientIdentifier, Contact, IdentifierKind, InformationRequestItem, IsoDate, Job, Obligation, Person, PersonRole, PersonRoleKind, RegisteredAddress, ServiceSubscription } from '../domain/types';
import type { CompanyPeopleResponse, CompanyPerson, CompanyProfile } from '../integrations/companiesHouseTypes';

/**
 * One row of an existing client roster (e.g. imported from a practice's own
 * spreadsheet) — the minimum a practice typically already tracks per client
 * outside this app. Contact details aren't included because rosters like
 * this rarely have them; the imported client starts with a placeholder
 * contact the practice fills in.
 */
export interface ClientRosterRow {
  name: string;
  companyNumber: string;
  utr?: string;
  /** Companies House online-filing authentication code. */
  chAuthCode?: string;
  /** Meaning varies by practice — imported and masked as-is, unlabelled beyond "Personal code". */
  personalCode?: string;
  /** Government Gateway credentials, if the roster happened to record them. */
  gatewayCredentials?: string;
  /** "Next accounts made up to" — the period end for the next annual accounts. */
  accountsPeriodEnd?: IsoDate;
  /** Statutory filing deadline for those accounts. */
  accountsDue?: IsoDate;
  /** Confirmation statement filing deadline. */
  confirmationStatementDue?: IsoDate;
  /** Populated by a Companies House lookup (see mergeCompanyProfile) — not from the spreadsheet itself. */
  registeredOffice?: RegisteredAddress;
  companiesHouseStatus?: string;
  sicCodes?: string[];
  incorporatedOn?: IsoDate;
  previousNames?: string[];
  /** Populated by a Companies House officers/PSC lookup (see mergeCompanyPeople) — not from the spreadsheet itself. */
  directors?: CompanyPerson[];
  pscs?: CompanyPerson[];
}

/**
 * Merges a live Companies House profile into a roster row. Companies House
 * is treated as the more authoritative source: where it has a value, that
 * value is used even if the roster already had one (a spreadsheet's "next
 * accounts due" can go stale; Companies House's own record is current).
 * Pure — the caller is responsible for fetching the profile.
 */
export function mergeCompanyProfile(row: ClientRosterRow, profile: CompanyProfile): ClientRosterRow {
  return {
    ...row,
    registeredOffice: profile.registeredOfficeAddress ?? row.registeredOffice,
    companiesHouseStatus: profile.companyStatus ?? row.companiesHouseStatus,
    sicCodes: profile.sicCodes.length > 0 ? profile.sicCodes : row.sicCodes,
    incorporatedOn: profile.dateOfCreation ?? row.incorporatedOn,
    previousNames: profile.previousNames && profile.previousNames.length > 0 ? profile.previousNames : row.previousNames,
    accountsPeriodEnd: profile.nextAccountsPeriodEndOn ?? row.accountsPeriodEnd,
    accountsDue: profile.nextAccountsDueOn ?? row.accountsDue,
    confirmationStatementDue: profile.nextConfirmationStatementDueOn ?? row.confirmationStatementDue,
  };
}

/**
 * Merges Companies House officers/PSC data into a roster row. Unlike
 * mergeCompanyProfile, there's no spreadsheet-provided fallback here — a
 * roster like this never lists directors, so this is purely additive.
 */
export function mergeCompanyPeople(row: ClientRosterRow, people: CompanyPeopleResponse): ClientRosterRow {
  return { ...row, directors: people.directors, pscs: people.pscs };
}

/** Placeholder primary-contact name for an imported client with no director data to name it from. Exported so a later Companies House refresh can recognise and replace it. */
export const PLACEHOLDER_CONTACT_NAME = 'Main contact — details needed';

export interface BuiltClientImport {
  clients: Client[];
  contacts: Contact[];
  identifiers: ClientIdentifier[];
  subscriptions: ServiceSubscription[];
  obligations: Obligation[];
  jobs: Job[];
  requestItems: InformationRequestItem[];
  people: Person[];
  personRoles: PersonRole[];
}

const CS_DUE_OFFSET_DAYS = 14;

/**
 * Turn parsed roster rows into full domain records: client, placeholder
 * contact, identifiers (masked like any other), and — where the roster
 * gave dates — an accounts and/or confirmation statement obligation with
 * its first job already in the pipeline. Pure and synchronous so it's easy
 * to test without any file parsing.
 */
export function buildImportedClientRecords(rows: ClientRosterRow[], practiceId: string, ownerUserId: string, today: IsoDate): BuiltClientImport {
  const clients: Client[] = [];
  const contacts: Contact[] = [];
  const identifiers: ClientIdentifier[] = [];
  const subscriptions: ServiceSubscription[] = [];
  const obligations: Obligation[] = [];
  const jobs: Job[] = [];
  const requestItems: InformationRequestItem[] = [];
  const people: Person[] = [];
  const personRoles: PersonRole[] = [];

  for (const row of rows) {
    const clientId = newId('cl');
    const contactId = newId('ct');

    clients.push({
      id: clientId,
      practiceId,
      name: row.name,
      type: 'limited_company',
      lifecycle: 'active',
      ownerUserId,
      primaryContactId: contactId,
      preferredChannel: 'email',
      averageResponseDays: 5,
      createdAt: nowIso(),
      registeredOffice: row.registeredOffice,
      companiesHouseStatus: row.companiesHouseStatus,
      sicCodes: row.sicCodes,
      incorporatedOn: row.incorporatedOn,
      previousNames: row.previousNames,
      // Only stamp rows that actually carry a live lookup — a row that fell back to
      // spreadsheet-only data has never been synced, and should read that way.
      companiesHouseSyncedAt: row.companiesHouseStatus || row.directors ? nowIso() : undefined,
    });

    // Companies House's public register gives a director's name but never a phone number or
    // email — there's no "main contact" concept to pull. Using the first director's name here
    // beats a generic placeholder, but the practice still needs to add real contact details.
    const primaryDirectorName = row.directors?.[0]?.name;
    contacts.push({
      id: contactId,
      practiceId,
      clientId,
      name: primaryDirectorName ? normalisePersonName(primaryDirectorName) : PLACEHOLDER_CONTACT_NAME,
      role: 'Director',
      isPrimary: true,
    });

    const addIdentifier = (kind: IdentifierKind, value: string | undefined) => {
      if (!value) return;
      identifiers.push({ id: newId('idf'), practiceId, clientId, kind, value, sensitive: kind !== 'company_number' });
    };
    addIdentifier('company_number', row.companyNumber);
    addIdentifier('utr', row.utr);
    addIdentifier('ch_auth_code', row.chAuthCode);
    addIdentifier('personal_code', row.personalCode);
    addIdentifier('gateway_credentials', row.gatewayCredentials);

    if (row.accountsPeriodEnd && row.accountsDue) {
      addObligationAndJob(
        { practiceId, clientId, serviceCode: 'annual_accounts', periodEnd: row.accountsPeriodEnd, dueDate: row.accountsDue, periodLengthMonths: 12 },
        { subscriptions, obligations, jobs, requestItems, today },
      );
    }

    if (row.confirmationStatementDue) {
      const periodEnd = addDays(row.confirmationStatementDue, -CS_DUE_OFFSET_DAYS);
      addObligationAndJob(
        { practiceId, clientId, serviceCode: 'confirmation_statement', periodEnd, dueDate: row.confirmationStatementDue, periodLengthMonths: 12 },
        { subscriptions, obligations, jobs, requestItems, today },
      );
    }

    addPeopleForRow(row, practiceId, clientId, people, personRoles);
  }

  return { clients, contacts, identifiers, subscriptions, obligations, jobs, requestItems, people, personRoles };
}

/**
 * Turns a row's Companies House directors/PSCs into Person + PersonRole
 * records. The same individual can appear as both a director and a PSC
 * (common for a sole director-shareholder) — and Companies House writes
 * the name differently in each list ("SMITH, Jane" vs "Mrs Jane Smith"),
 * so matching goes through the normalised name with birth month/year as
 * the tie-breaker (see domain/personNames). Matched people share a single
 * Person but get one PersonRole per kind, same as this app's own demo data
 * models it.
 */
function addPeopleForRow(row: ClientRosterRow, practiceId: string, clientId: string, people: Person[], personRoles: PersonRole[]): void {
  const entries: { name: string; birthMonthYear?: string; kind: PersonRoleKind; naturesOfControl?: string[] }[] = [
    ...(row.directors ?? []).map((d) => ({ name: d.name, birthMonthYear: birthMonthYearOf(d.dateOfBirth), kind: 'director' as const })),
    ...(row.pscs ?? []).map((p) => ({ name: p.name, birthMonthYear: birthMonthYearOf(p.dateOfBirth), kind: 'psc' as const, naturesOfControl: p.naturesOfControl })),
  ];
  const added: { name: string; birthMonthYear?: string; personId: string }[] = [];
  for (const entry of entries) {
    let personId = added.find((a) => isSamePerson(a, entry))?.personId;
    if (!personId) {
      personId = newId('p');
      added.push({ name: entry.name, birthMonthYear: entry.birthMonthYear, personId });
      people.push({ id: personId, practiceId, fullName: normalisePersonName(entry.name), birthMonthYear: entry.birthMonthYear });
    }
    personRoles.push({
      id: newId('pr'),
      practiceId,
      naturesOfControl: entry.naturesOfControl,
      personId,
      clientId,
      kind: entry.kind,
      identityVerification: 'not_started',
      personalCodeCaptured: false,
      evidenceStatus: 'none',
    });
  }
}

function addObligationAndJob(
  spec: { practiceId: string; clientId: string; serviceCode: 'annual_accounts' | 'confirmation_statement'; periodEnd: IsoDate; dueDate: IsoDate; periodLengthMonths: number },
  into: { subscriptions: ServiceSubscription[]; obligations: Obligation[]; jobs: Job[]; requestItems: InformationRequestItem[]; today: IsoDate },
): void {
  const { practiceId, clientId, serviceCode, periodEnd, dueDate, periodLengthMonths } = spec;
  const service = SERVICES[serviceCode];
  into.subscriptions.push({ id: newId('sub'), practiceId, clientId, serviceCode, startedOn: into.today, active: true });

  const obligation: Obligation = {
    id: newId('ob'),
    practiceId,
    clientId,
    serviceCode,
    name: service.name,
    frequency: service.frequency,
    lastPeriodEnd: periodEnd,
    dueOffsetDays: Math.max(daysBetween(periodEnd, dueDate), 0),
    periodLengthMonths,
  };
  into.obligations.push(obligation);

  const periodKey = periodKeyFor(obligation, periodEnd);
  const jobId = newId('job');
  into.jobs.push({
    id: jobId,
    practiceId,
    clientId,
    obligationId: obligation.id,
    serviceCode,
    name: jobNameFor(obligation, periodKey),
    periodKey,
    periodStart: addDays(addMonths(periodEnd, -periodLengthMonths), 1),
    periodEnd,
    dueDate,
    status: 'waiting_for_records',
    waitingOn: 'client',
    estimatedHours: service.defaultEstimatedHours,
    statusChangedAt: nowIso(),
    createdAt: nowIso(),
  });
  for (const label of service.defaultRequirements) {
    into.requestItems.push({ id: newId('req'), practiceId, jobId, clientId, label, documentType: label, status: 'missing', required: true });
  }
}
