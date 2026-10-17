/**
 * Runs the automatic reminders every few minutes, for as long as the server
 * is up. One timer for the whole process; each tick is one runAutomation()
 * pass, which decides for itself whether anything is switched on, due and
 * allowed. The tick is cheap when nothing is (one snapshot read), and a
 * failure waits for the next tick — nothing here can take the web server
 * down. Collaborators are injectable so a day can be run in milliseconds.
 */
import { runAutomation } from './automationRunner.mjs';
import * as store from './automationStore.mjs';
import { readPracticeSnapshot } from './briefingStore.mjs';
import { emailProvider } from './messaging/index.mjs';

export const TICK_MS = 10 * 60 * 1000;

function log(level, message, extra = {}) {
  console.log(JSON.stringify({ level, at: new Date().toISOString(), source: 'automation', message, ...extra }));
}

/** The real collaborators; the routes use the same set. */
export function automationDeps() {
  return {
    readSnapshot: readPracticeSnapshot,
    getProvider: emailProvider,
    pendingByJob: store.pendingByJob,
    claimReminder: store.claimReminder,
    completeReminder: store.completeReminder,
    releaseReminder: store.releaseReminder,
    markReminderUnknown: store.markReminderUnknown,
  };
}

export class AutomationScheduler {
  #options;
  #timer = null;
  #ticking = false;

  constructor(options = {}) {
    this.#options = {
      intervalMs: options.intervalMs ?? TICK_MS,
      now: options.now ?? (() => new Date()),
      deps: options.deps ?? automationDeps(),
      setInterval: options.setInterval ?? ((fn, ms) => setInterval(fn, ms)),
      clearInterval: options.clearInterval ?? ((t) => clearInterval(t)),
    };
    this.stats = { ticks: 0, sent: 0, failed: 0 };
  }

  start() {
    if (this.#timer) return;
    this.#timer = this.#options.setInterval(() => void this.tick(), this.#options.intervalMs);
    // Not at once: a deploy or restart shouldn't send mail in its first second.
  }

  stop() {
    if (this.#timer) this.#options.clearInterval(this.#timer);
    this.#timer = null;
  }

  /** One pass. Returns what it did, for the tests and the logs. */
  async tick() {
    if (this.#ticking) return { status: 'busy' };
    this.#ticking = true;
    this.stats.ticks += 1;
    try {
      const result = await runAutomation({ now: this.#options.now() }, this.#options.deps);
      if (result.status === 'done') {
        this.stats.sent += result.sent.length;
        this.stats.failed += result.failed.length + result.unknown.length;
        log('info', 'Automatic reminders pass', { sent: result.sent.length, failed: result.failed.length, unknown: result.unknown.length });
      }
      return { status: result.status, sent: result.sent?.length ?? 0 };
    } catch (err) {
      log('error', `Automatic reminders pass failed: ${err?.message ?? err}`);
      return { status: 'error' };
    } finally {
      this.#ticking = false;
    }
  }
}
