import { useCallback, useEffect, useState } from 'react';
import { History, RotateCcw } from 'lucide-react';
import { Card, CardBody, CardHeader } from './Card';
import { Button } from './Button';
import { useAppStore } from '../../application/store';
import { useData } from '../../application/selectors';
import { fetchSnapshotHistory, restoreSnapshotVersion, type SnapshotHistory } from '../../application/practiceHistory';
import { formatDateTime } from '../../domain/dates';

/**
 * The last few dozen saved versions of the shared practice, with a way back
 * to any of them. A restore is itself a new version on top of the current
 * one, never a rewrite of history, so restoring the wrong one is undone the
 * same way. Server mode only — the browser-only mode has no history.
 */
export function SnapshotHistoryCard() {
  const data = useData();
  const init = useAppStore((s) => s.init);
  const toast = useAppStore((s) => s.toast);
  const [history, setHistory] = useState<SnapshotHistory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      setHistory(await fetchSnapshotHistory());
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const restore = async (version: number) => {
    if (!history) return;
    if (!window.confirm(`Go back to version ${version}? Everything saved since then will be undone (as a new version, so this can itself be undone).`)) return;
    setRestoring(version);
    try {
      await restoreSnapshotVersion(version, history.current);
      await init();
      await load();
      toast({ title: `Restored version ${version}`, description: 'The practice is back to how it was at that save.', tone: 'success' });
    } catch (err) {
      toast({ title: "Couldn't restore", description: (err as Error).message, tone: 'error' });
    } finally {
      setRestoring(null);
    }
  };

  const nameOf = (userId: string | null) => (userId ? (data.users.find((u) => u.id === userId)?.name ?? userId) : 'unknown');

  return (
    <Card data-testid="snapshot-history">
      <CardHeader title="Version history" icon={<History />} description="Every save is kept. If something is overwritten by mistake, go back to the version before it." />
      <CardBody className="pt-0">
        {error && (
          <p className="text-[13px] text-red-600" role="alert">
            {error}
          </p>
        )}
        {history && history.versions.length === 0 && <p className="text-[13px] text-slate-500">Nothing saved yet.</p>}
        {history && history.versions.length > 0 && (
          <ul className="divide-y divide-slate-100">
            {history.versions.map((v) => {
              const isCurrent = v.version === history.current;
              return (
                <li key={v.version} className="py-2 flex items-center gap-3" data-testid={`snapshot-version-${v.version}`}>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-slate-900">
                      Version {v.version}
                      {isCurrent && <span className="ml-2 text-xs font-normal text-emerald-700">current</span>}
                    </p>
                    <p className="text-xs text-slate-500">
                      {formatDateTime(v.savedAt)} · {nameOf(v.savedBy)}
                    </p>
                  </div>
                  {!isCurrent && (
                    <Button size="sm" variant="secondary" icon={<RotateCcw />} onClick={() => void restore(v.version)} disabled={restoring !== null} data-testid={`restore-version-${v.version}`}>
                      {restoring === v.version ? 'Restoring…' : 'Restore'}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
