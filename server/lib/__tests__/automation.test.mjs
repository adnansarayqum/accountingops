import { describe, expect, it } from 'vitest';
import { NEEDS_YOU, planReminders, RULES } from '../automation.mjs';

const SEQUENCE = {
  id: 'seq_accounts',
  steps: [
    { daysBeforeDue: 30, channels: ['email'], tone: 'standard', label: 'Email (30 days)' },
    { daysBeforeDue: 14, channels: ['email', 'whatsapp'], tone: 'firm', label: 'Email + WhatsApp (14 days)' },
    { daysBeforeDue: 3, channels: ['whatsapp', 'sms'], tone: 'urgent', label: 'Urgent reminder (3 days)' },
  ],
};

/** A one-client practice: Wednesday 16 Sept 2026, 11:00 in London, accounts due in 28 days with a document missing. */
function world(over = {}) {
  const base = {
    practice: { id: 'p', name: 'Farhan & Raihan', timezone: 'Europe/London', automation: { autoReminders: true } },
    users: [{ id: 'u_first', name: 'First Person' }, { id: 'u_owner', name: 'Owner Person' }, { id: 'u_assignee', name: 'Assigned Person' }],
    clients: [{ id: 'c1', name: 'Acme Ltd', lifecycle: 'active', preferredChannel: 'email', primaryContactId: 'ct1', ownerUserId: 'u_owner' }],
    contacts: [
      { id: 'ct2', clientId: 'c1', name: 'Lisa Thompson', email: 'lisa@acme.example', isPrimary: false },
      { id: 'ct1', clientId: 'c1', name: 'Dave Thompson', email: 'dave@acme.example', isPrimary: true },
    ],
    jobs: [{ id: 'j1', clientId: 'c1', serviceCode: 'annual_accounts', name: '2025 Annual Accounts', dueDate: '2026-10-14', status: 'waiting_for_records', waitingOn: 'client', assigneeUserId: 'u_assignee' }],
    requestItems: [
      { id: 'r1', jobId: 'j1', clientId: 'c1', label: 'Bank statements', documentType: 'Bank statements', status: 'received', required: true },
      { id: 'r2', jobId: 'j1', clientId: 'c1', label: 'Sales invoices', documentType: 'Sales invoices', status: 'missing', required: true },
    ],
    communications: [],
    reminderSequences: [SEQUENCE],
  };
  return { ...base, ...over };
}
const WED_11AM = new Date('2026-09-16T10:00:00Z');
const plan = (snapshot, now = WED_11AM, pending) => planReminders({ snapshot, now, pending });
const sentComm = (sentAt, stage = 'Email (30 days)') => ({ id: `cm_${sentAt}`, jobId: 'j1', clientId: 'c1', direction: 'outbound', channel: 'email', sentAt, reminderStage: stage, responseStatus: 'awaiting' });

describe('planReminders — what is due', () => {
  it('drafts the reminder the composer would, to the main contact, from the assigned person', () => {
    const { due, needsYou, waiting, enabled, today, workingHours } = plan(world());
    expect(enabled).toBe(true);
    expect(today).toBe('2026-09-16');
    expect(workingHours).toBe(true);
    expect(needsYou).toEqual([]);
    expect(waiting).toEqual([]);
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({ jobId: 'j1', clientName: 'Acme Ltd', stage: 'Email (30 days)', stepNo: 0, to: 'dave@acme.example', contactName: 'Dave Thompson', sender: 'Assigned Person', subject: 'Acme Ltd — 2025 Annual Accounts: documents still needed', documentsRequested: ['Sales invoices'] });
    expect(due[0].body).toContain('Hi Dave,');
    expect(due[0].body).toContain('Thanks for sending your bank statements.');
    expect(due[0].body).toContain("We're still waiting for your sales invoices");
    expect(due[0].body.endsWith('Best wishes,\nAssigned Person\nFarhan & Raihan')).toBe(true);
  });

  it('sends nothing, and plans nothing, unless the practice switched it on', () => {
    for (const automation of [undefined, {}, { autoReminders: false }, { autoReminders: 'yes' }]) {
      const result = plan(world({ practice: { ...world().practice, automation } }));
      expect(result).toMatchObject({ enabled: false, due: [], needsYou: [], waiting: [] });
    }
  });

  it('falls back from the assigned person to the client’s owner to the first user', () => {
    expect(plan(world({ jobs: [{ ...world().jobs[0], assigneeUserId: undefined }] })).due[0].sender).toBe('Owner Person');
    expect(plan(world({ jobs: [{ ...world().jobs[0], assigneeUserId: undefined }], clients: [{ ...world().clients[0], ownerUserId: 'u_gone' }] })).due[0].sender).toBe('First Person');
  });

  it('plans the soonest deadline first', () => {
    const jobs = [
      { ...world().jobs[0], id: 'j_late', dueDate: '2026-10-15' },
      { ...world().jobs[0], id: 'j_soon', dueDate: '2026-10-10' },
    ];
    const items = jobs.map((j) => ({ id: `r_${j.id}`, jobId: j.id, clientId: 'c1', label: 'Sales invoices', documentType: 'x', status: 'missing', required: true }));
    expect(plan(world({ jobs, requestItems: items })).due.map((d) => d.jobId)).toEqual(['j_soon', 'j_late']);
  });
});

