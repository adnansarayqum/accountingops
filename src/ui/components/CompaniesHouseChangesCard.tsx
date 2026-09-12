import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Radio, RefreshCw } from 'lucide-react';
import { Card, CardBody, CardHeader } from './Card';
import { Button } from './Button';
import { Badge } from './Badge';
import { cn } from '../cn';
import { useAppStore } from '../../application/store';
import { useData } from '../../application/selectors';
import { acknowledgeStreamChanges, describeChange, getStreamChanges, getStreamStatus, type CompaniesHouseChange } from '../../integrations/companiesHouseStream';
import { getCompanyPeople, lookupCompanyProfile } from '../../integrations/companiesHouse';
import { formatAgo } from '../../domain/dates';

/** How often to ask the server what its stream listener has seen. */
const POLL_MS = 60_000;

/**
 * What Companies House has told us changed, since the last time anyone
 * looked. The server holds one long-lived connection to the streaming API
 * and records changes to this practice's own clients (see
 * server/lib/companiesHouseStream.mjs); this is where they surface.
 *
 * Nothing here is applied automatically. The stream says *that* a record
 * moved; pulling it in is the same explicit refresh as the button on the
 * Clients page, saved as one ordinary version — so a background feed can
 * never quietly rewrite client data while somebody is editing it.
 *
 * Renders nothing at all when the stream isn't configured, which includes
 * the whole browser-only mode.
 */
export function CompaniesHouseChangesCard() {
  const data = useData();
  const loadFailed = useAppStore((s) => s.loadFailed);
  const toast = useAppStore((s) => s.toast);
  const [configured, setConfigured] = useState(false);
  const [changes, setChanges] = useState<CompaniesHouseChange[]>([]);
  const [lastError, setLastError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const today = useAppStore((s) => s.today);

  const load = useCallback(async () => {
    const result = await getStreamChanges();
    setChanges(result.changes);
    setLastError(result.lastError);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    void getStreamStatus().then((status) => {
      if (cancelled || !status.configured) return;
      setConfigured(true);
      void load();
      timer = setInterval(() => void load(), POLL_MS);
    });
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [load]);

  if (!configured || changes.length === 0) return null;

  // A change names a company number; the practice knows it as a client.
  const clientFor = (companyNumber: string) => {
    const identifier = data.identifiers.find((i) => i.kind === 'company_number' && i.value.trim().toUpperCase() === companyNumber.toUpperCase());
    return identifier ? data.clients.find((c) => c.id === identifier.clientId) : undefined;
  };

  const rows = changes.map((change) => ({ change, client: clientFor(change.companyNumber) }));

  const refresh = async () => {
    if (busy || loadFailed) return;
    setBusy(true);
    try {
      const updates = [];
      for (const { change, client } of rows) {
        if (!client) continue;
        const [looked, people] = await Promise.all([lookupCompanyProfile(change.companyNumber), getCompanyPeople(change.companyNumber)]);
        if (looked.outcome !== 'live' || !looked.profile) continue;
        updates.push({ clientId: client.id, profile: looked.profile, people: people.source === 'companies_house' ? people : null });
      }
      if (updates.length > 0) {
        // Re-read before writing: every save is the whole practice, so a
        // stale copy here would write over whatever anyone else has done.
        await useAppStore.getState().refresh();
        useAppStore.getState().refreshClientsFromCompaniesHouse(updates);
      }
      await acknowledgeStreamChanges();
      await load();
      toast({
        title: updates.length > 0 ? 'Pulled in the changes' : 'Nothing left to pull in',
        description: updates.length > 0 ? `${updates.length} ${updates.length === 1 ? 'client' : 'clients'} updated from Companies House.` : 'These changes are cleared.',
        tone: 'success',
      });
    } catch (err) {
      toast({ title: "Couldn't pull in the changes", description: (err as Error).message, tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const dismiss = async () => {
    await acknowledgeStreamChanges();
    await load();
  };

  return (
    <Card data-testid="companies-house-changes">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            Changed at Companies House
            <Badge tone="blue">{changes.length}</Badge>
          </span>
        }
        icon={<Radio />}
        description="Pushed live from the Companies House register, not found by polling. Nothing is applied until you pull it in."
        action={
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => void dismiss()} disabled={busy}>
              Dismiss
            </Button>
            <Button size="sm" icon={<RefreshCw className={cn('h-4 w-4', busy && 'animate-spin')} />} onClick={() => void refresh()} disabled={busy || loadFailed} data-testid="pull-in-companies-house-changes">
              {busy ? 'Pulling in…' : `Pull in ${rows.filter((r) => r.client).length}`}
            </Button>
          </div>
        }
      />
      <CardBody className="pt-0">
        <ul className="divide-y divide-slate-100">
          {rows.map(({ change, client }) => (
            <li key={`${change.companyNumber}-${change.seenAt}`} className="py-2 flex items-center justify-between gap-3" data-testid={`ch-change-${change.companyNumber}`}>
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-slate-900 truncate">
                  {client ? (
                    <Link to={`/clients/${client.id}`} className="hover:text-primary-700">
                      {client.name}
                    </Link>
                  ) : (
                    // A company we no longer hold — worth showing rather than hiding,
                    // since it usually means the client was removed here but not there.
                    <span className="tabular">{change.companyNumber}</span>
                  )}
                </p>
                <p className="text-xs text-slate-500 truncate">{describeChange(change)}</p>
              </div>
              <span className="shrink-0 text-[11px] text-slate-400">{formatAgo(change.seenAt, today)}</span>
            </li>
          ))}
        </ul>
        {lastError && <p className="mt-3 text-xs text-amber-700">The live feed reported: {lastError}. It retries on its own; the Refresh button still works.</p>}
      </CardBody>
    </Card>
  );
}
