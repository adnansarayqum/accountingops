import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '../cn';

export function KpiCard({ label, value, hint, tone = 'neutral', to, icon }: { label: string; value: ReactNode; hint?: string; tone?: 'neutral' | 'red' | 'amber' | 'green' | 'blue'; to?: string; icon?: ReactNode }) {
  const valueColour = { neutral: 'text-slate-900', red: 'text-red-600', amber: 'text-amber-600', green: 'text-emerald-600', blue: 'text-primary-600' }[tone];
  const content = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] font-medium text-slate-500">{label}</p>
        {icon && <span className="text-slate-300 [&>svg]:h-4 [&>svg]:w-4">{icon}</span>}
      </div>
      <p className={cn('mt-1.5 text-2xl font-bold tabular tracking-tight', valueColour)}>{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500 leading-snug">{hint}</p>}
    </>
  );
  const cls = 'card px-4 py-3.5 block min-w-0';
  return to ? (
    <Link to={to} className={cn(cls, 'card-hover')} title={hint}>
      {content}
    </Link>
  ) : (
    <div className={cls} title={hint}>
      {content}
    </div>
  );
}

export function Stat({ label, value, hint, className }: { label: string; value: ReactNode; hint?: string; className?: string }) {
  return (
    <div className={cn('min-w-0', className)} title={hint}>
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="text-lg font-semibold text-slate-900 tabular leading-tight mt-0.5">{value}</p>
      {hint && <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">{hint}</p>}
    </div>
  );
}
