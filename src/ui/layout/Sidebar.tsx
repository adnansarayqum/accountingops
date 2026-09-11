import { NavLink } from 'react-router-dom';
import { X } from 'lucide-react';
import { NAV_GROUPS, SETTINGS_NAV } from './nav';
import { useDerived } from '../../application/selectors';
import { cn } from '../cn';

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const derived = useDerived();
  const badges = {
    attention: derived.attention.length,
    inbox: derived.pendingInbox,
    chasing: derived.jobViews.filter((v) => v.chasing.required).length,
  };

  const content = (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between h-16 px-5 border-b border-slate-100">
        <NavLink to="/" className="flex items-center gap-2.5" onClick={onClose}>
          <span className="h-8 w-8 rounded-lg bg-primary-600 text-white flex items-center justify-center shadow-sm">
            <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 13l4 4L19 7" />
            </svg>
          </span>
          <span>
            <span className="block text-[15px] font-bold text-slate-900 leading-tight">PracticeOps</span>
            <span className="block text-[11px] text-slate-500 leading-tight">Northgate Accountants</span>
          </span>
        </NavLink>
        <button type="button" onClick={onClose} className="lg:hidden rounded-md p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Close navigation">
          <X className="h-5 w-5" />
        </button>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 py-4 scrollbar-thin" aria-label="Main">
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="mb-5">
            <p className="px-3 mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{group.label}</p>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const count = item.badge ? badges[item.badge] : 0;
                return (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.to === '/'}
                      onClick={onClose}
                      className={({ isActive }) => cn('flex items-center gap-2.5 rounded-lg px-3 h-9 text-sm font-medium transition-colors', isActive ? 'bg-primary-50 text-primary-700' : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900')}
                    >
                      {({ isActive }) => (
                        <>
                          <item.icon className={cn('h-4 w-4 shrink-0', isActive ? 'text-primary-600' : 'text-slate-400')} aria-hidden="true" />
                          <span className="flex-1 truncate">{item.label}</span>
                          {count > 0 && <span className={cn('rounded-full px-1.5 min-w-5 text-center text-[11px] font-semibold tabular', item.badge === 'attention' ? 'bg-red-100 text-red-700' : 'bg-slate-200 text-slate-700')}>{count}</span>}
                        </>
                      )}
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <div className="border-t border-slate-100 px-3 py-3">
        <NavLink to={SETTINGS_NAV.to} onClick={onClose} className={({ isActive }) => cn('flex items-center gap-2.5 rounded-lg px-3 h-9 text-sm font-medium transition-colors', isActive ? 'bg-primary-50 text-primary-700' : 'text-slate-600 hover:bg-slate-100')}>
          <SETTINGS_NAV.icon className="h-4 w-4 text-slate-400" aria-hidden="true" />
          {SETTINGS_NAV.label}
        </NavLink>
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden lg:block fixed inset-y-0 left-0 w-64 bg-white border-r border-slate-200 z-30">{content}</aside>
      {/* Mobile drawer */}
      <div className={cn('lg:hidden fixed inset-0 z-40', open ? '' : 'pointer-events-none')} aria-hidden={!open}>
        <div className={cn('absolute inset-0 bg-slate-900/40 transition-opacity', open ? 'opacity-100' : 'opacity-0')} onClick={onClose} />
        <aside className={cn('absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-white shadow-pop transition-transform duration-200', open ? 'translate-x-0' : '-translate-x-full')}>{content}</aside>
      </div>
    </>
  );
}
