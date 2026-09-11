import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Send, UserPlus, ShieldCheck, FileCheck, Play } from 'lucide-react';
import { Avatar } from './Avatar';
import { SeverityBadge, StatusBadge, WaitingOnBadge } from './Badge';
import { Button } from './Button';
import { ReminderComposer } from './ReminderComposer';
import type { AttentionItem } from '../../domain/rules';
import type { JobView } from '../../application/selectors';
import { formatDate } from '../../domain/dates';
import { useAppStore } from '../../application/store';
import { cn } from '../cn';

export function AttentionCard({ item, view, compact }: { item: AttentionItem; view: JobView; compact?: boolean }) {
  const [composer, setComposer] = useState(false);
  const navigate = useNavigate();
  const transition = useAppStore((s) => s.transitionJob);
  const fileJob = useAppStore((s) => s.fileJob);
  const toast = useAppStore((s) => s.toast);
  const owner = view.assignee;

  const act = () => {
    switch (item.recommendedAction.kind) {
      case 'send_reminder':
      case 'chase_approval':
        setComposer(true);
        return;
      case 'file': {
        const r = fileJob(view.job.id);
        toast({ title: 'Job marked as filed', description: r.nextJob ? `Simulated submission recorded. Next job created: ${r.nextJob.name}.` : 'Simulated submission recorded.', tone: 'success' });
        return;
      }
      case 'start_work':
        transition(view.job.id, 'in_progress');
        toast({ title: 'Work started', tone: 'success' });
        return;
      default:
        navigate(`/jobs/${view.job.id}`);
    }
  };

  const ActionIcon = { send_reminder: Send, chase_approval: Send, assign_reviewer: UserPlus, reassign: UserPlus, verify_identity: ShieldCheck, file: FileCheck, start_work: Play, review_job: ArrowRight }[item.recommendedAction.kind];

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
            <Button onClick={act} icon={<ActionIcon />} data-testid="attention-action">
              {item.recommendedAction.label.replace(/ to client$/, '')}
            </Button>
            <Link to={`/jobs/${view.job.id}`} className="text-[13px] font-medium text-slate-600 hover:text-primary-700 text-center py-1">
              Open job
            </Link>
          </div>
        </div>
      </div>
      {composer && <ReminderComposer job={view.job} open={composer} onClose={() => setComposer(false)} initialChannel={item.recommendedAction.channel} />}
    </div>
  );
}
