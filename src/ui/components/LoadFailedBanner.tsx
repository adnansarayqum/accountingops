import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from './Button';
import { useAppStore } from '../../application/store';

/**
 * Sits above the page while the practice data hasn't loaded. The shell still
 * renders so the user isn't stranded on a blank screen, but what's under
 * this banner is an empty stand-in and every change is refused until a
 * retry succeeds — see AppState.loadFailed.
 */
export function LoadFailedBanner() {
  const loadFailed = useAppStore((s) => s.loadFailed);
  const init = useAppStore((s) => s.init);
  const [busy, setBusy] = useState(false);
  if (!loadFailed) return null;

  const retry = async () => {
    setBusy(true);
    try {
      await init();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div role="alert" className="bg-red-50 border-b border-red-200 text-red-900 px-4 sm:px-6 py-2 text-sm flex flex-wrap items-center gap-x-3 gap-y-2" data-testid="load-failed-banner">
      <AlertTriangle className="h-4 w-4 shrink-0 text-red-600" aria-hidden />
      <span className="flex-1 min-w-48">Practice data didn't load. What's shown is empty, not your real data, and changes are paused until it loads.</span>
      <Button size="sm" variant="danger" onClick={() => void retry()} disabled={busy} data-testid="load-failed-retry">
        {busy ? 'Loading…' : 'Try again'}
      </Button>
    </div>
  );
}
