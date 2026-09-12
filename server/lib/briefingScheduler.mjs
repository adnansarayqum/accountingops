/**
 * Sends the morning briefing on weekday mornings to everyone who asked for
 * it. One timer for the whole process; each tick asks briefing.mjs whether
 * each recipient is due, composes from the stored snapshot, and sends
 * through the same email provider the reminder composer uses.
 *
 * Every collaborator is injectable so the tests can run a morning in
 * milliseconds: the clock, the provider, the store. A failure for one
 * recipient is logged and does not stop the others, and a failure of the
 * whole tick waits for the next one — this must never take the web server
 * down with it.
 */
import { composeBriefing, localParts, shouldSendNow } from './briefing.mjs';
import { listBriefingRecipients, markBriefingSent, readPracticeSnapshot } from './briefingStore.mjs';
import { emailProvider } from './messaging/index.mjs';

export const TICK_MS = 60 * 1000;

function log(level, message, extra = {}) {
  console.log(JSON.stringify({ level, at: new Date().toISOString(), source: 'briefing', message, ...extra }));
}

export function sendHourFromEnv(env = process.env) {
  const n = Number(env.BRIEFING_SEND_HOUR);
  return Number.isInteger(n) && n >= 0 && n <= 23 ? n : 7;
}

export class BriefingScheduler {
  #options;
  #timer = null;
  #ticking = false;

  constructor(options = {}) {
    this.#options = {
      intervalMs: options.intervalMs ?? TICK_MS,
      now: options.now ?? (() => new Date()),
      sendHour: options.sendHour ?? sendHourFromEnv(),
      provider: options.provider ?? null,
      listRecipients: options.listRecipients ?? listBriefingRecipients,
      readSnapshot: options.readSnapshot ?? readPracticeSnapshot,
      markSent: options.markSent ?? markBriefingSent,
      appUrl: options.appUrl ?? process.env.PUBLIC_APP_URL ?? '',
      setInterval: options.setInterval ?? ((fn, ms) => setInterval(fn, ms)),
      clearInterval: options.clearInterval ?? ((t) => clearInterval(t)),
    };
    this.stats = { ticks: 0, sent: 0, failed: 0 };
  }

  start() {
    if (this.#timer) return;
    this.#timer = this.#options.setInterval(() => void this.tick(), this.#options.intervalMs);
    void this.tick();
  }

  stop() {
    if (this.#timer) this.#options.clearInterval(this.#timer);
    this.#timer = null;
  }

  #provider() {
    return this.#options.provider ?? emailProvider();
  }

  /** One pass. Returns what it did, for the tests and the logs. */
  async tick() {
    if (this.#ticking) return { sent: 0, skipped: 'busy' };
    this.#ticking = true;
    this.stats.ticks += 1;
    try {
      const provider = this.#provider();
      if (!provider.isConfigured()) return { sent: 0, skipped: 'no_provider' };

      const recipients = await this.#options.listRecipients();
      if (recipients.length === 0) return { sent: 0, skipped: 'no_recipients' };

      const now = this.#options.now();
      let snapshot = null;
      let sent = 0;
      for (const recipient of recipients) {
        const timezone = snapshot?.practice?.timezone ?? 'Europe/London';
        const decision = shouldSendNow({ now, timezone, lastSentOn: recipient.lastSentOn, sendHour: this.#options.sendHour });
        if (!decision.send) continue;
        try {
          // Read the snapshot lazily and once: most ticks send to nobody.
          snapshot ??= (await this.#options.readSnapshot()) ?? {};
          const tz = snapshot.practice?.timezone ?? timezone;
          const today = localParts(now, tz).date;
          const { subject, body } = composeBriefing(snapshot, today, { appUrl: this.#options.appUrl });
          await provider.send({ to: recipient.email, subject, body });
          await this.#options.markSent(recipient.userId, today);
          sent += 1;
          this.stats.sent += 1;
          log('info', 'Briefing sent', { userId: recipient.userId });
        } catch (err) {
          this.stats.failed += 1;
          log('error', `Briefing failed for ${recipient.userId}: ${err?.message ?? err}`);
        }
      }
      return { sent };
    } catch (err) {
      log('error', `Briefing tick failed: ${err?.message ?? err}`);
      return { sent: 0, skipped: 'error' };
    } finally {
      this.#ticking = false;
    }
  }
}
