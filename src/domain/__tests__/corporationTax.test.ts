import { describe, expect, it } from 'vitest';
import { applyCorporationTaxBackfill, buildCorporationTaxRecords, corporationTaxFilingDue, corporationTaxPaymentDue, findMissingCorporationTax } from '../corporationTax';
import type { Client, Obligation } from '../types';

const client = (id: string, name: string, extra: Partial<Client> = {}): Client =>
  ({
    id,
    practiceId: 'prac',
    name,
    type: 'limited_company',
    lifecycle: 'active',
    ownerUserId: 'u1',
    primaryContactId: 'ct1',
    preferredChannel: 'email',
    averageResponseDays: 5,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...extra,
  }) as Client;

const obligation = (id: string, clientId: string, serviceCode: Obligation['serviceCode'], lastPeriodEnd: string): Obligation => ({
  id,
  practiceId: 'prac',
  clientId,
  serviceCode,
  name: serviceCode,
  frequency: 'annual',
  lastPeriodEnd,
  dueOffsetDays: 273,
  periodLengthMonths: 12,
});

describe('corporation tax statutory dates', () => {
  it('files the CT600 12 months after the end of the accounting period', () => {
    expect(corporationTaxFilingDue('2025-03-31')).toBe('2026-03-31');
    expect(corporationTaxFilingDue('2025-12-31')).toBe('2026-12-31');
  });

  it('makes the tax payable 9 months and 1 day after the period end', () => {
    // 31 Dec 2025 + 9 months = 30 Sep 2026, + 1 day = 1 Oct 2026.
    expect(corporationTaxPaymentDue('2025-12-31')).toBe('2026-10-01');
    // 31 Mar 2025 + 9 months = 31 Dec 2025, + 1 day = 1 Jan 2026.
    expect(corporationTaxPaymentDue('2025-03-31')).toBe('2026-01-01');
  });

  it('clamps to the end of a shorter month before adding the extra day', () => {
    // 31 May 2025 + 9 months lands in February, which has no 31st.
    expect(corporationTaxPaymentDue('2025-05-31')).toBe('2026-03-01');
    // A leap-day period end has no 29 February a year later.
    expect(corporationTaxFilingDue('2024-02-29')).toBe('2025-02-28');
  });

  it('always leaves the payment deadline earlier than the filing deadline', () => {
    for (const periodEnd of ['2025-01-31', '2025-02-28', '2025-04-30', '2025-06-30', '2025-08-31', '2025-11-30']) {
      expect(corporationTaxPaymentDue(periodEnd) < corporationTaxFilingDue(periodEnd)).toBe(true);
    }
  });
});

describe('findMissingCorporationTax', () => {
  const today = '2026-09-12';

  it('finds limited companies with an accounting period but no corporation tax', () => {
    const data = {
      clients: [client('cl_a', 'Acme Ltd')],
      obligations: [obligation('ob1', 'cl_a', 'annual_accounts', '2025-12-31')],
    };
    expect(findMissingCorporationTax(data, today)).toEqual([
      { clientId: 'cl_a', clientName: 'Acme Ltd', periodEnd: '2025-12-31', dueDate: '2026-12-31', paymentDue: '2026-10-01', alreadyOverdue: false },
    ]);
  });

  it('skips a client that already has corporation tax on file, so re-running does nothing', () => {
    const data = {
      clients: [client('cl_a', 'Acme Ltd')],
      obligations: [obligation('ob1', 'cl_a', 'annual_accounts', '2025-12-31'), obligation('ob2', 'cl_a', 'corporation_tax', '2025-12-31')],
    };
    expect(findMissingCorporationTax(data, today)).toEqual([]);
  });

  it('skips clients with no accounting period on file rather than guessing one', () => {
    const data = {
      clients: [client('cl_a', 'Acme Ltd')],
      obligations: [obligation('ob1', 'cl_a', 'confirmation_statement', '2025-12-31')],
    };
    expect(findMissingCorporationTax(data, today)).toEqual([]);
  });

  it('only covers limited companies that are still trading', () => {
    const data = {
      clients: [client('cl_a', 'Sole Trader', { type: 'sole_trader' }), client('cl_b', 'Ceased Ltd', { lifecycle: 'ceased' }), client('cl_c', 'Live Ltd')],
      obligations: [
        obligation('ob1', 'cl_a', 'annual_accounts', '2025-12-31'),
        obligation('ob2', 'cl_b', 'annual_accounts', '2025-12-31'),
        obligation('ob3', 'cl_c', 'annual_accounts', '2025-12-31'),
      ],
    };
    expect(findMissingCorporationTax(data, today).map((m) => m.clientId)).toEqual(['cl_c']);
  });

  it('flags a period whose filing deadline has already passed', () => {
    const data = {
      clients: [client('cl_a', 'Behind Ltd')],
      obligations: [obligation('ob1', 'cl_a', 'annual_accounts', '2025-03-31')],
    };
    const [row] = findMissingCorporationTax(data, today);
    expect(row).toMatchObject({ dueDate: '2026-03-31', alreadyOverdue: true });
  });

  it('orders by deadline so the most urgent is first', () => {
    const data = {
      clients: [client('cl_a', 'Later Ltd'), client('cl_b', 'Sooner Ltd')],
      obligations: [obligation('ob1', 'cl_a', 'annual_accounts', '2026-06-30'), obligation('ob2', 'cl_b', 'annual_accounts', '2026-01-31')],
    };
    expect(findMissingCorporationTax(data, today).map((m) => m.clientId)).toEqual(['cl_b', 'cl_a']);
  });
});

