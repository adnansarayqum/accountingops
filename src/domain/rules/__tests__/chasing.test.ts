import { describe, expect, it } from 'vitest';
import { assessChasing, draftReminder } from '../chasing';
import type { Client, Contact, InformationRequestItem, Job, ReminderSequence, User } from '../../types';

const today = '2026-09-11';
const job: Job = {
  id: 'j1', practiceId: 'p', clientId: 'c1', serviceCode: 'annual_accounts', name: '2025 Annual Accounts', periodKey: '2025',
  periodStart: '2025-01-01', periodEnd: '2025-12-31', dueDate: '2026-09-23', status: 'waiting_for_records', waitingOn: 'client',
  estimatedHours: 10, statusChangedAt: '2026-08-01T09:00:00Z', createdAt: '2026-08-01T09:00:00Z',
};
const items = (missing: string[], received: string[]): InformationRequestItem[] => [
  ...received.map((l) => ({ id: l, practiceId: 'p', jobId: 'j1', clientId: 'c1', label: l, documentType: l, status: 'received' as const, required: true })),
  ...missing.map((l) => ({ id: l, practiceId: 'p', jobId: 'j1', clientId: 'c1', label: l, documentType: l, status: 'requested' as const, required: true })),
];
const seq: ReminderSequence = { id: 'seq_accounts', practiceId: 'p', name: 'x', steps: [
  { daysBeforeDue: 90, channels: ['email'], tone: 'friendly', label: 'Friendly' },
  { daysBeforeDue: 30, channels: ['email'], tone: 'standard', label: 'Standard' },
  { daysBeforeDue: 14, channels: ['email', 'whatsapp'], tone: 'firm', label: 'Firm' },
  { daysBeforeDue: 3, channels: ['sms'], tone: 'urgent', label: 'Urgent' },
] };

describe('assessChasing', () => {
  it('requires chasing while required documents are missing', () => {
    const a = assessChasing(job, items(['Loan statement', 'Director expenses'], ['Bank statements']), [], seq, today);
    expect(a.required).toBe(true);
    expect(a.kind).toBe('documents');
    expect(a.outstanding.map((o) => o.label)).toEqual(['Loan statement', 'Director expenses']);
    expect(a.nextStep?.label).toBe('Friendly');
  });

  it('stops chasing once everything is received', () => {
    const a = assessChasing(job, items([], ['Bank statements', 'Loan statement']), [], seq, today);
    expect(a.required).toBe(false);
    expect(a.reason).toMatch(/no further chasing/i);
  });

  it('advances the sequence step based on reminders already sent', () => {
    const comms = [1, 2].map((n) => ({ id: `c${n}`, practiceId: 'p', clientId: 'c1', jobId: 'j1', direction: 'outbound' as const, channel: 'email' as const, recipient: 'x', body: '', sentAt: `2026-09-0${n}T09:00:00Z`, reminderStage: 'Standard', responseStatus: 'awaiting' as const, simulated: true }));
    const a = assessChasing(job, items(['Loan statement'], []), comms, seq, today);
    expect(a.remindersSent).toBe(2);
    expect(a.nextStep?.label).toBe('Firm');
    expect(a.overdueStep).toBe(true); // 12 days left <= 14
  });

  it('chases approval when the job is waiting for the client to approve', () => {
    const a = assessChasing({ ...job, status: 'waiting_client_approval' }, items([], ['Bank statements']), [], seq, today);
    expect(a.required).toBe(true);
    expect(a.kind).toBe('approval');
  });

  it('never chases a filed or paused job', () => {
    expect(assessChasing({ ...job, status: 'filed' }, items(['x'], []), [], seq, today).required).toBe(false);
    expect(assessChasing({ ...job, chasingPaused: true }, items(['x'], []), [], seq, today).required).toBe(false);
  });
});

describe('draftReminder', () => {
  const client: Client = { id: 'c1', practiceId: 'p', name: 'ABC Construction Ltd', type: 'limited_company', lifecycle: 'active', ownerUserId: 'u', primaryContactId: 'ct', preferredChannel: 'whatsapp', averageResponseDays: 11, createdAt: '' };
  const contact: Contact = { id: 'ct', practiceId: 'p', clientId: 'c1', name: 'Dave Thompson', role: 'Director', email: 'd@x', phone: '077', whatsapp: '077', isPrimary: true };
  const sender: User = { id: 'u', practiceId: 'p', name: 'Adnan Rahman', initials: 'AR', role: 'owner', weeklyCapacityHours: 30, colour: 'blue' };

  it('references what was received and what is still outstanding', () => {
    const d = draftReminder({ client, contact, job, items: items(['Loan statement', 'Director expenses'], ['Bank statements', 'Payroll records']), channel: 'whatsapp', sender, practiceName: 'Northgate', today });
    expect(d.body).toContain('Thanks for sending your bank statements and payroll records');
    expect(d.body).toContain('still waiting for your loan statement and director expenses');
    expect(d.body).not.toMatch(/please send your documents/i);
    expect(d.documentsRequested).toEqual(['Loan statement', 'Director expenses']);
    expect(d.recipient).toBe('077');
  });

  it('produces an email subject and greeting for email', () => {
    const d = draftReminder({ client, contact, job, items: items(['Loan statement'], []), channel: 'email', sender, practiceName: 'Northgate', today });
    expect(d.subject).toContain('ABC Construction Ltd');
    expect(d.body.startsWith('Hi Dave,')).toBe(true);
    expect(d.recipient).toBe('d@x');
  });
});
