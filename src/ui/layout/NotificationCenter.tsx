import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, FileText, Briefcase, CalendarClock, CheckCircle2, Users } from 'lucide-react';
import { useAppStore } from '../../application/store';
import { useData, useToday } from '../../application/selectors';
import { formatAgo } from '../../domain/dates';
import { cn } from '../cn';

export function NotificationCenter() {
  const data = useData();
  const today = useToday();
  const markRead = useAppStore((s) => s.markNotificationRead);
  const markAll = useAppStore((s) => s.markAllNotificationsRead);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const unread = data.notifications.filter((n) => !n.read).length;

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const icons = { document: FileText, job: Briefcase, deadline: CalendarClock, client: Users, approval: CheckCircle2 };

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800" aria-label={`Notifications${unread ? ` (${unread} unread)` : ''}`} aria-expanded={open}>
        <Bell className="h-5 w-5" />
        {unread > 0 && <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-red-500 ring-2 ring-white" />}
      </button>
      {/* On a phone the bell sits near the right edge, so a popover anchored to
          it runs off the left of the screen; below `sm` it's pinned to the
          viewport instead, just under the header. */}
      {open && (
        <div className="fixed inset-x-4 top-16 sm:absolute sm:inset-x-auto sm:top-auto sm:right-0 sm:mt-2 sm:w-[22rem] card shadow-pop z-40 animate-in" data-testid="notifications-popover">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100">
            <p className="text-sm font-semibold">Notifications</p>
            {unread > 0 && (
              <button type="button" onClick={markAll} className="text-xs font-medium text-primary-700 hover:underline">
                Mark all read
              </button>
            )}
          </div>
          <ul className="max-h-96 overflow-y-auto divide-y divide-slate-100">
            {data.notifications.length === 0 && <li className="px-4 py-8 text-center text-sm text-slate-500">You're up to date.</li>}
            {data.notifications.slice(0, 20).map((n) => {
              const Icon = icons[n.kind];
              const to = n.jobId ? `/jobs/${n.jobId}` : n.clientId ? `/clients/${n.clientId}` : n.kind === 'document' ? '/inbox' : '/';
              return (
                <li key={n.id}>
                  <Link
                    to={to}
                    onClick={() => {
                      markRead(n.id);
                      setOpen(false);
                    }}
                    className={cn('flex gap-3 px-4 py-3 hover:bg-slate-50', !n.read && 'bg-primary-50/40')}
                  >
                    <span className="h-7 w-7 rounded-md bg-slate-100 text-slate-500 flex items-center justify-center shrink-0">
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0">
                      <span className={cn('block text-[13px] text-slate-900', !n.read && 'font-semibold')}>{n.title}</span>
                      <span className="block text-xs text-slate-600 mt-0.5">{n.body}</span>
                      <span className="block text-[11px] text-slate-400 mt-1">{formatAgo(n.createdAt, today, data.practice.timezone)}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
