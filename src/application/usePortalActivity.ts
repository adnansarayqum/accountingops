import { useEffect, useRef } from 'react';
import { useAppStore } from './store';
import { acknowledgePortalActivity, getPortalActivity, getPortalStatus } from '../integrations/portal';

/** How often to ask what clients have done. Portal actions are rare and never urgent to the second. */
const POLL_MS = 60 * 1000;

function tabIsVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState === 'visible';
}

/**
 * Pulls what clients did through the portal into the practice's own data.
 *
 * The portal never writes the practice snapshot — a public route racing a
 * versioned save would be the wrong trade — so uploads and approval
 * decisions queue server-side, and this applies them through the store's
 * ordinary actions. That is why no rule is duplicated: `markItemReceived`
 * and `recordApproval` do exactly what they do when an accountant clicks.
 *
 * Applies only from a visible tab, and re-reads the stored snapshot first,
 * for the same reason the Companies House sync does: every save is the
 * whole practice, and a background tab writing an hours-old copy would
 * undo everyone else's work.
 *
 * Deliberately no confirmation step. These are the client's own actions on
 * their own job — the same thing the accountant would record on a phone
 * call, minus the phone call.
 */
export function usePortalActivity(): void {
  const ready = useAppStore((s) => s.ready);
  const running = useRef(false);

  // Gated on the server saying the portal exists, not on the auth mode: the
  // browser-only build has no /api/portal at all, so the status call is the
  // one honest test of whether there is anything to poll.
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    let enabled = false;

    const pass = async () => {
      if (running.current || cancelled || !enabled || !tabIsVisible()) return;
      running.current = true;
      try {
        const activity = await getPortalActivity();
        if (cancelled || activity.length === 0) return;
        await useAppStore.getState().refresh();
        if (cancelled) return;
        const { applied, skipped } = useAppStore.getState().applyPortalActivity(activity);
        const handled = [...applied, ...skipped];
        if (handled.length > 0) await acknowledgePortalActivity(handled);
        if (applied.length > 0) {
          const uploads = activity.filter((a) => applied.includes(a.id) && a.kind === 'upload').length;
          const approvals = activity.filter((a) => applied.includes(a.id) && a.kind === 'approval').length;
          const parts = [uploads > 0 ? `${uploads} ${uploads === 1 ? 'file' : 'files'} uploaded` : null, approvals > 0 ? `${approvals} approval ${approvals === 1 ? 'decision' : 'decisions'}` : null].filter(Boolean);
          useAppStore.getState().toast({ title: 'From your clients', description: `${parts.join(' and ')} via the portal.`, tone: 'info' });
        }
      } catch {
        // Background work: a failed pass waits for the next one.
      } finally {
        running.current = false;
      }
    };

    void getPortalStatus().then((status) => {
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