describe('planReminders — working hours', () => {
  const at = (iso) => plan(world(), new Date(iso)).workingHours;

  it('are weekdays 08:00 to 18:00 in the practice’s time zone', () => {
    expect(at('2026-09-16T06:59:00Z')).toBe(false); // 07:59 BST
    expect(at('2026-09-16T07:00:00Z')).toBe(true); // 08:00 BST
    expect(at('2026-09-16T16:59:00Z')).toBe(true); // 17:59 BST
    expect(at('2026-09-16T17:00:00Z')).toBe(false); // 18:00 BST
    expect(at('2026-09-19T10:00:00Z')).toBe(false); // Saturday
    expect(at('2026-09-20T10:00:00Z')).toBe(false); // Sunday
    expect(at('2026-12-16T08:00:00Z')).toBe(true); // 08:00 GMT in winter
    expect(at('2026-12-16T07:59:00Z')).toBe(false);
  });

  it('use the practice’s own zone, and London when none is set', () => {
    const tokyo = world({ practice: { ...world().practice, timezone: 'Asia/Tokyo' } });
    // 00:30 UTC is 09:30 on a Wednesday in Tokyo, but 01:30 in London.
    expect(plan(tokyo, new Date('2026-09-16T00:30:00Z')).workingHours).toBe(true);
    expect(plan(world(), new Date('2026-09-16T00:30:00Z')).workingHours).toBe(false);
    // Saturday evening UTC is already Sunday in Tokyo, and the date follows the practice, not the server.
    expect(plan(tokyo, new Date('2026-09-18T20:00:00Z')).today).toBe('2026-09-19');
    expect(plan(world({ practice: { ...world().practice, timezone: undefined } })).timezone).toBe('Europe/London');
  });
});

describe('planReminders — what is left alone', () => {
  it('skips clients who are not active, jobs that are filed, paused or complete', () => {
    expect(plan(world({ clients: [{ ...world().clients[0], lifecycle: 'dormant' }] })).due).toEqual([]);
    expect(plan(world({ clients: [{ ...world().clients[0], lifecycle: 'ceased' }] })).due).toEqual([]);
    expect(plan(world({ jobs: [{ ...world().jobs[0], status: 'filed' }] })).due).toEqual([]);
    expect(plan(world({ jobs: [{ ...world().jobs[0], chasingPaused: true }] })).due).toEqual([]);
    expect(plan(world({ requestItems: world().requestItems.map((i) => ({ ...i, status: 'received' })) })).due).toEqual([]);
    expect(plan(world({ jobs: [{ ...world().jobs[0], waitingOn: 'accountant' }] })).due).toEqual([]);
  });

  it('leaves a job alone until its next step is actually due', () => {
    expect(plan(world({ jobs: [{ ...world().jobs[0], dueDate: '2026-12-31' }] })).due).toEqual([]);
  });

  it('skips a job with no matching sequence, as the Chasing page does', () => {
    const result = plan(world({ reminderSequences: [] }));
    expect(result.due).toEqual([]);
    expect(result.needsYou).toEqual([]);
  });
});

