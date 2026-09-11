import { cn } from '../cn';
import type { User } from '../../domain/types';

const colours: Record<string, string> = {
  blue: 'bg-primary-100 text-primary-700',
  violet: 'bg-violet-100 text-violet-700',
  emerald: 'bg-emerald-100 text-emerald-700',
  amber: 'bg-amber-100 text-amber-800',
  slate: 'bg-slate-200 text-slate-700',
};

export function Avatar({ user, size = 'md', className }: { user?: User; size?: 'xs' | 'sm' | 'md' | 'lg'; className?: string }) {
  const dims = { xs: 'h-5 w-5 text-[9px]', sm: 'h-6 w-6 text-[10px]', md: 'h-8 w-8 text-xs', lg: 'h-10 w-10 text-sm' }[size];
  if (!user) {
    return (
      <span className={cn('inline-flex items-center justify-center rounded-full border border-dashed border-slate-300 text-slate-400 font-medium', dims, className)} title="Unassigned">
        ?
      </span>
    );
  }
  return (
    <span className={cn('inline-flex items-center justify-center rounded-full font-semibold shrink-0', dims, colours[user.colour] ?? colours.slate, className)} title={user.name}>
      {user.initials}
    </span>
  );
}
