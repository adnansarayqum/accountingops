import type { ReactNode } from 'react';
import { cn } from '../cn';
import type { JobStatus, WaitingOn, ResponsivenessBand } from '../../domain/types';
import { JOB_STATUS_LABELS, WAITING_ON_LABELS, RESPONSIVENESS_LABELS } from '../../domain/catalog';

export type Tone = 'neutral' | 'blue' | 'green' | 'amber' | 'red' | 'violet' | 'slate';

const tones: Record<Tone, string> = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-200',
  slate: 'bg-slate-800 text-white ring-slate-800',
  blue: 'bg-primary-50 text-primary-700 ring-primary-100',
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
  amber: 'bg-amber-50 text-amber-800 ring-amber-100',
  red: 'bg-red-50 text-red-700 ring-red-100',
  violet: 'bg-violet-50 text-violet-700 ring-violet-100',
};

export function Badge({ tone = 'neutral', children, className, dot, title }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean; title?: string }) {
  return (
    <span title={title} className={cn('inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap', tones[tone], className)}>
      {dot && <span className={cn('h-1.5 w-1.5 rounded-full', tone === 'red' ? 'bg-red-500' : tone === 'amber' ? 'bg-amber-500' : tone === 'green' ? 'bg-emerald-500' : tone === 'blue' ? 'bg-primary-500' : 'bg-slate-400')} />}
      {children}
    </span>
  );
}

export const STATUS_TONE: Record<JobStatus, Tone> = {
  waiting_for_records: 'amber',
  ready_to_start: 'blue',
  in_progress: 'blue',
  internal_review: 'violet',
  waiting_client_approval: 'amber',
  ready_to_file: 'green',
  filed: 'neutral',
};

export function StatusBadge({ status, className }: { status: JobStatus; className?: string }) {
  return (
    <Badge tone={STATUS_TONE[status]} dot className={className}>
      {JOB_STATUS_LABELS[status]}
    </Badge>
  );
}

const WAITING_TONE: Record<WaitingOn, Tone> = {
  client: 'amber',
  accountant: 'blue',
  senior_review: 'violet',
  hmrc: 'neutral',
  companies_house: 'neutral',
  approval: 'amber',
  payment: 'red',
  nothing: 'green',
};

export function WaitingOnBadge({ waitingOn, className }: { waitingOn: WaitingOn; className?: string }) {
  return (
    <Badge tone={WAITING_TONE[waitingOn]} className={className} title="Who we are waiting on">
      <span className="text-[10px] uppercase tracking-wide opacity-70">Waiting on</span>
      {WAITING_ON_LABELS[waitingOn]}
    </Badge>
  );
}

export function SeverityBadge({ severity }: { severity: 'red' | 'amber' }) {
  return (
    <Badge tone={severity} dot>
      {severity === 'red' ? 'Immediate risk' : 'Needs attention'}
    </Badge>
  );
}

const RESPONSIVENESS_TONE: Record<ResponsivenessBand, Tone> = { fast: 'green', normal: 'blue', slow: 'amber', chronic: 'red' };

export function ResponsivenessBadge({ band }: { band: ResponsivenessBand }) {
  return (
    <Badge tone={RESPONSIVENESS_TONE[band]} dot>
      {RESPONSIVENESS_LABELS[band]}
    </Badge>
  );
}

export function DueBadge({ days, className }: { days: number; className?: string }) {
  const tone: Tone = days < 0 ? 'red' : days <= 7 ? 'amber' : days <= 30 ? 'blue' : 'neutral';
  const label = days < 0 ? `Overdue ${Math.abs(days)}d` : days === 0 ? 'Due today' : `Due in ${days}d`;
  return (
    <Badge tone={tone} className={cn('tabular', className)}>
      {label}
    </Badge>
  );
}
