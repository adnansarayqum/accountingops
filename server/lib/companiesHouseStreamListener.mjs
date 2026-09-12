/**
 * Owns the single long-lived connection to the Companies House streaming
 * API: connect, read newline-delimited records, filter the whole-register
 * firehose down to this practice's own clients, record what changed, and
 * reconnect when it drops.
 *
 * The protocol rules it obeys (429 minimums, 416 handling, heartbeats,
 * timepoint resumption) all live in companiesHouseStream.mjs so they can be
 * tested without a socket. `fetch`, `sleep` and `now` are injectable for the
 * same reason — the tests drive a whole reconnect cycle in milliseconds.
 *
 * Never writes to the practice snapshot. See companiesHouseStreamStore.mjs
 * for why.
 */
import { backoffMs, isInterestingChange, matchesWatched, parseStreamLine, reasonForStatus, shouldDropTimepoint, splitLines, streamAuthHeader, streamUrl } from './companiesHouseStream.mjs';
import { recordChange, watchedCompanyNumbers, writeStreamState } from './companiesHouseStreamStore.mjs';

/** How often to re-read which companies belong to the practice, so a client added today gets watched without a restart. */
export const WATCHED_REFRESH_MS = 5 * 60 * 1000;

/**
 * Companies House sends a heartbeat on an otherwise-idle stream, so total
 * silence means the connection is dead even though the socket looks open.
 * Longer than their heartbeat interval by a wide margin — reconnecting for
 * no reason costs a connection slot.
 */
export const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Sentinel for "the idle window expired before any chunk arrived". */
const IDLE = Symbol('idle');

function log(level, message, extra = {}) {
  console.log(JSON.stringify({ level, at: new Date().toISOString(), source: 'companies_house_stream', message, ...extra }));
}

export class CompaniesHouseStreamListener {
  #options;
  #running = false;
  #controller = null;
  #watched = new Set();
  #watchedAt = 0;
  #stopped;

