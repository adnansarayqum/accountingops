import { useEffect, useRef } from 'react';
import { useAppStore } from './store';
import { BATCH_SIZE, CONCURRENCY, findStaleClients, mapWithConcurrency } from './companiesHouseSync';
import { getCompaniesHouseStatus, getCompanyPeople, getCompanyProfile } from '../integrations/companiesHouse';

/** How often to look for clients whose Companies House data has gone stale. */
const CHECK_EVERY_MS = 30 * 60 * 1000;

/**
 * Keeps Companies House data fresh while the app is open: every half hour it
 * re-pulls a handful of the clients whose data is oldest. Companies House
 * changes slowly (a director resigns, a filing date moves) so a daily refresh
 * per client is plenty, and spreading it over small batches keeps a large
 * roster well inside the API's rate limit.
 *
 * Deliberately silent — no toasts. A sync that nobody asked for shouldn't
 * interrupt anyone; the "Synced ..." line on each client's Companies House
 * card is how this surfaces, and the Refresh button there forces it early.
 */
export function useCompaniesHouseSync(): void {
  const ready = useAppStore((s) => s.ready);
  const running = useRef(false);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;

    const pass = async () => {
      if (running.current || cancelled) return;
      running.current = true;
      try {
        const status = await getCompaniesHouseStatus();
        if (!status.configured || cancelled) return;

        const { data } = useAppStore.getState();
        const stale = findStaleClients(data.clients, data.identifiers, new Date(), { limit: BATCH_SIZE });
        if (stale.length === 0) return;

        const fetched = await mapWithConcurrency(stale, CONCURRENCY, async ({ clientId, companyNumber }) => {
          const [profile, people] = await Promise.all([getCompanyProfile(companyNumber), getCompanyPeople(companyNumber)]);
          // A sample-data fallback means the lookup didn't really happen — leave the
          // client marked unsynced so the next pass tries again rather than recording
          // synthetic data as though it came from the register.
          if (!profile || profile.source !== 'companies_house') return null;
          return { clientId, profile, people: people.source === 'companies_house' ? people : null };
        });

        const updates = fetched.filter((u) => u !== null);
        if (cancelled || updates.length === 0) return;
        useAppStore.getState().refreshClientsFromCompaniesHouse(updates);
      } catch {
        // Background work: a failed pass just waits for the next one.
      } finally {
        running.current = false;
      }
    };

    void pass();
    const timer = setInterval(() => void pass(), CHECK_EVERY_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [ready]);
}
