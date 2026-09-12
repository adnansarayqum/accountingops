import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Menu, Search } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { CommandPalette } from './CommandPalette';
import { NotificationCenter } from './NotificationCenter';
import { Toaster } from '../components/Toaster';
import { Avatar } from '../components/Avatar';
import { ThemeToggle } from '../components/ThemeToggle';
import { useAppStore } from '../../application/store';
import { useData } from '../../application/selectors';
import { useCompaniesHouseSync } from '../../application/useCompaniesHouseSync';
import { useRefreshOnFocus, useUnsavedChangesWarning } from '../../application/usePersistenceGuards';
import { useLiveToday } from '../../application/useLiveToday';
import { LoadFailedBanner } from '../components/LoadFailedBanner';

export function AppShell() {
  const [navOpen, setNavOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const location = useLocation();
  const data = useData();
  const currentUserId = useAppStore((s) => s.currentUserId);
  const me = data.users.find((u) => u.id === currentUserId);

  useCompaniesHouseSync();
  useRefreshOnFocus();
  useUnsavedChangesWarning();
  useLiveToday();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    setNavOpen(false);
    window.scrollTo({ top: 0 });
  }, [location.pathname]);

  return (
    <div className="min-h-screen bg-canvas">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-2 focus:left-2 bg-surface px-3 py-2 rounded-md shadow">
        Skip to content
      </a>
      <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />
      <div className="lg:pl-[13rem] flex flex-col min-h-screen">
        <header className="sticky top-0 z-20 h-14 bg-surface/90 backdrop-blur border-b border-slate-200 flex items-center gap-2 px-4 sm:px-6">
          <button type="button" onClick={() => setNavOpen(true)} className="lg:hidden rounded-lg p-2 text-slate-600 hover:bg-slate-100 shrink-0" aria-label="Open navigation">
            <Menu className="h-5 w-5" />
          </button>
          <button type="button" onClick={() => setPaletteOpen(true)} className="flex-1 min-w-0 max-w-2xl flex items-center gap-2.5 h-9 rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 text-[13px] text-slate-500 hover:border-slate-300 hover:bg-surface transition-colors" aria-label="Search (Ctrl+K)" data-testid="open-search">
            <Search className="h-4 w-4 shrink-0 text-slate-400" />
            <span className="truncate">
              <span className="sm:hidden">Search…</span>
              <span className="hidden sm:inline">Search clients, jobs, documents or ask a question…</span>
            </span>
            <kbd className="ml-auto hidden sm:inline text-[10px] text-slate-400 border border-slate-200 bg-surface rounded px-1.5 py-0.5 shrink-0">⌘K</kbd>
          </button>
          <div className="ml-auto flex items-center gap-0.5 sm:gap-1 shrink-0">
            <ThemeToggle />
            <NotificationCenter />
            <div className="flex items-center gap-2 pl-1.5 sm:pl-2 ml-0.5 sm:ml-1 border-l border-slate-200">
              <Avatar user={me} size="md" />
              <span className="hidden sm:block text-[13px] font-semibold text-slate-800 truncate max-w-24">{me?.name.split(' ')[0]}</span>
            </div>
          </div>
        </header>
        <LoadFailedBanner />
        <main id="main" className="flex-1 px-4 sm:px-6 lg:px-7 py-4 sm:py-5 max-w-[1500px] w-full mx-auto">
          <Outlet />
        </main>
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <Toaster />
    </div>
  );
}
