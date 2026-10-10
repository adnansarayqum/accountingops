import { SERVICES } from '../catalog';
import { formatDate } from '../dates';
import { maskIdentifier } from './masking';
import type { Client, ClientIdentifier, Contact, DocumentFacts, Id, InformationRequestItem, Job, Proposal, ProposalChange } from '../types';

/**
 * Turns what a document says (its facts, read by the AI and checked by the
 * server) into changes to the practice's records — proposed, never applied
 * here. Each is compared with what the practice already holds, so a
 * deadline that already matches, or a UTR already on file, proposes
 * nothing. Applying one is the store's job (applyProposal), with a tap.
 */

export const CLIENT_MESSAGE = 'Message from the client';

/** Shared-document types and the request-checklist labels each one satisfies. */
const REQUEST_LABELS_FOR: Record<string, string[]> = {
  'bank statement': ['bank statements'],
  'receipt or purchase invoice': ['purchase invoices', 'receipts'],
  'sales invoice': ['sales invoices'],
  'payslip, p60 or p45': ['payroll records', 'p60', 'p45', 'payslips'],
};

/** Whether a document of this type satisfies a checklist item: same type, a known equivalent, or one name containing the other. */
export function requestItemMatches(item: Pick<InformationRequestItem, 'documentType' | 'label'>, documentType: string): boolean {
  const type = documentType.toLowerCase();
  const label = item.label.toLowerCase();
  if (item.documentType.toLowerCase() === type) return true;
  if (REQUEST_LABELS_FOR[type]?.includes(label)) return true;
  return type.includes(label) || label.includes(type);
}

/** The open checklist item on a job this document satisfies — an exact type match first, then a looser one. */
export function findMatchingRequestItem(items: InformationRequestItem[], jobId: Id, documentType: string): InformationRequestItem | undefined {
  const open = items.filter((r) => r.jobId === jobId && r.status !== 'received');
  return open.find((r) => r.documentType.toLowerCase() === documentType.toLowerCase()) ?? open.find((r) => requestItemMatches(r, documentType));
}

const digits = (value: string) => value.replace(/\D/g, '');
const sameIdentifier = (a: string, b: string) => digits(a) === digits(b);

export interface ProposalSource {
  clients: Client[];
  contacts: Contact[];
  identifiers: ClientIdentifier[];
  jobs: Job[];
  requestItems: InformationRequestItem[];
}

export interface ProposalInput {
  data: ProposalSource;
  clientId: Id;
  /** The Document the item became. */
  documentId: Id;
  documentType: string;
  facts?: DocumentFacts;
  summary?: string;
  extractedReference?: string;
  /** True when attaching it already ticked a checklist item off. */
  requestAlreadyMatched?: boolean;
  newId: () => Id;
}

