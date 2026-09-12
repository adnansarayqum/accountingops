import { useEffect, useRef } from 'react';
import { NavLink } from 'react-router-dom';
import { Sparkles, X } from 'lucide-react';
import { NAV_GROUPS, SETTINGS_NAV } from './nav';
import { useData, useDerived } from '../../application/selectors';
import { cn } from '../cn';
import { useFocusTrap } from '../useFocusTrap';

/**
 * The navigation rail. Deliberately a dark surface in both themes (see the
 * --color-nav-* tokens in index.css): it anchors the page and keeps the
 * light content area reading as the thing you work in.
 */
export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const derived = useDerived();
  const data = useData();
  const drawerRef = useRef<HTMLElement>(null);
  const badges = {
    attention: derived.attention.length,
    inbox: derived.pendingInbox,
    chasing: derived.jobViews.filter((v) => v.chasing.required).length,
  };

  // The drawer is a modal surface on a phone: focus goes in when it opens,
  // stays in while it's open, and Escape closes it like any other overlay.
  useFocusTrap(drawerRef, open);
  useEffect(() => {
    if (!open) return;
    // Close first: the one control a keyboard user is most likely to want next.
    const drawer = drawerRef.current;
    (drawer?.querySelector<HTMLElement>('button[aria-label="Close navigation"]') ?? drawer?.querySelector<HTMLElement>('a[href], button'))?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const content = (
    <div className="flex h-full flex-col bg-[var(--color-nav-850)]">
      <div className="flex items-center justify-between h-16 px-4 shrink-0">
        <NavLink to="/" className="flex items-center gap-2.5 min-w-0" onClick={onClose}>
          <span className="h-8 w-8 shrink-0 rounded-lg bg-primary-600 text-white flex items-center justify-center shadow-sm">
            <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 13l4 4L19 7" />
            </svg>
          </span>
          <span className="min-w-0">
            <span className="block text-[14px] font-bold text-white leading-tight truncate">{data.practice.name}</span>
            <span className="block text-[10.5px] text-[var(--color-nav-text)] leading-tight truncate">Accounting Operations Hub</span>
          </span>
        </NavLink>
        <button type="button" onClick={onClose} className="lg:hidden rounded-md p-1.5 text-[var(--color-nav-text)] hover:bg-[var(--color-nav-700)] hover:text-white" aria-label="Close navigation">
          <X className="h-5 w-5" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-2.5 pb-3 scrollbar-thin" aria-label="Main">
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="mb-4">
            <p className="px-2.5 mb-1 text-[10px] font-semibold uppercase tracking-[0.09em] text-[var(--color-nav-text)]/60">{group.label}</p>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const count = item.badge ? badges[item.badge] : 0;
                return (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.to === '/'}
                      onClick={onClose}
                      className={({ isActive }) =>
                        cn('flex items-center gap-2.5 rounded-lg px-2.5 h-9 text-[13px] font-medium transition-colors', isActive ? 'bg-primary-600 text-white shadow-sm' : 'text-[var(--color-nav-text)] hover:bg-[var(--color-nav-700)] hover:text-white')
                      }
                    >
                      {({ isActive }) => (
                        <>
                          <item.icon className={cn('h-4 w-4 shrink-0', isActive ? 'text-white' : 'text-[var(--color-nav-text)]')} aria-hidden="true" />
                          <span className="flex-1 truncate">{item.label}</span>
                          {count > 0 && (
                            <span className={cn('rounded-full px-1.5 min-w-5 text-center text-[10.5px] font-semibold tabular', item.badge === 'attention' ? 'bg-red-500 text-white' : isActive ? 'bg-white/20 text-white' : 'bg-[var(--color-nav-700)] text-white')}>{count}</span>
                          )}
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

      <AskPanel onNavigate={onClose} />

      <div className="px-2.5 pb-3 shrink-0">
        <NavLink
          to={SETTINGS_NAV.to}
          onClick={onClose}
          className={({ isActive }) => cn('flex items-center gap-2.5 rounded-lg px-2.5 h-9 text-[13px] font-medium transition-colors', isActive ? 'bg-primary-600 text-white' : 'text-[var(--color-nav-text)] hover:bg-[var(--color-nav-700)] hover:text-white')}
        >
          <SETTINGS_NAV.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
          {SETTINGS_NAV.label}
        </NavLink>
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden lg:block fixed inset-y-0 left-0 w-[13rem] z-30">{content}</aside>
      {/* Mobile drawer */}
      <div className={cn('lg:hidden fixed inset-0 z-40', open ? '' : 'pointer-events-none')} aria-hidden={!open} data-testid="mobile-drawer" data-open={open ? 'true' : 'false'}>
        <div className={cn('absolute inset-0 bg-black/50 transition-opacity', open ? 'opacity-100' : 'opacity-0')} onClick={onClose} />
        <aside ref={drawerRef} role="dialog" aria-modal={open || undefined} aria-label="Navigation" className={cn('absolute inset-y-0 left-0 w-72 max-w-[85vw] shadow-pop transition-transform duration-200', open ? 'translate-x-0' : '-translate-x-full')}>
          {content}
        </aside>
      </div>
    </>
  );
}

/**
 * The rail's footer promo. The reference design puts an AI upsell here; this
 * app's equivalent is real and already built — Ask the Practice answers from
 * the practice's own records with a deterministic query router, no model and
 * no guessing — so the copy says exactly that rather than promising drafting
 * or summarising the app doesn't do.
 */
function AskPanel({ onNavigate }: { onNavigate: () => void }) {
  return (
    <div className="px-2.5 pb-3 shrink-0">
      <div className="rounded-xl bg-[var(--color-nav-800)] ring-1 ring-white/5 px-3 py-3">
        <p className="flex items-center gap-1.5 text-[13px] font-semibold text-white">
          <Sparkles className="h-3.5 w-3.5 text-primary-200" aria-hidden="true" />
          Ask the practice
        </p>
        <ul className="mt-1.5 space-y-0.5 text-[11px] text-[var(--color-nav-text)] leading-snug">
          <li>· What needs attention today</li>
          <li>· Who we are waiting on</li>
          <li>· What is ready to file</li>
        </ul>
        <NavLink to="/ask" onClick={onNavigate} className="mt-2.5 flex h-8 items-center justify-center rounded-lg bg-primary-600 text-[12.5px] font-semibold text-white hover:bg-primary-500 transition-colors">
          Ask a question
        </NavLink>
      </div>
    </div>
  );
}
