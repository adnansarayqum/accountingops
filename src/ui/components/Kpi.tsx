import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '../cn';

export type KpiTone = 'neutral' | 'red' | 'amber' | 'green' | 'blue' | 'violet';

/**
 * The tinted headline metrics. Each tone is a very light wash rather than a
 * saturated fill — five saturated cards in a row compete with the attention
 * list below them, which is the thing that actually needs reading first.
 * `emphasis` deepens one card's tint for the metric that is the biggest
 * blocker right now.
 */
const TONES: Record<KpiTone, { card: string; emphasis: string; icon: string; value: string }> = {
  neutral: { card: 'bg-slate-50/80 border-slate-200/70', emphasis: 'bg-slate-100 border-slate-200', icon: 'bg-slate-100 text-slate-500', value: 'text-slate-900' },
  blue: { card: 'bg-primary-50/60 border-primary-100', emphasis: 'bg-primary-50 border-primary-200', icon: 'bg-primary-100 text-primary-600', value: 'text-primary-700' },
  red: { card: 'bg-red-50/60 border-red-100', emphasis: 'bg-red-50 border-red-200', icon: 'bg-red-100 text-red-600', value: 'text-red-600' },
  amber: { card: 'bg-amber-50/60 border-amber-100', emphasis: 'bg-amber-50 border-amber-200', icon: 'bg-amber-100 text-amber-700', value: 'text-amber-600' },
  green: { card: 'bg-emerald-50/60 border-emerald-100', emphasis: 'bg-emerald-50 border-emerald-200', icon: 'bg-emerald-100 text-emerald-600', value: 'text-emerald-600' },
  violet: { card: 'bg-violet-50/60 border-violet-100', emphasis: 'bg-violet-50 border-violet-200', icon: 'bg-violet-100 text-violet-600', value: 'text-violet-700' },
};

export function KpiCard({ label, value, hint, tone = 'neutral', to, icon, emphasis }: { label: string; value: ReactNode; hint?: string; tone?: KpiTone; to?: string; icon?: ReactNode; emphasis?: boolean }) {
  const t = TONES[tone];
  const content = (
    <>
      <div className="flex items-start gap-3">
        {icon && <span className={cn('shrink-0 grid place-items-center h-9 w-9 rounded-xl [&>svg]:h-[18px] [&>svg]:w-[18px]', t.icon)}>{icon}</span>}
        <div className="min-w-0">
          <p className={cn('text-[26px] font-bold tabular tracking-tight leading-none', t.value)}>{value}</p>
          <p className="mt-1 text-[13px] font-semibold text-slate-700 leading-tight">{label}</p>
        </div>
        {to && <ChevronRight className="ml-auto shrink-0 h-4 w-4 text-slate-300" aria-hidden="true" />}
      </div>
      {hint && <p className="mt-2 text-[11.5px] text-slate-500 leading-snug line-clamp-2">{hint}</p>}
    </>
  );
  const cls = cn('rounded-card border px-3.5 py-3 block min-w-0 transition-colors', emphasis ? t.emphasis : t.card);
  return to ? (
    <Link to={to} className={cn(cls, 'hover:brightness-[0.985]')} title={hint}>
      {content}
    </Link>
  ) : (
    <div className={cls} title={hint}>
      {content}
    </div>
  );
}

/**
 * A "key deadlines" tile: compact status widget, one per service. Smaller
 * and quieter than a KpiCard on purpose — these are navigation, not the
 * headline numbers.
 */
export function ServiceTile({ label, value, hint, to, icon, tone = 'neutral' }: { label: string; value: ReactNode; hint: string; to: string; icon?: ReactNode; tone?: KpiTone }) {
  const t = TONES[tone];
  return (
    <Link to={to} className="card card-hover px-3 py-2.5 block min-w-0" title={hint}>
      <div className="flex items-center gap-2 min-w-0">
        {icon && <span className={cn('shrink-0 grid place-items-center h-7 w-7 rounded-lg [&>svg]:h-4 [&>svg]:w-4', t.icon)}>{icon}</span>}
        <p className="text-[12.5px] font-semibold text-slate-800 truncate">{label}</p>
      </div>
      <p className={cn('mt-1.5 text-xl font-bold tabular leading-none', t.value)}>{value}</p>
      <p className="mt-1 text-[11px] text-slate-500 leading-snug line-clamp-2">{hint}</p>
    </Link>
  );
}

export function Stat({ label, value, hint, className }: { label: string; value: ReactNode; hint?: string; className?: string }) {
  return (
    <div className={cn('min-w-0', className)} title={hint}>
      <p className="text-[22px] font-bold text-slate-900 tabular leading-none">{value}</p>
      <p className="text-[12.5px] font-medium text-slate-600 mt-1.5">{label}</p>
      {hint && <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">{hint}</p>}
    </div>
  );
}