export function buildProposals(input: ProposalInput): Proposal[] {
  const { data, clientId, documentType, facts } = input;
  const client = data.clients.find((c) => c.id === clientId);
  if (!client) return [];
  const changes: ProposalChange[] = [];
  const fromClient = documentType === CLIENT_MESSAGE;

  // A deadline: move the matching job's due date, or create the job if the
  // practice has none for that period.
  let deadlineJob: Job | undefined;
  if (facts?.service) {
    const jobs = data.jobs.filter((j) => j.clientId === clientId && j.serviceCode === facts.service);
    if (facts.periodEnd) deadlineJob = jobs.find((j) => j.periodEnd === facts.periodEnd);
    else {
      const open = jobs.filter((j) => j.status !== 'filed');
      if (open.length === 1) deadlineJob = open[0];
    }
  }
  if (facts?.deadline) {
    if (deadlineJob) {
      if (deadlineJob.status !== 'filed' && deadlineJob.dueDate !== facts.deadline) changes.push({ kind: 'move_due_date', jobId: deadlineJob.id, from: deadlineJob.dueDate, to: facts.deadline });
    } else if (facts.service && facts.periodEnd) {
      changes.push({ kind: 'create_job', serviceCode: facts.service, dueDate: facts.deadline, periodEnd: facts.periodEnd });
    } else {
      // Not enough to tie it to a job — keep it where it will be seen.
      const what = facts.service ? `${SERVICES[facts.service].name} deadline` : 'Deadline';
      changes.push({ kind: 'add_note', text: `${what} on ${documentType.toLowerCase()}: ${formatDate(facts.deadline, { year: true })}.` });
    }
  }

  if (facts?.penaltyAmount) {
    changes.push({ kind: 'record_penalty', amount: facts.penaltyAmount, appealBy: facts.appealBy ?? undefined, reference: input.extractedReference, jobId: deadlineJob?.id });
  }

  // A checklist item this document satisfies on any open job — attaching it
  // only ticks one off when a job was picked, which shared documents never have.
  if (!input.requestAlreadyMatched && documentType !== 'Other' && !fromClient) {
    const openJobs = data.jobs.filter((j) => j.clientId === clientId && j.status !== 'filed').sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    for (const job of openJobs) {
      const item = findMatchingRequestItem(data.requestItems, job.id, documentType);
      if (item) {
        changes.push({ kind: 'tick_request', requestItemId: item.id, documentId: input.documentId });
        break;
      }
    }
  }

  for (const [kind, value] of [['utr', facts?.utr], ['vat_number', facts?.vatNumber]] as const) {
    if (!value) continue;
    const existing = data.identifiers.find((i) => i.clientId === clientId && i.kind === kind);
    if (existing && sameIdentifier(existing.value, value)) continue;
    // Someone else's number on this document says it isn't about this client's records.
    if (data.identifiers.some((i) => i.clientId !== clientId && i.kind === kind && sameIdentifier(i.value, value))) continue;
    // Filling a gap is fine from any document; replacing one on file only on the client's own word.
    if (!existing) changes.push({ kind: 'set_identifier', identifierKind: kind, value, replaces: false });
    else if (fromClient) changes.push({ kind: 'set_identifier', identifierKind: kind, value, replaces: true });
  }

  // Details about the client only count when the client gave them.
  if (fromClient && facts) {
    if (facts.yearEnd && facts.yearEnd !== client.yearEnd) changes.push({ kind: 'set_year_end', value: facts.yearEnd, from: client.yearEnd });
    const contact = data.contacts.find((c) => c.id === client.primaryContactId && c.clientId === clientId);
    if (contact && facts.email && facts.email.toLowerCase() !== contact.email?.toLowerCase()) changes.push({ kind: 'update_contact', contactId: contact.id, field: 'email', value: facts.email, from: contact.email });
    if (contact && facts.phone && digits(facts.phone) !== digits(contact.phone ?? '')) changes.push({ kind: 'update_contact', contactId: contact.id, field: 'phone', value: facts.phone, from: contact.phone });
  }
  if (fromClient && (input.summary || facts?.address)) {
    const parts = [input.summary ? `Client said: ${input.summary}` : 'Client message.', facts?.address ? `New address given: ${facts.address}.` : ''];
    changes.push({ kind: 'add_note', text: parts.filter(Boolean).join(' ') });
  }

  return changes.map((change) => ({ ...change, id: input.newId(), clientId, status: 'pending' as const }));
}

/** One line saying what applying a proposal would do. */
export function describeProposal(p: Proposal, data: Pick<ProposalSource, 'jobs' | 'requestItems'>): string {
  const date = (iso: string) => formatDate(iso, { year: true });
  switch (p.kind) {
    case 'move_due_date': {
      const job = data.jobs.find((j) => j.id === p.jobId);
      return `Move ${job?.name ?? 'the job'} due date from ${date(p.from)} to ${date(p.to)}`;
    }
    case 'create_job':
      return `Add ${SERVICES[p.serviceCode].name} for the period to ${date(p.periodEnd)}, due ${date(p.dueDate)}`;
    case 'record_penalty':
      return `Record a £${p.amount.toLocaleString('en-GB')} penalty${p.appealBy ? `, appeal by ${date(p.appealBy)}` : ''}`;
    case 'tick_request': {
      const item = data.requestItems.find((r) => r.id === p.requestItemId);
      const job = data.jobs.find((j) => j.id === item?.jobId);
      return `Tick off ${item?.label ?? 'the requested document'}${job ? ` on ${job.name}` : ''}`;
    }
    case 'set_identifier': {
      const label = p.identifierKind === 'utr' ? 'UTR' : 'VAT number';
      return `${p.replaces ? 'Change' : 'Add'} ${label} ${maskIdentifier(p.value, p.identifierKind)}`;
    }
    case 'set_year_end':
      return `Set year end to ${p.value}${p.from ? ` (was ${p.from})` : ''}`;
    case 'update_contact':
      return `Change ${p.field === 'email' ? 'email' : 'phone'} to ${p.value}${p.from ? ` (was ${p.from})` : ''}`;
    case 'add_note':
      return `Save a note: ${p.text}`;
  }
}
