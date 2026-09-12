import { Link } from 'react-router-dom';
import { Avatar } from './Avatar';
import { SeverityBadge, StatusBadge, WaitingOnBadge } from './Badge';
import { Button } from './Button';
import { useAttentionAction } from './useAttentionAction';
import type { AttentionItem } from '../../domain/rules';
import type { JobView } from '../../application/selectors';
import { formatDate } from '../../domain/dates';
import { cn } from '../cn';

export function AttentionCard({ item, view, compact }: { item: AttentionItem; view: JobView; compact?: boolean }) {
  const action = useAttentionAction(item, view);
  const owner = view.assignee;

  return (
    <div className={cn('card animate-in border-l-4', item.severity === 'red' ? 'border-l-red-500' : 'border-l-amber-500')} data-testid="attention-card" data-severity={item.severity}>
      <div className={cn('px-4 sm:px-5', compact ? 'py-3' : 'py-4')}>
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <SeverityBadge severity={item.severity} />
              <StatusBadge status={view.job.status} />
              <WaitingOnBadge waitingOn={view.job.waitingOn} />
            </div>
            <Link to={`/clients/${view.client.id}`} className="text-[15px] font-semibold text-slate-900 hover:text-primary-700">
              {view.client.name}
            </Link>
            <p className="text-sm text-slate-700 mt-0.5">
              <Link to={`/jobs/${view.job.id}`} className="font-medium hover:text-primary-700">
                {view.job.name}
              </Link>
              <span className="text-slate-400"> · </span>
              <span className="tabular">{item.headline}</span>
            </p>
            {!compact && (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg bg-slate-50 px-3 py-2.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Why this needs attention</p>
                  <ul className="mt-1 space-y-0.5 text-[13px] text-slate-700">
                    {item.reasons.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-lg bg-primary-50/60 px-3 py-2.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-primary-700">Recommended action</p>
                  <p className="mt-1 text-[13px] text-slate-800 font-medium">{item.recommendedAction.label}</p>
                  <p className="text-xs text-slate-500 mt-1 flex items-center gap-1.5">
                    Owner: <Avatar user={owner} size="xs" /> {owner?.name ?? 'Unassigned'} · Due {formatDate(item.dueDate)}
                  </p>
                </div>
              </div>
            )}
            {compact && <p className="mt-1 text-xs text-slate-500">{item.reasons[0]}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0 md:flex-col md:items-stretch">
            <Button onClick={action.run} icon={action.icon} data-testid="attention-action">
              {action.label}
            </Button>
            <Link to={`/jobs/${view.job.id}`} className="text-[13px] font-medium text-slate-600 hover:text-primary-700 text-center py-1">
              Open job
            </Link>
          </div>
        </div>
      </div>
      {action.composer}
    </div>
  );
}
