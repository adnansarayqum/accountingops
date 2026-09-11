import { DatabaseZap } from 'lucide-react';
import { Card, CardBody } from '../ui/components/Card';
import { Button } from '../ui/components/Button';

/**
 * Shown when the server has a database configured but it isn't answering.
 * Deliberately a dead end rather than a fallback to the browser-only mode:
 * anything typed into a local copy during an outage would live in one
 * browser only and never reach the shared practice.
 */
export function UnavailablePage({ onRetry, busy }: { onRetry: () => void; busy: boolean }) {
  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-amber-500 text-white mb-3">
            <DatabaseZap className="h-5 w-5" />
          </span>
          <h1 className="text-lg font-bold text-slate-900">The practice database isn't reachable</h1>
          <p className="text-sm text-slate-500">Nothing has been lost — it's just not answering right now.</p>
        </div>
        <Card>
          <CardBody>
            <div className="space-y-4" role="alert">
              <p className="text-sm text-slate-600">
                Your practice data is stored on the server, so this page waits rather than opening an empty copy that couldn't be saved. This usually clears in a minute or two.
              </p>
              <Button type="button" className="w-full justify-center" onClick={onRetry} disabled={busy} data-testid="unavailable-retry">
                {busy ? 'Checking…' : 'Try again'}
              </Button>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
