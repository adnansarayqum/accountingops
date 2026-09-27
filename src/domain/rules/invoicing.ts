import type { Invoice } from '../types';
import { daysUntil } from '../dates';

const FIRST_INVOICE_NUMBER = 1001;
const INVOICE_NUMBER_PATTERN = /^INV-(\d+)$/;

/**
 * The next sequential invoice number for a practice, e.g. "INV-1050"
 * following "INV-1049". Starts above 1000 so a first invoice doesn't read
 * as "INV-1". Voided invoices keep their number — it's never reused.
 */
export function nextInvoiceNumber(existing: Invoice[]): string {
  let highest = FIRST_INVOICE_NUMBER - 1;
  for (const invoice of existing) {
    const match = INVOICE_NUMBER_PATTERN.exec(invoice.number);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return `INV-${highest + 1}`;
}

/**
 * Converts logged minutes into a pounds amount at the practice's default
 * hourly rate. No rate configured means nothing to bill — never guess a
 * price for a practice that hasn't set one.
 */
export function timeEntryAmount(minutes: number, hourlyRate: number | undefined): number {
  if (!hourlyRate) return 0;
  return Math.round((minutes / 60) * hourlyRate);
}

export function invoiceSubtotal(lineItems: { amount: number }[]): number {
  return lineItems.reduce((sum, item) => sum + item.amount, 0);
}

/**
 * A sent invoice past its due date reads as overdue without needing its own
 * stored status — the same convention a job's due date already uses (see
 * attention.ts): overdue is derived, never a state someone has to remember
 * to set.
 */
export function isInvoiceOverdue(invoice: Invoice, today: string): boolean {
  return invoice.status === 'sent' && daysUntil(invoice.dueOn, today) < 0;
}
