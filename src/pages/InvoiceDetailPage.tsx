import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Printer } from 'lucide-react';
import { PageHeader } from '../ui/components/PageHeader';
import { Card, CardBody, CardHeader } from '../ui/components/Card';
import { Button } from '../ui/components/Button';
import { Modal } from '../ui/components/Modal';
import { InvoiceStatusBadge } from '../ui/components/Badge';
import { useAppStore } from '../application/store';
import { useData, useDerived, useToday } from '../application/selectors';
import { formatDate } from '../domain/dates';
import { formatPounds } from '../domain/rules';
import { NotFoundPage } from './NotFoundPage';

export function InvoiceDetailPage() {
  const { invoiceId } = useParams();
  const data = useData();
  const derived = useDerived();
  const today = useToday();
  const updateInvoiceStatus = useAppStore((s) => s.updateInvoiceStatus);
  const voidInvoice = useAppStore((s) => s.voidInvoice);
  const toast = useAppStore((s) => s.toast);
  const [confirmVoid, setConfirmVoid] = useState(false);

  const invoice = data.invoices.find((i) => i.id === invoiceId);
  if (!invoice) return <NotFoundPage />;
  const client = derived.clientById.get(invoice.clientId);

  return (
    <div className="animate-in">
      <PageHeader
        eyebrow={client && <Link to={`/clients/${client.id}`} className="hover:underline">{client.name}</Link>}
        title={invoice.number}
        actions={
          <>
            <InvoiceStatusBadge invoice={invoice} today={today} />
            {invoice.status === 'draft' && (
              <Button
                size="sm"
                onClick={() => {
                  updateInvoiceStatus(invoice.id, 'sent');
                  toast({ title: 'Marked as sent', tone: 'success' });
                }}
                data-testid="invoice-mark-sent"
              >
                Mark sent
              </Button>
            )}
            {invoice.status === 'sent' && (
              <Button
                size="sm"
                onClick={() => {
                  updateInvoiceStatus(invoice.id, 'paid');
                  toast({ title: 'Marked as paid', tone: 'success' });
                }}
                data-testid="invoice-mark-paid"
              >
                Mark paid
              </Button>
            )}
            {(invoice.status === 'draft' || invoice.status === 'sent') && (
              <Button size="sm" variant="danger" onClick={() => setConfirmVoid(true)} data-testid="invoice-void-open">
                Void
              </Button>
            )}
            <Button size="sm" variant="secondary" icon={<Printer />} onClick={() => window.print()} data-testid="invoice-print">
              Print
            </Button>
          </>
        }
      />
      <div id="invoice-print-area">
        <Card>
          <CardHeader title="Line items" description={`Issued ${formatDate(invoice.issuedOn)} · Due ${formatDate(invoice.dueOn)}${invoice.paidOn ? ` · Paid ${formatDate(invoice.paidOn)}` : ''}`} />
          <CardBody className="pt-0">
            <ul className="divide-y divide-slate-100">
              {invoice.lineItems.map((li) => (
                <li key={li.id} className="py-2.5 flex items-center justify-between gap-3">
                  <span className="text-[13px] text-slate-900">{li.description}</span>
                  <span className="text-[13px] font-medium">{formatPounds(li.amount)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-3 pt-3 border-t border-slate-200 flex items-center justify-between">
              <span className="text-sm font-semibold">Subtotal</span>
              <span className="text-sm font-semibold">{formatPounds(invoice.subtotal)}</span>
            </div>
            {invoice.note && <p className="mt-3 text-[13px] text-slate-600">{invoice.note}</p>}
          </CardBody>
        </Card>
      </div>
      <Modal
        open={confirmVoid}
        onClose={() => setConfirmVoid(false)}
        title="Void this invoice?"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmVoid(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                voidInvoice(invoice.id);
                setConfirmVoid(false);
                toast({ title: 'Invoice voided', tone: 'success' });
              }}
              data-testid="invoice-void-confirm"
            >
              Void invoice
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-slate-600">Any billed work in progress goes back to unbilled. This can't be undone.</p>
      </Modal>
    </div>
  );
}
