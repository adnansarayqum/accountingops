import { useEffect } from 'react';
import { useAppStore } from './store';

/** Don't re-read more often than this when focus flickers (alt-tabbing back and forth). */
const REFRESH_MIN_INTERVAL_MS = 5000;

/**
 * Re-reads the stored practice whenever this tab comes back into view. Every
 * save is the whole practice, so a tab that was left open for an afternoon
 * would otherwise carry on from its old copy and, on the next click, write
 * that copy over everything the other users did meanwhile. Pulling the
 * latest snapshot on focus closes most of that window without a server
 * change; the store's refresh() keeps any unsaved local change intact.
 */
export function useRefreshOnFocus(): void {
  const ready = useAppStore((s) => s.ready);
  const refresh = useAppStore((s) => s.refresh);

  useEffect(() => {
    if (!ready) return;
    let last = 0;
    const run = () => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - last < REFRESH_MIN_INTERVAL_MS) return;
      last = now;
      void refresh();
    };
    window.addEventListener('focus', run);
    document.addEventListener('visibilitychange', run);
    return () => {
      window.removeEventListener('focus', run);
      document.removeEventListener('visibilitychange', run);
    };
  }, [ready, refresh]);
}

/**
 * Asks before the tab closes while a save is still in flight or has failed.
 * In-memory state runs ahead of storage; without this, a reload straight
 * after a failed save silently drops the change that is still on screen.
 */
export function useUnsavedChangesWarning(): void {
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!useAppStore.getState().unsaved) return;
      e.preventDefault();
      // Older browsers need a value set to show the prompt; the text itself is ignored.
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);
}
