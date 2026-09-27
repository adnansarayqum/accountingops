import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Receipt, FilePlus } from 'lucide-react';
import { Card, CardBody, CardHeader } from './Card';
import { Button } from './Button';
import { InvoiceStatusBadge } from './Badge';
import { CreateInvoiceModal } from './CreateInvoiceModal';
import { useData, useToday } from '../../application/selectors';
import { formatDate } from '../../domain/dates';
import { formatPounds } from '../../domain/rules';

/** The `ClientDetailPage` sibling of `WipCard`/`TimeTrackingCard`: this client's invoices, and a way to create one from its unbilled work. */
export function InvoicesCard({ clientId }: { clientId: string }) {
  const data = useData();
  const today = useToday();
  const [modalOpen, setModalOpen] = useState(false);

  const invoices = data.invoices.filter((i) => i.clientId === clientId).sort((a, b) => (a.issuedOn < b.issuedOn ? 1 : -1));
  const outstanding = invoices.filter((i) => i.status === 'sent' || i.status === 'draft');
  const outstandingTotal = outstanding.reduce((sum, i) => sum + i.subtotal, 0);

  return (
    <Card data-testid="invoices-card">
      <CardHeader
        title="Invoices"
        icon={<Receipt />}
        description={invoices.length === 0 ? 'No invoices yet for this client.' : `${formatPounds(outstandingTotal)} outstanding across ${outstanding.length} invoice${outstanding.length === 1 ? '' : 's'}.`}
        action={
          <Button size="sm" variant="secondary" icon={<FilePlus />} onClick={() => setModalOpen(true)} data-testid="invoice-create-open">
            Create invoice
          </Button>
        }
      />
      {invoices.length > 0 && (
        <CardBody className="pt-0">
          <ul className="divide-y divide-slate-100">
            {invoices.map((inv) => (
              <li key={inv.id} className="py-2.5" data-testid={`invoice-row-${inv.id}`}>
                <Link to={`/invoices/${inv.id}`} className="flex items-center justify-between gap-3 group">
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-slate-900 group-hover:text-primary-700">{inv.number}</p>
                    <p className="text-xs text-slate-500">
                      {formatDate(inv.issuedOn)} · {formatPounds(inv.subtotal)}
                    </p>
                  </div>
                  <InvoiceStatusBadge invoice={inv} today={today} />
                </Link>
              </li>
            ))}
          </ul>
        </CardBody>
      )}
      <CreateInvoiceModal clientId={clientId} open={modalOpen} onClose={() => setModalOpen(false)} />
    </Card>
  );
}
