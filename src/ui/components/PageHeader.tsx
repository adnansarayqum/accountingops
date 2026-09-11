import type { ReactNode } from 'react';
import { cn } from '../cn';

export function PageHeader({ title, description, actions, className, eyebrow }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; className?: string; eyebrow?: ReactNode }) {
  return (
    <div className={cn('flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between mb-5', className)}>
      <div className="min-w-0">
        {eyebrow && <div className="text-xs font-medium text-slate-500 mb-1">{eyebrow}</div>}
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
        {description && <p className="text-sm text-slate-500 mt-1">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}
