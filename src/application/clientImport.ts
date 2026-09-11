import { addDays, addMonths, daysBetween, nowIso } from '../domain/dates';
import { SERVICES } from '../domain/catalog';
import { jobNameFor, periodKeyFor } from '../domain/rules';
import { newId } from './ids';
import type { Client, ClientIdentifier, Contact, IdentifierKind, InformationRequestItem, IsoDate, Job, Obligation, ServiceSubscription } from '../domain/types';

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
}

export interface BuiltClientImport {
  clients: Client[];
  contacts: Contact[];
  identifiers: ClientIdentifier[];
  subscriptions: ServiceSubscription[];
  obligations: Obligation[];
  jobs: Job[];
  requestItems: InformationRequestItem[];
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
    });

    contacts.push({
      id: contactId,
      practiceId,
      clientId,
      name: 'Main contact — details needed',
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
  }

  return { clients, contacts, identifiers, subscriptions, obligations, jobs, requestItems };
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
