import { describe, expect, it } from 'vitest';
import { buildFixtureData } from '../../../testing/fixtures';
import { buildProposals, describeProposal, requestItemMatches, type ProposalInput } from '../proposals';
import type { DocumentFacts } from '../../types';

const data = buildFixtureData('2026-09-11');
const noFacts: DocumentFacts = { deadline: null, service: null, periodEnd: null, penaltyAmount: null, appealBy: null, utr: null, vatNumber: null, email: null, phone: null, address: null, yearEnd: null };

function build(documentType: string, facts: Partial<DocumentFacts> | undefined, overrides: Partial<ProposalInput> = {}) {
  let n = 0;
  return buildProposals({
    data,
    clientId: 'cl_abc',
    documentId: 'doc_new',
    documentType,
    facts: facts ? { ...noFacts, ...facts } : undefined,
    newId: () => `prop_${(n += 1)}`,
    ...overrides,
  });
}
const kinds = (proposals: ReturnType<typeof build>) => proposals.map((p) => p.kind);

describe('requestItemMatches', () => {
  it('matches the same type, a known equivalent, or one name inside the other', () => {
    const item = (label: string) => ({ label, documentType: label });
    expect(requestItemMatches(item('Bank statements'), 'Bank statement')).toBe(true);
    expect(requestItemMatches(item('Purchase invoices'), 'Receipt or purchase invoice')).toBe(true);
    expect(requestItemMatches(item('Payroll records'), 'Payslip, P60 or P45')).toBe(true);
    expect(requestItemMatches(item('Loan statement'), 'Bank statement')).toBe(false);
  });
});

describe('buildProposals — deadlines', () => {
  it('moves the due date of the job for that period when it differs', () => {
    const [p] = build('Penalty notice', { deadline: '2026-12-31', service: 'corporation_tax', periodEnd: '2025-12-31' });
    expect(p).toMatchObject({ kind: 'move_due_date', jobId: 'job_abc_ct', from: '2026-12-22', to: '2026-12-31', clientId: 'cl_abc', status: 'pending', id: 'prop_1' });
  });

  it('proposes nothing when the job is already due then, or already filed', () => {
    expect(build('Other HMRC letter', { deadline: '2026-12-22', service: 'corporation_tax', periodEnd: '2025-12-31' })).toEqual([]);
    expect(build('Other HMRC letter', { deadline: '2025-10-01', service: 'annual_accounts', periodEnd: '2024-12-31' })).toEqual([]);
  });

  it('uses the only open job for the service when no period is given', () => {
    expect(build('VAT notice', { deadline: '2026-10-10', service: 'vat' })[0]).toMatchObject({ kind: 'move_due_date', jobId: 'job_abc_vat' });
  });

  it('creates the job when there is none for that period, and keeps a note when it cannot tell which', () => {
    expect(build('Corporation Tax notice to deliver', { deadline: '2027-12-31', service: 'corporation_tax', periodEnd: '2026-12-31' })[0]).toMatchObject({ kind: 'create_job', serviceCode: 'corporation_tax', dueDate: '2027-12-31', periodEnd: '2026-12-31' });
    expect(build('Self Assessment notice', { deadline: '2027-01-31', service: 'self_assessment' })[0]).toMatchObject({ kind: 'add_note', text: 'Self Assessment deadline on self assessment notice: 31 Jan 2027.' });
    expect(build('Other HMRC letter', { deadline: '2027-01-31' })[0]).toMatchObject({ kind: 'add_note', text: 'Deadline on other hmrc letter: 31 Jan 2027.' });
  });

  it('records a penalty against the job it concerns', () => {
    const proposals = build('Penalty notice', { penaltyAmount: 100, appealBy: '2026-10-09', service: 'corporation_tax', periodEnd: '2025-12-31' }, { extractedReference: 'CT/1' });
    expect(proposals).toEqual([expect.objectContaining({ kind: 'record_penalty', amount: 100, appealBy: '2026-10-09', reference: 'CT/1', jobId: 'job_abc_ct' })]);
  });
});

