import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { Avatar } from './Avatar';
import { DueBadge, StatusBadge, WaitingOnBadge } from './Badge';
import { ProgressBar } from './ProgressBar';
import { EmptyState } from './EmptyState';
import type { JobView } from '../../application/selectors';
import { formatDate } from '../../domain/dates';
import { cn } from '../cn';

/**
 * Responsive job list: a dense table on desktop, cards on mobile.
 */
export function JobList({ views, showClient = true, emptyTitle = 'No jobs here', emptyDescription, dense }: { views: JobView[]; showClient?: boolean; emptyTitle?: string; emptyDescription?: string; dense?: boolean }) {
  if (views.length === 0) return <EmptyState title={emptyTitle} description={emptyDescription} compact />;
  return (
    <>
      {/* Desktop */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs font-medium text-slate-500 border-b border-slate-100">
              <th className="py-2 pl-5 pr-3 font-medium">Job</th>
              <th className="py-2 px-3 font-medium">Status</th>
              <th className="py-2 px-3 font-medium">Waiting on</th>
              <th className="py-2 px-3 font-medium">Documents</th>
              <th className="py-2 px-3 font-medium">Due</th>
              <th className="py-2 px-3 font-medium">Owner</th>
              <th className="py-2 px-3 font-medium">Next action</th>
              <th className="py-2 pr-4" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {views.map((v) => (
              <tr key={v.job.id} className="group hover:bg-slate-50/80 transition-colors">
                <td className={cn('pl-5 pr-3 align-middle', dense ? 'py-2' : 'py-2.5')}>
                  <Link to={`/jobs/${v.job.id}`} className="block min-w-0">
                    <p className="font-medium text-slate-900 group-hover:text-primary-700 truncate">{v.job.name}</p>
                    {showClient && <p className="text-xs text-slate-500 truncate">{v.client.name}</p>}
                  </Link>
                </td>
                <td className="px-3 align-middle">
                  <StatusBadge status={v.job.status} />
                </td>
                <td className="px-3 align-middle">
                  <WaitingOnBadge waitingOn={v.job.waitingOn} />
                </td>
                <td className="px-3 align-middle w-36">
                  {v.job.status === 'filed' ? (
                    <span className="text-xs text-slate-400">—</span>
                  ) : (
                    <div className="flex items-center gap-2">
                      <ProgressBar value={v.completeness.percent} size="sm" className="w-16" />
                      <span className="text-xs text-slate-600 tabular">{v.completeness.percent}%</span>
                    </div>
                  )}
                </td>
                <td className="px-3 align-middle whitespace-nowrap">
                  <div className="flex items-center gap-2">
                    <span className="text-slate-700 tabular">{formatDate(v.job.dueDate, { year: false })}</span>
                    {v.job.status !== 'filed' && <DueBadge days={v.daysUntilDue} />}
                  </div>
                </td>
                <td className="px-3 align-middle">
                  <div className="flex items-center gap-2">
                    <Avatar user={v.assignee} size="sm" />
                    <span className="text-slate-700 text-[13px] truncate max-w-[9rem]">{v.assignee?.name.split(' ')[0] ?? 'Unassigned'}</span>
                  </div>
                </td>
                <td className="px-3 align-middle">
                  <span className={cn('text-[13px]', v.nextAction.kind === 'send_reminder' ? 'text-amber-700 font-medium' : 'text-slate-600')}>{v.nextAction.label}</span>
                </td>
                <td className="pr-4 align-middle text-right">
                  <Link to={`/jobs/${v.job.id}`} className="text-slate-300 group-hover:text-primary-600" aria-label={`Open ${v.job.name}`}>
                    <ChevronRight className="h-4 w-4 inline" />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Mobile */}
      <ul className="md:hidden divide-y divide-slate-100">
        {views.map((v) => (
          <li key={v.job.id}>
            <Link to={`/jobs/${v.job.id}`} className="block px-4 py-3 hover:bg-slate-50">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-slate-900 truncate">{v.job.name}</p>
                  {showClient && <p className="text-xs text-slate-500 truncate">{v.client.name}</p>}
                </div>
                {v.job.status !== 'filed' && <DueBadge days={v.daysUntilDue} />}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <StatusBadge status={v.job.status} />
                <WaitingOnBadge waitingOn={v.job.waitingOn} />
              </div>
              <div className="mt-2 flex items-center justify-between gap-3 text-xs text-slate-500">
                <span className="flex items-center gap-1.5">
                  <Avatar user={v.assignee} size="xs" /> {v.assignee?.name.split(' ')[0] ?? 'Unassigned'}
                </span>
                <span className={cn(v.nextAction.kind === 'send_reminder' ? 'text-amber-700 font-medium' : '')}>{v.nextAction.label}</span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
