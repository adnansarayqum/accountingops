import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { MoreVertical } from 'lucide-react';
import { Badge, SeverityBadge, STATUS_TONE } from './Badge';
import { Button } from './Button';
import { useAttentionAction } from './useAttentionAction';
import type { AttentionItem } from '../../domain/rules';
import type { Derived } from '../../application/selectors';
import type { JobView } from '../../application/selectors';
import { formatDate } from '../../domain/dates';
import { JOB_STATUS_LABELS, JOB_STATUS_SHORT_LABELS, WAITING_ON_LABELS } from '../../domain/catalog';
import { cn } from '../cn';

/**
 * The dashboard's attention list as a scannable table rather than a stack of
 * cards: five rows of "who, what, when, why it's stuck, what to do" fit in
 * the space two cards used to take, which is what lets the rest of the
 * dashboard sit above the fold.
 *
 * The full explanation of each rule still lives on the Attention page's
 * cards — this is the triage view, not a replacement for it. Below `lg` the
 * table collapses to stacked rows: five columns squeezed into a tablet width
 * truncate every one of them, and a stacked row reads better than five
 * columns of "Awaiting re…".
 */
export function AttentionTable({ items, derived }: { items: AttentionItem[]; derived: Derived }) {
  return (
    <div className="overflow-x-auto">
      {/* Fixed layout with explicit widths: left to size themselves, the job name and
          status columns grow to their longest value and push the action button out of
          the card. The job column is the widest of the five — a job name is how you
          recognise the row, so it wraps to a second line rather than truncating. */}
      <table className="w-full text-left border-collapse lg:table-fixed" data-testid="attention-table">
        <colgroup className="hidden lg:table-column-group">
          <col className="w-[20%]" />
          <col className="w-[22%]" />
          <col className="w-[16%]" />
          <col className="w-[20%]" />
          <col className="w-[22%]" />
          <col className="w-9" />
        </colgroup>
        <thead className="hidden lg:table-header-group">
          <tr className="border-b border-slate-100">
            {['Client', 'Job', 'Due date', 'Status', 'Action'].map((h) => (
              <th key={h} scope="col" className="py-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400 whitespace-nowrap">
                {h}
              </th>
            ))}
            <th scope="col" className="py-2 pr-2">
              <span className="sr-only">More</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const view = derived.jobViewById.get(item.jobId);
            return view ? <AttentionRow key={item.id} item={item} view={view} /> : null;
          })}
        </tbody>
      </table>
    </div>
  );
}

function AttentionRow({ item, view }: { item: AttentionItem; view: JobView }) {
  const action = useAttentionAction(item, view);
  const overdue = item.daysUntilDue < 0;

  return (
    <tr className="block lg:table-row border-b border-slate-100 last:border-0 hover:bg-slate-50/60 transition-colors" data-testid="attention-row" data-severity={item.severity}>
      <td className="block lg:table-cell py-2 px-3 align-middle">
        <div className="flex items-center gap-2.5 min-w-0">
          <Link to={`/clients/${view.client.id}`} className="text-[13px] font-semibold text-slate-900 hover:text-primary-700 leading-snug" title={view.client.name}>
            {view.client.name}
          </Link>
          <span className="lg:hidden ml-auto">
            <SeverityBadge severity={item.severity} />
          </span>
        </div>
      </td>
      <td className="block lg:table-cell py-0.5 lg:py-2 px-3 align-middle">
        <Link to={`/jobs/${view.job.id}`} className="text-[13px] text-slate-700 hover:text-primary-700 block leading-snug" title={view.job.name}>
          {view.job.name}
        </Link>
      </td>
      <td className="block lg:table-cell py-0.5 lg:py-2 px-3 align-middle whitespace-nowrap">
        <span className={cn('block text-[13px] font-medium tabular', overdue ? 'text-red-600' : 'text-slate-700')}>{overdue ? `Overdue by ${Math.abs(item.daysUntilDue)} days` : `Due in ${item.daysUntilDue} days`}</span>
        <span className="block text-[11px] text-slate-400 tabular">{formatDate(item.dueDate, { year: true })}</span>
      </td>
      <td className="block lg:table-cell py-1 lg:py-2 px-3 align-middle">
        {/* Same tone map as StatusBadge, but the short label: the full
            "Waiting for client approval" is wider than this column, and truncating it
            leaves "Waiting for …", which doesn't say which of two waits it is. */}
        <Badge tone={STATUS_TONE[view.job.status]} dot className="max-w-full" title={JOB_STATUS_LABELS[view.job.status]}>
          <span className="truncate">{JOB_STATUS_SHORT_LABELS[view.job.status]}</span>
        </Badge>
        {/* Status is the stage the work is at; waitingOn is who holds the next move.
            They are independent — a job can be awaiting records while the ball is with
            us — so the row names both rather than leaving the dashboard's
            "Waiting on client" count looking like it should match the badge above. */}
        <span className="block mt-0.5 text-[10.5px] text-slate-400 truncate">waiting on {WAITING_ON_LABELS[view.job.waitingOn].toLowerCase()}</span>
      </td>
      <td className="block lg:table-cell py-2 px-3 align-middle">
        <Button size="sm" icon={action.icon} onClick={action.run} data-testid="attention-action" title={action.label} className="max-w-full">
          <span className="truncate">{action.shortLabel}</span>
        </Button>
        {action.composer}
      </td>
      <td className="hidden lg:table-cell py-2 pr-2 align-middle">
        <RowMenu jobId={view.job.id} clientId={view.client.id} clientName={view.client.name} />
      </td>
    </tr>
  );
}

/** Per-row overflow: the destinations the action button doesn't cover. */
function RowMenu({ jobId, clientId, clientName }: { jobId: string; clientId: string; clientName: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu" aria-label={`More actions for ${clientName}`} className="rounded-md p-1 text-slate-300 hover:bg-slate-100 hover:text-slate-600">
        <MoreVertical className="h-4 w-4" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-7 z-20 w-44 rounded-lg border border-line bg-surface py-1 shadow-pop">
          <Link role="menuitem" to={`/jobs/${jobId}`} className="block px-3 py-1.5 text-[13px] text-slate-700 hover:bg-slate-50">
            Open job
          </Link>
          <Link role="menuitem" to={`/clients/${clientId}`} className="block px-3 py-1.5 text-[13px] text-slate-700 hover:bg-slate-50">
            Open client
          </Link>
          <Link role="menuitem" to="/attention" className="block px-3 py-1.5 text-[13px] text-slate-700 hover:bg-slate-50">
            Why this is flagged
          </Link>
        </div>
      )}
    </div>
  );
}

/** Small count chip for a section heading — red when there is anything to do. */
export function CountBadge({ count }: { count: number }) {
  return <Badge tone={count > 0 ? 'red' : 'neutral'}>{count}</Badge>;
}
