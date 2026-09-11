import { cn } from '../cn';

export function ProgressBar({ value, className, size = 'md', tone }: { value: number; className?: string; size?: 'sm' | 'md'; tone?: 'auto' | 'blue' | 'green' | 'amber' | 'red' }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  const resolved = tone && tone !== 'auto' ? tone : pct === 100 ? 'green' : pct >= 60 ? 'blue' : pct >= 30 ? 'amber' : 'red';
  const colour = { blue: 'bg-primary-500', green: 'bg-emerald-500', amber: 'bg-amber-500', red: 'bg-red-500' }[resolved];
  return (
    <div className={cn('w-full rounded-full bg-slate-100 overflow-hidden', size === 'sm' ? 'h-1.5' : 'h-2', className)} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn('h-full rounded-full transition-[width] duration-500', colour)} style={{ width: `${pct}%` }} />
    </div>
  );
}
