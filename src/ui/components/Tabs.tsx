import { cn } from '../cn';

export function Tabs<T extends string>({ value, onChange, options, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; count?: number }[]; className?: string }) {
  return (
    <div role="tablist" className={cn('inline-flex items-center gap-1 rounded-lg bg-slate-100 p-1 max-w-full overflow-x-auto scrollbar-thin', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          type="button"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn('h-7 rounded-md px-2.5 text-[13px] font-medium whitespace-nowrap transition-colors flex items-center gap-1.5', value === o.value ? 'bg-surface text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900')}
        >
          {o.label}
          {o.count !== undefined && <span className={cn('rounded-full px-1.5 text-[11px] tabular', value === o.value ? 'bg-slate-100 text-slate-700' : 'bg-slate-200/70 text-slate-600')}>{o.count}</span>}
        </button>
      ))}
    </div>
  );
}