describe('buildProposals — checklist', () => {
  it('ticks off the earliest-due open item this document satisfies', () => {
    expect(build('Approved accounts', undefined)).toEqual([expect.objectContaining({ kind: 'tick_request', requestItemId: 'req_abc_ct_0', documentId: 'doc_new' })]);
  });

  it('does not when attaching it already did, or for a message or an unknown document', () => {
    expect(build('Approved accounts', undefined, { requestAlreadyMatched: true })).toEqual([]);
    expect(build('Other', undefined)).toEqual([]);
    expect(build('Bank statement', undefined)).toEqual([]); // every bank statement item is already received
  });
});

describe('buildProposals — client details', () => {
  it('adds a missing UTR or VAT number from any document, but only replaces one on the client’s word', () => {
    const noUtr = { ...data, identifiers: data.identifiers.filter((i) => !(i.clientId === 'cl_abc' && i.kind === 'utr')) };
    expect(build('Corporation Tax statement', { utr: '5555555555' }, { data: noUtr })).toEqual([expect.objectContaining({ kind: 'set_identifier', identifierKind: 'utr', value: '5555555555', replaces: false })]);
    expect(build('Corporation Tax statement', { utr: '5555555555' })).toEqual([]);
    expect(build('Message from the client', { utr: '5555555555' })[0]).toMatchObject({ kind: 'set_identifier', replaces: true });
    expect(build('Message from the client', { vatNumber: 'GB123456789' })).toEqual([]); // already on file
  });

  it('never proposes another client’s number', () => {
    expect(build('Message from the client', { utr: '2345678901' })).toEqual([]); // cl_khan's UTR
  });

  it('takes year end and contact details only from the client’s own message', () => {
    const facts = { yearEnd: '31 March', email: 'dave@new.example', phone: '07700 900999' };
    expect(build('Self Assessment notice', facts)).toEqual([]);
    expect(kinds(build('Message from the client', facts))).toEqual(['set_year_end', 'update_contact', 'update_contact']);
    expect(build('Message from the client', facts)[1]).toMatchObject({ contactId: 'ct_abc_1', field: 'email', value: 'dave@new.example', from: 'dave@abc-construction.example' });
    expect(build('Message from the client', { email: 'DAVE@abc-construction.example', phone: '077009 00123', yearEnd: '31 December' })).toEqual([]);
  });

  it('saves a client’s message, with any new address, as a note', () => {
    expect(build('Message from the client', { address: '2 New Road' }, { summary: 'Moved office' })).toEqual([expect.objectContaining({ kind: 'add_note', text: 'Client said: Moved office New address given: 2 New Road.' })]);
    expect(build('Message from the client', undefined)).toEqual([]);
  });

  it('proposes nothing for a client that no longer exists', () => {
    expect(build('Penalty notice', { penaltyAmount: 100 }, { clientId: 'cl_gone' })).toEqual([]);
  });
});

describe('describeProposal', () => {
  it('says what each change would do, masking identifiers', () => {
    const say = (documentType: string, facts: Partial<DocumentFacts>, overrides: Partial<ProposalInput> = {}) => build(documentType, facts, overrides).map((p) => describeProposal(p, data));
    expect(say('Penalty notice', { deadline: '2026-12-31', service: 'corporation_tax', periodEnd: '2025-12-31', penaltyAmount: 1200, appealBy: '2026-10-09' })).toEqual([
      'Move 2025 Corporation Tax due date from 22 Dec 2026 to 31 Dec 2026',
      'Record a £1,200 penalty, appeal by 9 Oct 2026',
    ]);
    expect(say('Message from the client', { utr: '5555555555' })).toEqual(['Change UTR •••••55555']);
    expect(say('Corporation Tax notice to deliver', { deadline: '2027-12-31', service: 'corporation_tax', periodEnd: '2026-12-31' })).toEqual(['Add Corporation Tax for the period to 31 Dec 2026, due 31 Dec 2027']);
    expect(build('Approved accounts', undefined).map((p) => describeProposal(p, data))).toEqual(['Tick off Approved accounts on 2025 Corporation Tax']);
  });
});
