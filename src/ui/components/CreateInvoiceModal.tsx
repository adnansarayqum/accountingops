import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal } from './Modal';
import { Button } from './Button';
import { formatDuration } from './WorkRecordCards';
import { useAppStore } from '../../application/store';
import { useData } from '../../application/selectors';
import { timeEntryAmount, formatPounds } from '../../domain/rules';

function toggle(set: Set<string>, id: string): Set<string> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/**
 * Picks from a client's unbilled WIP entries and not-yet-billed time entries
 * and bills them as one invoice. The running total sums selected minutes
 * first and rounds once — matching exactly how `createInvoice` prices the
 * real line item, so this preview never drifts from what gets created.
 */
export function CreateInvoiceModal({ clientId, open, onClose }: { clientId: string; open: boolean; onClose: () => void }) {
  const data = useData();
  const createInvoice = useAppStore((s) => s.createInvoice);
  const toast = useAppStore((s) => s.toast);
  const navigate = useNavigate();

  const [wipIds, setWipIds] = useState<Set<string>>(new Set());
  const [timeIds, setTimeIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (open) {
      setWipIds(new Set());
      setTimeIds(new Set());
    }
  }, [open, clientId]);

  // Eligibility mirrors what the store itself will accept: unbilled WIP, and
  // time entries not already referenced by any non-void invoice.
  const billedTimeIds = useMemo(() => new Set(data.invoices.filter((i) => i.status !== 'void').flatMap((i) => i.lineItems.flatMap((li) => li.timeEntryIds ?? []))), [data.invoices]);
  const eligibleWip = data.wipEntries.filter((w) => w.clientId === clientId && w.status === 'unbilled');
  const eligibleTime = data.timeEntries.filter((t) => t.clientId === clientId && !billedTimeIds.has(t.id));

  const wipTotal = eligibleWip.filter((w) => wipIds.has(w.id)).reduce((sum, w) => sum + w.amount, 0);
  const selectedMinutes = eligibleTime.filter((t) => timeIds.has(t.id)).reduce((sum, t) => sum + t.minutes, 0);
  const timeTotal = timeEntryAmount(selectedMinutes, data.practice.defaultHourlyRate);
  const total = wipTotal + timeTotal;

  const save = () => {
    if (wipIds.size === 0 && timeIds.size === 0) {
      toast({ title: 'Select at least one item to invoice', tone: 'error' });
      return;
    }
    try {
      const invoice = createInvoice(clientId, { wipEntryIds: [...wipIds], timeEntryIds: [...timeIds] });
      toast({ title: `Invoice ${invoice.number} created`, tone: 'success' });
      onClose();
      navigate(`/invoices/${invoice.id}`);
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Could not create the invoice', tone: 'error' });
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create invoice"
      description="Pick the unbilled work and logged time to include."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={total === 0} data-testid="create-invoice-save">
            Create invoice · {formatPounds(total)}
          </Button>
        </>
      }
    >
      <div className="space-y-4" data-testid="create-invoice-form">
        {eligibleWip.length === 0 && eligibleTime.length === 0 ? (
          <p className="text-[13px] text-slate-500">Nothing unbilled for this client.</p>
        ) : (
          <>
            {eligibleWip.length > 0 && (
              <div>
                <p className="text-xs font-medium text-slate-500 mb-1.5">Unbilled work</p>
                <ul className="space-y-1.5">
                  {eligibleWip.map((w) => (
                    <li key={w.id}>
                      <label className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 text-[13px] cursor-pointer hover:bg-slate-50" data-testid={`create-invoice-wip-${w.id}`}>
                        <span className="flex items-center gap-2 min-w-0">
                          <input type="checkbox" checked={wipIds.has(w.id)} onChange={() => setWipIds((s) => toggle(s, w.id))} className="shrink-0" />
                          <span className="truncate">{w.description}</span>
                        </span>
                        <span className="shrink-0 font-medium">{formatPounds(w.amount)}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {eligibleTime.length > 0 && (
              <div>
                <p className="text-xs font-medium text-slate-500 mb-1.5">Logged time{!data.practice.defaultHourlyRate ? ' — no hourly rate set, will bill at £0' : ` at ${formatPounds(data.practice.defaultHourlyRate)}/hr`}</p>
                <ul className="space-y-1.5">
                  {eligibleTime.map((t) => (
                    <li key={t.id}>
                      <label className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 text-[13px] cursor-pointer hover:bg-slate-50" data-testid={`create-invoice-time-${t.id}`}>
                        <span className="flex items-center gap-2 min-w-0">
                          <input type="checkbox" checked={timeIds.has(t.id)} onChange={() => setTimeIds((s) => toggle(s, t.id))} className="shrink-0" />
                          <span className="truncate">
                            {formatDuration(t.minutes)}
                            {t.note ? ` · ${t.note}` : ''}
                          </span>
                        </span>
                        <span className="shrink-0 font-medium">{formatPounds(timeEntryAmount(t.minutes, data.practice.defaultHourlyRate))}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