  constructor(options = {}) {
    this.#options = {
      apiKey: options.apiKey ?? process.env.COMPANIES_HOUSE_STREAM_API_KEY,
      fetch: options.fetch ?? globalThis.fetch,
      sleep: options.sleep ?? defaultSleep,
      now: options.now ?? (() => Date.now()),
      readState: options.readState,
      writeState: options.writeState ?? writeStreamState,
      recordChange: options.recordChange ?? recordChange,
      watchedCompanyNumbers: options.watchedCompanyNumbers ?? watchedCompanyNumbers,
      idleTimeoutMs: options.idleTimeoutMs ?? IDLE_TIMEOUT_MS,
      setTimeout: options.setTimeout ?? ((fn, ms) => setTimeout(fn, ms)),
      clearTimeout: options.clearTimeout ?? ((t) => clearTimeout(t)),
      watchedRefreshMs: options.watchedRefreshMs ?? WATCHED_REFRESH_MS,
      /** Stop after this many connection attempts. Tests set it; production leaves it infinite. */
      maxAttempts: options.maxAttempts ?? Infinity,
    };
    this.stats = { connects: 0, eventsSeen: 0, eventsMatched: 0, eventsRecorded: 0, lastReason: null };
  }

  get running() {
    return this.#running;
  }

  /** Resolves when the loop has actually finished — tests await it; production doesn't. */
  start(initialTimepoint = null) {
    if (this.#running) return this.#stopped;
    this.#running = true;
    this.#stopped = this.#loop(initialTimepoint).finally(() => {
      this.#running = false;
    });
    return this.#stopped;
  }

  async stop() {
    this.#running = false;
    this.#controller?.abort();
    await this.#stopped?.catch(() => {});
  }

  async #loop(initialTimepoint) {
    let timepoint = initialTimepoint;
    let attempt = 0;
    let attempts = 0;

    while (this.#running && attempts < this.#options.maxAttempts) {
      attempts += 1;
      let reason;
      try {
        await this.#refreshWatched();
        const result = await this.#connectAndRead(timepoint);
        timepoint = result.timepoint ?? timepoint;
        reason = result.reason;
      } catch (err) {
        reason = 'network';
        await this.#recordFailure(err?.message ?? String(err));
      }

      if (!this.#running) break;
      this.stats.lastReason = reason;
      if (shouldDropTimepoint(reason)) {
        // A 416 means the stored timepoint is unusable. Starting from "now"
        // loses whatever happened while we were behind, so say so loudly
        // rather than silently skipping a gap.
        log('warn', 'Stream timepoint too old; restarting from now. Changes during the gap were not seen.', { timepoint });
        timepoint = null;
      }
      // A connection that produced events was healthy, however it ended —
      // reset the curve so one long-lived session doesn't inherit an old
      // outage's backoff.
      attempt = reason === 'ended' && this.stats.eventsSeen > 0 ? 0 : attempt + 1;
      const wait = backoffMs(reason, Math.min(attempt, 10));
      if (attempts < this.#options.maxAttempts) await this.#options.sleep(wait);
    }
    return { timepoint, attempts };
  }

  async #refreshWatched() {
    const age = this.#options.now() - this.#watchedAt;
    if (this.#watchedAt !== 0 && age < this.#options.watchedRefreshMs) return;
    try {
      this.#watched = await this.#options.watchedCompanyNumbers();
      this.#watchedAt = this.#options.now();
    } catch (err) {
      // Keep the previous set rather than watching nothing: a database blip
      // must not silently turn the listener into a no-op.
      log('error', `Could not refresh watched companies: ${err?.message ?? err}`);
    }
  }

  async #connectAndRead(timepoint) {
    const auth = streamAuthHeader(this.#options.apiKey);
    if (!auth) return { reason: 'httpError', timepoint };

    this.#controller = new AbortController();
    const res = await this.#options.fetch(streamUrl(timepoint), {
      headers: { Authorization: auth, Accept: 'application/json' },
      signal: this.#controller.signal,
    });

    if (!res.ok) {
      const reason = reasonForStatus(res.status);
      await this.#recordFailure(`stream responded ${res.status}`);
      log('warn', `Stream connection refused with ${res.status}`, { reason });
      return { reason, timepoint };
    }

    this.stats.connects += 1;
    await this.#options.writeState({ connectedAt: new Date().toISOString(), lastError: '' });
    log('info', 'Stream connected', { resuming: Boolean(timepoint) });

    return this.#read(res, timepoint);
  }

  async #read(res, startingTimepoint) {
    let timepoint = startingTimepoint;
    let buffer = '';
    const reader = res.body?.getReader?.();
    if (!reader) return { reason: 'httpError', timepoint };
    const decoder = new TextDecoder();

    try {
      while (this.#running) {
        const chunk = await this.#readOrIdle(reader);
        if (chunk === IDLE) {
          log('warn', 'Stream idle past the heartbeat window; reconnecting', { idleTimeoutMs: this.#options.idleTimeoutMs });
          this.#controller?.abort();
          return { reason: 'network', timepoint };
        }
        const { done, value } = chunk;
        if (done) return { reason: 'ended', timepoint };

        buffer += decoder.decode(value, { stream: true });
        const split = splitLines(buffer);
        buffer = split.remainder;

        for (const line of split.lines) {
          const processed = await this.#handleLine(line);
          if (processed !== null) timepoint = processed;
        }
      }
      return { reason: 'ended', timepoint };
    } catch (err) {
      if (err?.name === 'AbortError') return { reason: 'ended', timepoint };
      await this.#recordFailure(err?.message ?? String(err));
      return { reason: 'network', timepoint };
    } finally {
      await reader.cancel().catch(() => {});
    }
  }

  /**
   * One read, abandoned if nothing arrives within the idle window.
   *
   * The timeout has to race the read rather than be checked on the way
   * round the loop: a silently-dead connection never resolves `read()` at
   * all, so that check would never run again and the listener would hang on
   * a socket that is open but finished — the exact failure the idle window
   * exists to catch. Companies House send a heartbeat on an otherwise-quiet
   * stream, so any chunk (a blank heartbeat line included) counts as alive
   * and restarts the window.
   */
  async #readOrIdle(reader) {
    const timeoutMs = this.#options.idleTimeoutMs;
    if (!Number.isFinite(timeoutMs)) return reader.read();
    let timer;
    const idle = new Promise((resolve) => {
      timer = this.#options.setTimeout(() => resolve(IDLE), timeoutMs);
    });
    try {
      return await Promise.race([reader.read(), idle]);
    } finally {
      this.#options.clearTimeout(timer);
    }
  }

  /** Returns the event's timepoint when the line was a usable record, else null. */
  async #handleLine(line) {
    const event = parseStreamLine(line);
    if (!event) return null;
    this.stats.eventsSeen += 1;

    if (!matchesWatched(event, this.#watched)) {
      // Not one of ours. Still advance the timepoint: it marks how far
      // through the register's stream we are, not how far through our own
      // clients, and not advancing it would replay the firehose on every
      // reconnect.
      await this.#options.writeState({ timepoint: event.timepoint, lastEventAt: new Date().toISOString() });
      return event.timepoint;
    }

    this.stats.eventsMatched += 1;
    if (isInterestingChange(event)) {
      const recorded = await this.#options.recordChange(event);
      if (recorded) {
        this.stats.eventsRecorded += 1;
        log('info', 'Client changed at Companies House', { companyNumber: event.companyNumber, type: event.type, fieldsChanged: event.fieldsChanged.length });
      }
    }
    await this.#options.writeState({ timepoint: event.timepoint, lastEventAt: new Date().toISOString() });
    return event.timepoint;
  }

  async #recordFailure(message) {
    try {
      await this.#options.writeState({ lastError: String(message).slice(0, 500) });
    } catch {
      // Recording why we failed must not itself end the listener.
    }
  }
}

export function isStreamConfigured() {
  return Boolean(process.env.COMPANIES_HOUSE_STREAM_API_KEY);
}
