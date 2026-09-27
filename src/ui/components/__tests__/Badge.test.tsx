import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { InvoiceStatusBadge } from '../Badge';
import type { Invoice } from '../../../domain/types';

function invoice(patch: Partial<Invoice>): Invoice {
  return {
    id: 'inv_1',
    practiceId: 'prac_1',
    clientId: 'cl_1',
    number: 'INV-1001',
    lineItems: [],
    subtotal: 100,
    status: 'draft',
    issuedOn: '2026-09-01',
    dueOn: '2026-09-15',
    createdAt: '2026-09-01T09:00:00Z',
    ...patch,
  };
}

describe('InvoiceStatusBadge', () => {
  it('reads Overdue, not Sent, once a sent invoice is past its due date', () => {
    render(<InvoiceStatusBadge invoice={invoice({ status: 'sent', dueOn: '2026-09-01' })} today="2026-09-11" />);
    expect(screen.getByText('Overdue')).toBeInTheDocument();
    expect(screen.queryByText('Sent')).not.toBeInTheDocument();
  });

  it('reads Sent while a sent invoice is not yet due', () => {
    render(<InvoiceStatusBadge invoice={invoice({ status: 'sent', dueOn: '2026-09-30' })} today="2026-09-11" />);
    expect(screen.getByText('Sent')).toBeInTheDocument();
  });

  it('never reads Overdue for a draft, however old the due date', () => {
    render(<InvoiceStatusBadge invoice={invoice({ status: 'draft', dueOn: '2026-01-01' })} today="2026-09-11" />);
    expect(screen.getByText('Draft')).toBeInTheDocument();
    expect(screen.queryByText('Overdue')).not.toBeInTheDocument();
  });

  it('never reads Overdue once paid', () => {
    render(<InvoiceStatusBadge invoice={invoice({ status: 'paid', dueOn: '2026-01-01' })} today="2026-09-11" />);
    expect(screen.getByText('Paid')).toBeInTheDocument();
  });
});
