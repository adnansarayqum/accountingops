import type { ReactNode } from 'react';
import { cn } from '../cn';

export function EmptyState({ icon, title, description, action, className, compact }: { icon?: ReactNode; title: string; description?: string; action?: ReactNode; className?: string; compact?: boolean }) {
  return (
    <div className={cn('flex flex-col items-center justify-center text-center', compact ? 'py-8 px-4' : 'py-14 px-6', className)}>
      {icon && <div className="mb-3 h-10 w-10 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center [&>svg]:h-5 [&>svg]:w-5">{icon}</div>}
      <p className="text-sm font-semibold text-slate-800">{title}</p>
      {description && <p className="text-[13px] text-slate-500 mt-1 max-w-sm">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
