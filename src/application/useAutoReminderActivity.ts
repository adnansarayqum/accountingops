import { useEffect, useRef } from 'react';
import { useAppStore } from './store';
import { acknowledgeAutoReminders, getAutoReminderActivity, getAutomationStatus } from '../integrations/automation';

/** Reminders go out in working hours; a minute's delay in recording them is invisible. */
const POLL_MS = 60 * 1000;

function tabIsVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState === 'visible';
}

/**
 * Records the reminders the server emailed on its own in the practice's
 * data, so they show on the client's timeline, count toward the sequence
 * and mark the documents as requested. The same shape as useIntakeActivity,
 * for the same reasons: the server never writes the practice snapshot, so
 * what it did queues and is applied here through an ordinary store action —
 * only from a visible tab, and only after re-reading the stored snapshot.
 */
export function useAutoReminderActivity(): void {
  const ready = useAppStore((s) => s.ready);
  // Every /api/automation route needs a signed-in user; without one (browser-only mode) there is nothing to ask.
  const signedIn = useAppStore((s) => s.authMode === 'server');
  const running = useRef(false);

  useEffect(() => {
    if (!ready || !signedIn) return;
    let cancelled = false;
    let enabled = false;

    const pass = async () => {
      if (running.current || cancelled || !enabled || !tabIsVisible()) return;
      running.current = true;
      try {
        const activity = await getAutoReminderActivity();
        if (cancelled || activity.length === 0) return;
        await useAppStore.getState().refresh();
        if (cancelled) return;
        const { applied, skipped } = useAppStore.getState().receiveAutoReminders(activity);
        const handled = [...applied, ...skipped];
        if (handled.length > 0) await acknowledgeAutoReminders(handled);
        if (applied.length > 0) {
          const state = useAppStore.getState();
          const names = [...new Set(activity.filter((a) => applied.includes(a.id)).map((a) => state.data.clients.find((c) => c.id === a.clientId)?.name).filter(Boolean))];
          state.toast({ title: 'Reminders sent automatically', description: `${applied.length === 1 ? '1 reminder' : `${applied.length} reminders`} emailed${names.length > 0 ? ` to ${names.slice(0, 3).join(', ')}${names.length > 3 ? ` and ${names.length - 3} more` : ''}` : ''}.`, tone: 'info' });
        }
      } catch {
        // Background work: a failed pass waits for the next one.
      } finally {
        running.current = false;
      }
    };

    // A server without a database answers the status call with an error, so
    // it is still the one honest test of whether there is anything to poll.
    void getAutomationStatus().then((status) => {
      if (cancelled || !status) return;
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
  }, [ready, signedIn]);
}
