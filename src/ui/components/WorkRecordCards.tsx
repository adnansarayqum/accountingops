import { useState } from 'react';
import { Clock, FilePlus, Receipt, Trash2 } from 'lucide-react';
import { Card, CardBody, CardHeader } from './Card';
import { Button } from './Button';
import { Badge } from './Badge';
import { Field, Input, Textarea } from './Form';
import { useAppStore } from '../../application/store';
import { useData, useToday } from '../../application/selectors';
import { formatDate } from '../../domain/dates';
import { formatPounds } from '../../domain/rules';

/**
 * Two things Ray asked for after trying the app: somewhere to note extra
 * work done for a client that hasn't been billed yet, and a record of how
 * much time has gone into them. Both are plain, dated records against the
 * client — no invoicing, no timers, just the two things nothing else in
 * the app currently keeps.
 */

/** "95" -> "1h 35m"; anything under an hour stays as minutes alone. */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function userName(users: { id: string; name: string }[], userId?: string): string | null {
  return users.find((u) => u.id === userId)?.name ?? null;
}

export function WipCard({ clientId }: { clientId: string }) {
  const data = useData();
  const today = useToday();
  const addWipEntry = useAppStore((s) => s.addWipEntry);
  const resolveWipEntry = useAppStore((s) => s.resolveWipEntry);
  const deleteWipEntry = useAppStore((s) => s.deleteWipEntry);
  const toast = useAppStore((s) => s.toast);

  const [adding, setAdding] = useState(false);
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');

  const entries = data.wipEntries.filter((w) => w.clientId === clientId).sort((a, b) => (a.performedOn < b.performedOn ? 1 : -1));
  const unbilled = entries.filter((w) => w.status === 'unbilled');
  const resolved = entries.filter((w) => w.status !== 'unbilled');
  const unbilledTotal = unbilled.reduce((sum, w) => sum + w.amount, 0);

  const save = () => {
    const value = Number(amount.replace(/[£,\s]/g, ''));
    if (!description.trim()) {
      toast({ title: 'Say what the extra work was', tone: 'error' });
      return;
    }
    if (!Number.isFinite(value) || value <= 0) {
      toast({ title: 'Enter the value in pounds', tone: 'error' });
      return;
    }
    addWipEntry(clientId, { description: description.trim(), amount: value, performedOn: today });
    setDescription('');
    setAmount('');
    setAdding(false);
    toast({ title: 'Unbilled work recorded', tone: 'success' });
  };

  return (
    <Card data-testid="wip-card">
      <CardHeader
        title="Work in progress"
        icon={<Receipt />}
        description={unbilled.length === 0 ? 'Nothing unbilled for this client.' : `${formatPounds(unbilledTotal)} unbilled across ${unbilled.length} item${unbilled.length === 1 ? '' : 's'}.`}
        action={
          !adding && (
            <Button size="sm" variant="secondary" icon={<FilePlus />} onClick={() => setAdding(true)} data-testid="wip-add">
              Add
            </Button>
          )
        }
      />
      <CardBody className="pt-0 space-y-3">
        {adding && (
          <div className="rounded-lg border border-primary-200 bg-primary-50/40 p-3 space-y-3" data-testid="wip-form">
            <Field label="What was the extra work?" htmlFor="wip-description">
              <Textarea id="wip-description" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Advised on a VAT query outside the return" data-testid="wip-description" />
            </Field>
            <Field label="Value" htmlFor="wip-amount" hint="What this would be billed at.">
              <Input id="wip-amount" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="£150" data-testid="wip-amount" />
            </Field>
            <div className="flex gap-2">
              <Button size="sm" onClick={save} data-testid="wip-save">
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
        {unbilled.length > 0 && (
          <ul className="divide-y divide-slate-100">
            {unbilled.map((w) => (
              <li key={w.id} className="py-2.5 flex items-start justify-between gap-3" data-testid={`wip-row-${w.id}`}>
                <div className="min-w-0">
                  <p className="text-[13px] text-slate-900">{w.description}</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {formatDate(w.performedOn)}
                    {userName(data.users, w.performedByUserId) ? ` · ${userName(data.users, w.performedByUserId)}` : ''} · <span className="font-medium text-slate-700">{formatPounds(w.amount)}</span>
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button size="sm" variant="ghost" onClick={() => resolveWipEntry(w.id, 'invoiced')} data-testid={`wip-invoice-${w.id}`}>
                    Invoiced
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => resolveWipEntry(w.id, 'written_off')}>
                    Write off
                  </Button>
                  <button type="button" onClick={() => deleteWipEntry(w.id)} className="text-slate-300 hover:text-red-600 p-1" aria-label="Remove this entry">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {resolved.length > 0 && (
          <details className="text-xs text-slate-500">
            <summary className="cursor-pointer select-none">
              {resolved.length} resolved item{resolved.length === 1 ? '' : 's'}
            </summary>
            <ul className="mt-1.5 space-y-1">
              {resolved.map((w) => (
                <li key={w.id} className="flex items-center gap-2" data-testid={`wip-row-${w.id}`}>
                  <Badge tone={w.status === 'invoiced' ? 'green' : 'neutral'}>{w.status === 'invoiced' ? 'Invoiced' : 'Written off'}</Badge>
                  <span className="truncate">
                    {w.description} · {formatPounds(w.amount)}
                    {w.resolutionNote ? ` · ${w.resolutionNote}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </CardBody>
    </Card>
  );
}

export function TimeTrackingCard({ clientId }: { clientId: string }) {
  const data = useData();
  const today = useToday();
  const logTime = useAppStore((s) => s.logTime);
  const deleteTimeEntry = useAppStore((s) => s.deleteTimeEntry);
  const toast = useAppStore((s) => s.toast);

  const [adding, setAdding] = useState(false);
  const [minutes, setMinutes] = useState('');
  const [note, setNote] = useState('');

  const entries = data.timeEntries.filter((t) => t.clientId === clientId).sort((a, b) => (a.loggedOn < b.loggedOn ? 1 : -1));
  const totalMinutes = entries.reduce((sum, t) => sum + t.minutes, 0);

  const save = () => {
    const value = Number(minutes);
    if (!Number.isFinite(value) || value <= 0) {
      toast({ title: 'Enter how many minutes', tone: 'error' });
      return;
    }
    logTime(clientId, { minutes: value, note: note.trim() || undefined, loggedOn: today });
    setMinutes('');
    setNote('');
    setAdding(false);
    toast({ title: 'Time logged', tone: 'success' });
  };

  return (
    <Card data-testid="time-tracking-card">
      <CardHeader
        title="Time logged"
        icon={<Clock />}
        description={entries.length === 0 ? 'No time logged for this client yet.' : `${formatDuration(totalMinutes)} logged across ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}.`}
        action={
          !adding && (
            <Button size="sm" variant="secondary" icon={<FilePlus />} onClick={() => setAdding(true)} data-testid="time-add">
              Log time
            </Button>
          )
        }
      />
      <CardBody className="pt-0 space-y-3">
        {adding && (
          <div className="rounded-lg border border-primary-200 bg-primary-50/40 p-3 space-y-3" data-testid="time-form">
            <Field label="Minutes" htmlFor="time-minutes" hint="e.g. 90 for an hour and a half.">
              <Input id="time-minutes" value={minutes} onChange={(e) => setMinutes(e.target.value)} inputMode="numeric" placeholder="45" data-testid="time-minutes" />
            </Field>
            <Field label="Note" htmlFor="time-note" hint="Optional.">
              <Input id="time-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. VAT return preparation" data-testid="time-note" />
            </Field>
            <div className="flex gap-2">
              <Button size="sm" onClick={save} data-testid="time-save">
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
        {entries.length > 0 && (
          <ul className="divide-y divide-slate-100">
            {entries.map((t) => (
              <li key={t.id} className="py-2 flex items-start justify-between gap-3" data-testid={`time-row-${t.id}`}>
                <div className="min-w-0">
                  <p className="text-[13px] text-slate-900">
                    <span className="font-medium">{formatDuration(t.minutes)}</span>
                    {t.note ? ` · ${t.note}` : ''}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {formatDate(t.loggedOn)}
                    {userName(data.users, t.userId) ? ` · ${userName(data.users, t.userId)}` : ''}
                  </p>
                </div>
                <button type="button" onClick={() => deleteTimeEntry(t.id)} className="text-slate-300 hover:text-red-600 p-1 shrink-0" aria-label="Remove this entry">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