describe('applyCorporationTaxBackfill', () => {
  const newId = (() => {
    let n = 0;
    return (prefix: string) => `${prefix}_${++n}`;
  })();

  it('creates a subscription, obligation, job and checklist per client', () => {
    const data = {
      practice: { id: 'prac' },
      clients: [client('cl_a', 'Acme Ltd')],
      obligations: [obligation('ob1', 'cl_a', 'annual_accounts', '2025-12-31')],
      subscriptions: [],
      jobs: [],
      requestItems: [],
    } as never as Parameters<typeof applyCorporationTaxBackfill>[0] & { clients: Client[] };

    const rows = findMissingCorporationTax(data as never, '2026-09-12');
    const summary = applyCorporationTaxBackfill(data, rows, newId);

    expect(summary).toEqual({ clientsUpdated: 1, jobsCreated: 1, overdueCreated: 0 });
    expect(data.subscriptions).toHaveLength(1);
    expect(data.obligations.filter((o) => o.serviceCode === 'corporation_tax')).toHaveLength(1);
    expect(data.jobs).toHaveLength(1);
    expect(data.jobs[0]).toMatchObject({
      clientId: 'cl_a',
      serviceCode: 'corporation_tax',
      periodEnd: '2025-12-31',
      periodStart: '2025-01-01',
      dueDate: '2026-12-31',
      periodKey: '2025',
      status: 'waiting_for_records',
    });
    expect(data.requestItems.length).toBeGreaterThan(0);
    expect(data.requestItems.every((r) => r.jobId === data.jobs[0].id)).toBe(true);
  });

  it('counts periods that land already overdue', () => {
    const data = {
      practice: { id: 'prac' },
      clients: [client('cl_a', 'Behind Ltd')],
      obligations: [obligation('ob1', 'cl_a', 'annual_accounts', '2025-03-31')],
      subscriptions: [],
      jobs: [],
      requestItems: [],
    } as never as Parameters<typeof applyCorporationTaxBackfill>[0] & { clients: Client[] };
    const rows = findMissingCorporationTax(data as never, '2026-09-12');
    expect(applyCorporationTaxBackfill(data, rows, newId).overdueCreated).toBe(1);
  });

  it('is idempotent — a second pass finds nothing left to create', () => {
    const data = {
      practice: { id: 'prac' },
      clients: [client('cl_a', 'Acme Ltd')],
      obligations: [obligation('ob1', 'cl_a', 'annual_accounts', '2025-12-31')],
      subscriptions: [],
      jobs: [],
      requestItems: [],
    } as never as Parameters<typeof applyCorporationTaxBackfill>[0] & { clients: Client[] };
    applyCorporationTaxBackfill(data, findMissingCorporationTax(data as never, '2026-09-12'), newId);
    expect(findMissingCorporationTax(data as never, '2026-09-12')).toEqual([]);
  });
});

describe('buildCorporationTaxRecords', () => {
  it('names the job by the period the return covers', () => {
    const into = { subscriptions: [], obligations: [], jobs: [], requestItems: [] };
    const { job } = buildCorporationTaxRecords({ practiceId: 'prac', clientId: 'cl_a', periodEnd: '2026-03-31', today: '2026-09-12' }, into, (p) => `${p}_x`);
    expect(job.name).toBe('2026 Corporation Tax');
    expect(job.dueDate).toBe('2027-03-31');
  });
});
