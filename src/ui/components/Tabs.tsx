import { useEffect, useRef, useState } from 'react';
import { cn } from '../cn';

type Overflow = '' | 'left' | 'right' | 'both';

/**
 * A row of tabs that scrolls sideways when it doesn't fit (a phone showing
 * "Information requests · Communications · Activity"). A scrollable strip
 * with no visible cue looks like the last tab simply doesn't exist, so the
 * edge that has more behind it fades out, and the selected tab is always
 * scrolled into view.
 */
export function Tabs<T extends string>({ value, onChange, options, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; count?: number }[]; className?: string }) {
  const listRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState<Overflow>('');

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const update = () => {
      // The strip's own inner padding scrolls too; a few pixels of it left
      // beyond the last tab is not "more tabs behind here".
      const slack = (parseFloat(getComputedStyle(el).paddingLeft) || 0) + 1;
      const left = el.scrollLeft > slack;
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - slack;
      setOverflow(left && right ? 'both' : left ? 'left' : right ? 'right' : '');
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      observer?.disconnect();
    };
  }, [options.length]);

  useEffect(() => {
    const selected = listRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    selected?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [value]);

  return (
    <div className={cn('relative inline-block max-w-full align-top', className)}>
      <div ref={listRef} role="tablist" data-overflow={overflow || undefined} className="inline-flex max-w-full items-center gap-1 rounded-lg bg-slate-100 p-1 overflow-x-auto scrollbar-thin">
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
      {(overflow === 'left' || overflow === 'both') && <span aria-hidden="true" data-testid="tabs-fade-left" className="pointer-events-none absolute inset-y-0 left-0 w-8 rounded-l-lg bg-gradient-to-r from-slate-100 to-transparent" />}
      {(overflow === 'right' || overflow === 'both') && <span aria-hidden="true" data-testid="tabs-fade-right" className="pointer-events-none absolute inset-y-0 right-0 w-8 rounded-r-lg bg-gradient-to-l from-slate-100 to-transparent" />}
    </div>
  );
}
