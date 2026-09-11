import { useEffect } from 'react';
import { useAppStore } from './store';
import { todayIso } from '../domain/dates';

const CHECK_EVERY_MS = 60 * 1000;

/**
 * Keeps the store's `today` on the actual calendar day. It was set once at
 * load, so a tab left open past midnight kept showing yesterday's "due
 * today" and counting overdue from the wrong day. Checked once a minute
 * and whenever the tab is looked at again; the store only changes when the
 * date really has, so this never causes a re-render on its own.
 */
export function useLiveToday(): void {
  useEffect(() => {
    const tick = () => {
      const today = todayIso();
      if (useAppStore.getState().today !== today) useAppStore.setState({ today });
    };
    const timer = setInterval(tick, CHECK_EVERY_MS);
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', tick);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);
}
