import { useEffect, useRef } from 'react';
import { useAppStore } from './store';
import { acknowledgeIntakeActivity, getIntakeActivity, getIntakeStatus } from '../integrations/intake';

/** A minute after sharing is soon enough — the share screen already said where it went. */
const POLL_MS = 60 * 1000;

function tabIsVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState === 'visible';
}

/**
 * Pulls documents shared into the app into Smart Inbox. The same shape as
 * usePortalActivity, for the same reasons: a share never writes the
 * practice snapshot, so what it found queues server-side and is applied
 * here through an ordinary store action — only from a visible tab, and
 * only after re-reading the stored snapshot, so a background tab never
 * saves an hours-old copy over everyone else's work.
 */
export function useIntakeActivity(): void {
  const ready = useAppStore((s) => s.ready);
  const running = useRef(false);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    let enabled = false;

    const pass = async () => {
      if (running.current || cancelled || !enabled || !tabIsVisible()) return;
      running.current = true;
      try {
        const activity = await getIntakeActivity();
        if (cancelled || activity.length === 0) return;
        await useAppStore.getState().refresh();
        if (cancelled) return;
        const { applied, skipped } = useAppStore.getState().receiveIntakeActivity(activity);
        const handled = [...applied, ...skipped];
        if (handled.length > 0) await acknowledgeIntakeActivity(handled);
        if (applied.length > 0) {
          const rows = activity.filter((a) => applied.includes(a.id));
          const filed = rows.filter((a) => a.filed && a.clientId && useAppStore.getState().data.clients.some((c) => c.id === a.clientId)).length;
          const toSort = rows.length - filed;
          const parts = [filed > 0 ? `${filed} filed` : null, toSort > 0 ? `${toSort} to sort in Smart Inbox` : null].filter(Boolean);
          useAppStore.getState().toast({ title: 'Shared documents', description: `${rows.length === 1 ? '1 document' : `${rows.length} documents`}: ${parts.join(', ')}.`, tone: 'info' });
        }
      } catch {
        // Background work: a failed pass waits for the next one.
      } finally {
        running.current = false;
      }
    };

    // The browser-only build has no /api/intake, so the status call is the
    // one honest test of whether there is anything to poll.
    void getIntakeStatus().then((status) => {
      if (cancelled || !status.configured) return;
      enabled = true;
      void pass();
    });
    const timer = setInterval(() => void pass(), POLL_MS);
    const onVisibility = () => {
      if (tabIsVisible()) void pass();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [ready]);
}
