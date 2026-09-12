import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from './Button';
import { cn } from '../cn';
import { useAppStore } from '../../application/store';
import { useData } from '../../application/selectors';
import { findAllSyncableClients, refreshAllClients, type RefreshAllProgress } from '../../application/refreshAllClients';
import { getCompaniesHouseStatus, getCompanyPeople, lookupCompanyProfile } from '../../integrations/companiesHouse';

/**
 * Brings every limited company up to date from Companies House in one go
 * (see application/refreshAllClients.ts). Shown only when a live key is
 * configured — without one there is nothing real to refresh from.
 */
export function RefreshAllCompaniesHouseButton() {
  const data = useData();
  const loadFailed = useAppStore((s) => s.loadFailed);
  const toast = useAppStore((s) => s.toast);
  const [configured, setConfigured] = useState(false);
  const [progress, setProgress] = useState<RefreshAllProgress | null>(null);

  useEffect(() => {
    let cancelled = false;
    getCompaniesHouseStatus()
      .then((status) => {
        if (!cancelled) setConfigured(status.configured);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const candidates = findAllSyncableClients(data.clients, data.identifiers);
  if (!configured || candidates.length === 0) return null;

  const run = async () => {
    if (progress || loadFailed) return;
    setProgress({ done: 0, total: candidates.length });
    try {
      const result = await refreshAllClients(candidates, {
        lookup: async (companyNumber) => {
          const [looked, people] = await Promise.all([lookupCompanyProfile(companyNumber), getCompanyPeople(companyNumber)]);
          if (looked.outcome !== 'live' || !looked.profile) return { ok: false, reason: looked.outcome === 'not_found' ? 'not_found' : looked.outcome === 'rate_limited' ? 'rate_limited' : 'unavailable' };
          // Sample people are not from the register — record nothing rather than synthetic directors.
          return { ok: true, profile: looked.profile, people: people.source === 'companies_house' ? people : null };
        },
        apply: (updates) => useAppStore.getState().refreshClientsFromCompaniesHouse(updates),
        onProgress: setProgress,
      });
      const notes = [
        `${result.refreshed} ${result.refreshed === 1 ? 'client' : 'clients'} refreshed`,
        result.peopleAdded > 0 ? `${result.peopleAdded} ${result.peopleAdded === 1 ? 'person' : 'people'} added` : null,
        result.verificationsConfirmed > 0 ? `${result.verificationsConfirmed} identity ${result.verificationsConfirmed === 1 ? 'verification' : 'verifications'} confirmed` : null,
      ].filter(Boolean);
      if (result.failed.length === 0) {
        toast({ title: 'Refreshed from Companies House', description: `${notes.join(', ')}.`, tone: 'success' });
      } else {
        const names = result.failed.slice(0, 5).map((f) => data.clients.find((c) => c.id === f.clientId)?.name ?? f.companyNumber);
        const more = result.failed.length > 5 ? ` and ${result.failed.length - 5} more` : '';
        toast({
          title: `${notes.join(', ')} — ${result.failed.length} couldn't be looked up`,
          description: `${names.join(', ')}${more}. Check their company numbers, or try again in a minute if Companies House was busy.`,
          tone: result.refreshed > 0 ? 'info' : 'error',
        });
      }
    } catch (err) {
      toast({ title: "Couldn't refresh", description: (err as Error).message, tone: 'error' });
    } finally {
      setProgress(null);
    }
  };

  return (
    <Button variant="secondary" icon={<RefreshCw className={cn('h-4 w-4', progress && 'animate-spin')} />} onClick={() => void run()} disabled={progress !== null || loadFailed} data-testid="refresh-all-companies-house" aria-live="polite">
      {progress ? `Refreshing ${progress.done} of ${progress.total}…` : 'Refresh all from Companies House'}
    </Button>
  );
}
