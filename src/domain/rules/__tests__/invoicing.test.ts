import { describe, expect, it } from 'vitest';
import { invoiceSubtotal, isInvoiceOverdue, nextInvoiceNumber, timeEntryAmount } from '../invoicing';
import type { Invoice } from '../../types';

function invoice(patch: Partial<Invoice>): Invoice {
  return {
    id: 'inv_1',
    practiceId: 'prac_1',
    clientId: 'cl_1',
    number: 'INV-1001',
    lineItems: [],
    subtotal: 0,
    status: 'draft',
    issuedOn: '2026-09-01',
    dueOn: '2026-09-15',
    createdAt: '2026-09-01T09:00:00Z',
    ...patch,
  };
}

describe('nextInvoiceNumber', () => {
  it('starts above 1000 for a practice with no invoices yet', () => {
    expect(nextInvoiceNumber([])).toBe('INV-1001');
  });

  it('follows the highest existing number, not just the last one in the list', () => {
    const existing = [invoice({ number: 'INV-1001' }), invoice({ number: 'INV-1050' }), invoice({ number: 'INV-1020' })];
    expect(nextInvoiceNumber(existing)).toBe('INV-1051');
  });

  it('keeps counting past a voided invoice — its number is never reused', () => {
    const existing = [invoice({ number: 'INV-1001', status: 'void' })];
    expect(nextInvoiceNumber(existing)).toBe('INV-1002');
  });

  it('ignores anything that is not shaped like one of this app\'s invoice numbers', () => {
    expect(nextInvoiceNumber([invoice({ number: 'INV-abc' }), invoice({ number: 'CUSTOM-9999' })])).toBe('INV-1001');
  });
});

describe('timeEntryAmount', () => {
  it('returns zero when no rate is configured — never guesses a price', () => {
    expect(timeEntryAmount(120, undefined)).toBe(0);
  });

  it('converts minutes to pounds at the hourly rate, rounded', () => {
    expect(timeEntryAmount(60, 60)).toBe(60);
    expect(timeEntryAmount(45, 60)).toBe(45);
    expect(timeEntryAmount(10, 75)).toBe(13); // 10/60 * 75 = 12.5 -> rounds up
  });
});

describe('invoiceSubtotal', () => {
  it('sums every line item amount', () => {
    expect(invoiceSubtotal([{ amount: 100 }, { amount: 45 }, { amount: 0 }])).toBe(145);
  });

  it('is zero with no line items', () => {
    expect(invoiceSubtotal([])).toBe(0);
  });
});

describe('isInvoiceOverdue', () => {
  it('is never overdue while still a draft, however old the due date', () => {
    expect(isInvoiceOverdue(invoice({ status: 'draft', dueOn: '2026-01-01' }), '2026-09-11')).toBe(false);
  });

  it('is overdue once sent and past its due date', () => {
    expect(isInvoiceOverdue(invoice({ status: 'sent', dueOn: '2026-09-01' }), '2026-09-11')).toBe(true);
  });

  it('is not overdue on or before its due date', () => {
    expect(isInvoiceOverdue(invoice({ status: 'sent', dueOn: '2026-09-11' }), '2026-09-11')).toBe(false);
  });

  it('is never overdue once paid, however late it was paid', () => {
    expect(isInvoiceOverdue(invoice({ status: 'paid', dueOn: '2026-01-01' }), '2026-09-11')).toBe(false);
  });
});
