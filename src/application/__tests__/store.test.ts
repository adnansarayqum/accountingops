import { beforeEach, describe, expect, it } from 'vitest';
import { configureRepository, useAppStore } from '../store';
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

  it('records an audit event when an identifier is revealed', () => {
    useAppStore.getState().recordIdentifierReveal('cl_abc', 'utr');
    expect(useAppStore.getState().data.auditEvents[0].action).toBe('identifier.reveal');
  });
});
