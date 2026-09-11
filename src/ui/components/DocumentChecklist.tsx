import { useState } from 'react';
import { CheckCircle2, Circle, Clock, Plus, RotateCcw, Upload } from 'lucide-react';
import { Button } from './Button';
import { ProgressBar } from './ProgressBar';
import { Input } from './Form';
import { useAppStore } from '../../application/store';
import { formatDate } from '../../domain/dates';
import type { InformationRequestItem, Job } from '../../domain/types';
import { computeCompleteness } from '../../domain/rules';
import { cn } from '../cn';

export function DocumentChecklist({ job, items, compact = false, editable = true }: { job: Job; items: InformationRequestItem[]; compact?: boolean; editable?: boolean }) {
  const markReceived = useAppStore((s) => s.markItemReceived);
  const markMissing = useAppStore((s) => s.markItemMissing);
  const addItem = useAppStore((s) => s.addRequestItem);
  const toast = useAppStore((s) => s.toast);
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState('');
  const completeness = computeCompleteness(items);
  const filed = job.status === 'filed';

  const receive = (item: InformationRequestItem) => {
    markReceived(item.id);
    const remaining = completeness.missing.length - 1;
    toast({ title: 'Document received', description: remaining === 0 ? `${item.label} received. Everything is in — chasing stopped and the job is ready to start.` : `${item.label} marked received. ${remaining} still needed.`, tone: 'success' });
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-2">
        <p className="text-[13px] text-slate-600">
          <span className="font-semibold text-slate-900 tabular">{completeness.received}</span> of <span className="tabular">{completeness.total}</span> received
        </p>
        <p className={cn('text-sm font-bold tabular', completeness.complete ? 'text-emerald-600' : 'text-slate-900')} data-testid="completion-percent">
          {completeness.percent}%
        </p>
      </div>
      <ProgressBar value={completeness.percent} />
      <ul className={cn('mt-3 divide-y divide-slate-100', compact && 'text-[13px]')} data-testid="document-checklist">
        {items.map((item) => {
          const received = item.status === 'received';
          const Icon = received ? CheckCircle2 : item.status === 'requested' ? Clock : Circle;
          return (
            <li key={item.id} className="flex items-center gap-3 py-2" data-status={item.status}>
              <Icon className={cn('h-4 w-4 shrink-0', received ? 'text-emerald-500' : item.status === 'requested' ? 'text-amber-500' : 'text-slate-300')} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className={cn('text-sm', received ? 'text-slate-700' : 'text-slate-900 font-medium')}>{item.label}</p>
                {!compact && (
                  <p className="text-xs text-slate-500">
                    {received ? `Received ${formatDate(item.receivedAt)}` : item.status === 'requested' ? `Requested ${formatDate(item.requestedAt)} — still waiting` : 'Not yet requested'}
                  </p>
                )}
              </div>
              <span className={cn('text-xs font-medium', received ? 'text-emerald-600' : item.status === 'requested' ? 'text-amber-600' : 'text-slate-400')}>{received ? 'Received' : item.status === 'requested' ? 'Requested' : 'Missing'}</span>
              {editable && !filed && (
                received ? (
                  <Button size="sm" variant="ghost" icon={<RotateCcw />} onClick={() => markMissing(item.id)} aria-label={`Mark ${item.label} as not received`} title="Undo — mark as not received" />
                ) : (
                  <Button size="sm" variant="secondary" icon={<Upload />} onClick={() => receive(item)} data-testid={`receive-${item.id}`}>
                    Mark received
                  </Button>
                )
              )}
            </li>
          );
        })}
        {items.length === 0 && <li className="py-3 text-sm text-slate-500">No documents are required for this job.</li>}
      </ul>
      {editable && !filed && (
        adding ? (
          <form
            className="mt-2 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (label.trim()) {
                addItem(job.id, label.trim());
                setLabel('');
                setAdding(false);
              }
            }}
          >
            <Input autoFocus placeholder="e.g. Mortgage statement" value={label} onChange={(e) => setLabel(e.target.value)} aria-label="Document name" />
            <Button type="submit" size="md">
              Add
            </Button>
            <Button type="button" size="md" variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </form>
        ) : (
          <button type="button" onClick={() => setAdding(true)} className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-medium text-primary-700 hover:underline">
            <Plus className="h-3.5 w-3.5" /> Add a document to request
          </button>
        )
      )}
    </div>
  );
}
