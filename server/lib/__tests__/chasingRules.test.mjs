import { describe, expect, it } from 'vitest';
import * as server from '../chasingRules.mjs';
import { assessChasing, draftReminder, nextReminderStep } from '../../../src/domain/rules/chasing.ts';
import { sequenceIdFor } from '../../../src/domain/rules/attention.ts';
import { computeCompleteness } from '../../../src/domain/rules/completeness.ts';
import { daysUntil } from '../../../src/domain/dates.ts';
import { buildFixtureData } from '../../../src/testing/fixtures';

/**
 * The server's copy of the chasing rules must give exactly the answers the
 * TypeScript original gives, on every job in a realistic practice and on
 * every day around its deadline — otherwise the automatic reminders would
 * decide differently from the Chasing page a person looks at.
 */
const TODAYS = ['2026-09-11', '2026-10-05', '2026-12-31', '2027-02-01'];

describe('chasing rules: the server copy matches the original', () => {
  const data = buildFixtureData('2026-09-11');

  it('has a fixture rich enough to mean something', () => {
    expect(data.jobs.length).toBeGreaterThan(15);
    expect(data.reminderSequences.length).toBeGreaterThan(1);
    expect(data.communications.some((c) => c.reminderStage)).toBe(true);
  });

  it('computes completeness the same', () => {
    for (const job of data.jobs) {
      const items = data.requestItems.filter((i) => i.jobId === job.id);
      expect(server.computeCompleteness(items)).toEqual(computeCompleteness(items));
    }
  });

  it('counts days the same, either side of a deadline and across a clock change', () => {
    for (const [due, today] of [['2026-10-31', '2026-10-24'], ['2026-03-29', '2026-03-27'], ['2026-09-11', '2026-09-11'], ['2026-01-01', '2026-12-31']]) {
      expect(server.daysUntil(due, today)).toBe(daysUntil(due, today));
    }
  });

  it('assesses every job the same on several days, with every sequence', () => {
    let assessed = 0;
    let required = 0;
    for (const today of TODAYS) {
      for (const job of data.jobs) {
        for (const sequence of [...data.reminderSequences, undefined]) {
          const original = assessChasing(job, data.requestItems, data.communications, sequence, today);
          expect(server.assessChasing(job, data.requestItems, data.communications, sequence, today)).toEqual(original);
          assessed += 1;
          if (original.required) required += 1;
        }
      }
    }
    expect(assessed).toBeGreaterThan(100);
    expect(required).toBeGreaterThan(10);
  });

  it('picks the next step the same, however many reminders have gone', () => {
    const job = data.jobs.find((j) => j.status === 'waiting_for_records');
    for (const sequence of data.reminderSequences) {
      for (let sent = 0; sent < 7; sent += 1) {
        for (const today of TODAYS) expect(server.nextReminderStep(job, sequence, sent, today)).toEqual(nextReminderStep(job, sequence, sent, today));
      }
    }
  });

  it('drafts every reminder the same, on every channel', () => {
    const sender = data.users[0];
    let drafted = 0;
    for (const today of TODAYS) {
      for (const job of data.jobs) {
        const client = data.clients.find((c) => c.id === job.clientId);
        const contact = data.contacts.find((c) => c.id === client.primaryContactId);
        const sequence = data.reminderSequences[0];
        for (const channel of ['email', 'whatsapp', 'sms']) {
          for (const step of [undefined, ...sequence.steps]) {
            const opts = { client, contact, job, items: data.requestItems, channel, step, sender, practiceName: data.practice.name, today };
            expect(server.draftReminder(opts)).toEqual(draftReminder(opts));
            drafted += 1;
          }
        }
      }
    }
    expect(drafted).toBeGreaterThan(500);
  });

  it('counts reminders the snapshot has not recorded yet, and otherwise changes nothing', () => {
    const job = data.jobs.find((j) => j.status === 'waiting_for_records' && j.waitingOn === 'client');
    const sequence = data.reminderSequences[0];
    const items = data.requestItems.filter((i) => i.jobId === job.id).map((i) => ({ ...i, status: 'missing' }));
    const plain = server.assessChasing(job, items, [], sequence, '2026-09-11');
    expect(server.assessChasing(job, items, [], sequence, '2026-09-11', 0)).toEqual(plain);
    const withOneMore = server.assessChasing(job, items, [], sequence, '2026-09-11', 1);
    expect(withOneMore.remindersSent).toBe(plain.remindersSent + 1);
    expect(withOneMore.nextStep).toEqual(sequence.steps[Math.min(1, sequence.steps.length - 1)]);
  });

  it('chooses a sequence for every kind of service the same', () => {
    const codes = new Set(data.jobs.map((j) => j.serviceCode));
    for (const code of [...codes, 'vat', 'mtd_income_tax', 'payroll', 'bookkeeping_review', 'self_assessment', 'confirmation_statement', 'annual_accounts', 'something_new']) {
      expect(server.sequenceIdFor(code)).toBe(sequenceIdFor(code));
    }
  });
});