describe('planReminders — what is handed back to a person', () => {
  const need = (snapshot, now, pending) => plan(snapshot, now, pending).needsYou.map((n) => n.code);

  it('a step that is a WhatsApp or text message', () => {
    const snapshot = world({ jobs: [{ ...world().jobs[0], dueDate: '2026-09-18' }], communications: [sentComm('2026-08-01T10:00:00Z'), sentComm('2026-09-01T10:00:00Z', 'Email + WhatsApp (14 days)')] });
    const result = plan(snapshot);
    expect(result.needsYou.map((n) => [n.code, n.stage, n.reason])).toEqual([['not_an_email_step', 'Urgent reminder (3 days)', NEEDS_YOU.not_an_email_step]]);
    expect(result.due).toEqual([]);
  });

  it('a sequence with every step already sent', () => {
    const comms = [sentComm('2026-07-01T10:00:00Z'), sentComm('2026-08-01T10:00:00Z'), sentComm('2026-09-01T10:00:00Z')];
    expect(need(world({ jobs: [{ ...world().jobs[0], dueDate: '2026-09-18' }], communications: comms }))).toEqual(['sequence_finished']);
  });

  it('a deadline long past', () => {
    expect(need(world({ jobs: [{ ...world().jobs[0], dueDate: '2026-08-01' }] }))).toEqual(['long_overdue']);
    expect(need(world({ jobs: [{ ...world().jobs[0], dueDate: '2026-08-17' }] }))).toEqual([]); // 30 days: still within reach
    expect(plan(world({ jobs: [{ ...world().jobs[0], dueDate: '2026-08-17' }] })).due).toHaveLength(1);
  });

  it('a client who prefers another channel', () => {
    for (const preferredChannel of ['whatsapp', 'sms', 'phone', 'portal']) {
      expect(need(world({ clients: [{ ...world().clients[0], preferredChannel }] }))).toEqual(['prefers_other_channel']);
    }
  });

  it('a main contact with no usable email address', () => {
    for (const email of [undefined, '', '  ', 'not an email', 'a@b', 'x'.repeat(250) + '@acme.example']) {
      const contacts = [{ ...world().contacts[1], email }];
      expect(need(world({ contacts }))).toEqual(['no_email']);
    }
    expect(need(world({ contacts: [] }))).toEqual(['no_email']);
  });

  it('falls back to any contact when none is marked main', () => {
    expect(plan(world({ contacts: [{ ...world().contacts[0], isPrimary: false }] })).due[0].to).toBe('lisa@acme.example');
  });
});

describe('planReminders — not too often', () => {
  const afterOneReminder = (sentAt, extra) => {
    const snapshot = world({ jobs: [{ ...world().jobs[0], dueDate: '2026-09-28' }], communications: [sentComm(sentAt)] });
    return plan(snapshot, WED_11AM, extra);
  };

  it('holds a job for 48 hours after its last reminder', () => {
    expect(RULES.minGapHours).toBe(48);
    const recent = afterOneReminder('2026-09-15T10:00:00Z');
    expect(recent.due).toEqual([]);
    expect(recent.waiting.map((w) => [w.jobId, w.stepNo])).toEqual([['j1', 1]]);
    expect(afterOneReminder('2026-09-14T09:59:00Z').due).toHaveLength(1);
  });

  it('counts a reminder the server sent that the snapshot does not record yet, for the step and for the gap', () => {
    const none = plan(world());
    expect(none.due[0].stepNo).toBe(0);
    const pending = new Map([['j1', { count: 1, lastSentAt: '2026-09-16T09:00:00.000Z' }]]);
    const result = plan(world({ jobs: [{ ...world().jobs[0], dueDate: '2026-09-28' }] }), WED_11AM, pending);
    expect(result.due).toEqual([]);
    expect(result.waiting.map((w) => w.stepNo)).toEqual([1]);
    const oldPending = new Map([['j1', { count: 1, lastSentAt: '2026-09-10T09:00:00.000Z' }]]);
    expect(plan(world({ jobs: [{ ...world().jobs[0], dueDate: '2026-09-28' }] }), WED_11AM, oldPending).due.map((d) => d.stepNo)).toEqual([1]);
  });
});
