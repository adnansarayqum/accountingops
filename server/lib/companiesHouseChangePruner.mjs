/**
 * Housekeeping for companies_house_changes: clears acknowledged rows older
 * than a retention window, on a recurring timer for the life of the
 * process — not just once at boot. A deployment that stays up for weeks
 * without a restart would otherwise let acknowledged rows accumulate
 * indefinitely between restarts, the one gap `pruneAcknowledgedChanges`
 * itself doesn't close on its own.
 *
 * Same shape as BriefingScheduler: everything injectable so a test can run
 * days of ticks in milliseconds, and a failed tick is logged and waits for
 * the next one rather than taking the web server down with it.
 */
import { pruneAcknowledgedChanges } from './companiesHouseStreamStore.mjs';

/** Once a day is plenty for a retention window measured in weeks. */
export const TICK_MS = 24 * 60 * 60 * 1000;

function log(level, message, extra = {}) {
  console.log(JSON.stringify({ level, at: new Date().toISOString(), source: 'companies_house_stream', message, ...extra }));
}

export class CompaniesHouseChangePruner {
  #options;
  #timer = null;
  #ticking = false;

  constructor(options = {}) {
    this.#options = {
      intervalMs: options.intervalMs ?? TICK_MS,
      olderThanDays: options.olderThanDays ?? 30,
      prune: options.prune ?? pruneAcknowledgedChanges,
      setInterval: options.setInterval ?? ((fn, ms) => setInterval(fn, ms)),
      clearInterval: options.clearInterval ?? ((t) => clearInterval(t)),
    };
    this.stats = { ticks: 0, deleted: 0, failed: 0 };
  }

  /** Runs one prune immediately, then on the recurring interval. */
  start() {
    if (this.#timer) return;
    this.#timer = this.#options.setInterval(() => void this.tick(), this.#options.intervalMs);
    void this.tick();
  }

  stop() {
    if (this.#timer) this.#options.clearInterval(this.#timer);
    this.#timer = null;
  }

  async tick() {
    if (this.#ticking) return { deleted: 0, skipped: 'busy' };
    this.#ticking = true;
    this.stats.ticks += 1;
    try {
      const deleted = await this.#options.prune(this.#options.olderThanDays);
      this.stats.deleted += deleted;
      if (deleted > 0) log('info', `Pruned ${deleted} acknowledged Companies House change(s)`);
      return { deleted };
    } catch (err) {
      this.stats.failed += 1;
      log('error', `Prune failed: ${err?.message ?? err}`);
      return { deleted: 0, skipped: 'error' };
    } finally {
      this.#ticking = false;
    }
  }
}
