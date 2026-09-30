import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Receipt } from 'lucide-react';
import { PageHeader } from '../ui/components/PageHeader';
import { Card } from '../ui/components/Card';
import { EmptyState } from '../ui/components/EmptyState';
import { Select } from '../ui/components/Form';
import { InvoiceStatusBadge } from '../ui/components/Badge';
import { useData, useDerived, useToday } from '../application/selectors';
import { INVOICE_STATUS_LABELS } from '../domain/catalog';
import { formatDate } from '../domain/dates';
import { formatPounds } from '../domain/rules';
import type { InvoiceStatus } from '../domain/types';

const STATUSES: InvoiceStatus[] = ['draft', 'sent', 'paid', 'void'];

export function InvoicesPage() {
  const data = useData();
  const derived = useDerived();
  const today = useToday();
  const [params, setParams] = useSearchParams();
  const status = (params.get('status') ?? 'all') as InvoiceStatus | 'all';
  const clientId = params.get('client') ?? 'all';

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value === 'all') next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };

  const rows = useMemo(
    () =>
      data.invoices
        .filter((i) => (status === 'all' ? true : i.status === status))
        .filter((i) => (clientId === 'all' ? true : i.clientId === clientId))
        .flatMap((invoice) => {
          const client = derived.clientById.get(invoice.clientId);
          return client ? [{ invoice, client }] : [];
        })
        .sort((a, b) => (a.invoice.issuedOn < b.invoice.issuedOn ? 1 : -1)),
    [data.invoices, derived, status, clientId],
  );

  return (
    <div className="animate-in">
      <PageHeader title="Invoices" description={`${data.invoices.length} invoice${data.invoices.length === 1 ? '' : 's'} across ${data.clients.length} client${data.clients.length === 1 ? '' : 's'}.`} />
      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <Select value={status} onChange={(e) => set('status', e.target.value)} aria-label="Status" className="sm:w-44">
          <option value="all">Any status</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {INVOICE_STATUS_LABELS[s]}
            </option>
          ))}
        </Select>
        <Select value={clientId} onChange={(e) => set('client', e.target.value)} aria-label="Client" className="sm:w-56">
          <option value="all">All clients</option>
          {data.clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </div>
      <Card>
        {rows.length === 0 ? (
          <EmptyState icon={<Receipt />} title="No invoices match these filters" description="Try widening the filters, or create an invoice from a client's page." compact />
        ) : (
          <ul className="divide-y divide-slate-100" data-testid="invoices-list">
            {rows.map(({ invoice, client }) => (
              <li key={invoice.id} data-testid={`invoice-list-row-${invoice.id}`}>
                <Link to={`/invoices/${invoice.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50">
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-slate-900">
                      {invoice.number} · {client.name}
                    </p>
                    <p className="text-xs text-slate-500">
                      {formatDate(invoice.issuedOn)} · {formatPounds(invoice.subtotal)}
                    </p>
                  </div>
                  <InvoiceStatusBadge invoice={invoice} today={today} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
