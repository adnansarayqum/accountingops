import { describe, expect, it, vi } from 'vitest';
import { CompaniesHouseStreamListener } from '../companiesHouseStreamListener.mjs';

const encoder = new TextEncoder();

/** A fetch Response whose body yields the given chunks, then ends. */
function streamResponse(chunks, { status = 200 } = {}) {
  let i = 0;
  return {
    ok: status >= 200 && status < 300,
    status,
    body: {
      getReader: () => ({
        read: async () => (i < chunks.length ? { done: false, value: encoder.encode(chunks[i++]) } : { done: true, value: undefined }),
        cancel: async () => {},
      }),
    },
  };
}

const event = (companyNumber, timepoint, fieldsChanged = ['accounts.next_due'], type = 'changed') =>
  `${JSON.stringify({ resource_id: companyNumber, resource_uri: `/company/${companyNumber}`, event: { timepoint, type, published_at: '2026-09-12T10:00:00', fields_changed: fieldsChanged } })}\n`;

function harness(responses, over = {}) {
  const recorded = [];
  const state = [];
  const fetchMock = vi.fn(async () => responses.shift() ?? streamResponse([]));
  const listener = new CompaniesHouseStreamListener({
    apiKey: 'test-stream-key',
    fetch: fetchMock,
    sleep: async () => {},
    now: () => 0,
    writeState: async (patch) => void state.push(patch),
    recordChange: async (e) => {
      const duplicate = recorded.some((r) => r.companyNumber === e.companyNumber && r.timepoint === e.timepoint);
      if (!duplicate) recorded.push(e);
      return !duplicate;
    },
    watchedCompanyNumbers: async () => new Set(['01234567', 'SC999999']),
    maxAttempts: 1,
    ...over,
  });
  return { listener, recorded, state, fetchMock };
}

describe('CompaniesHouseStreamListener', () => {
  it('records a change for a watched client and ignores the rest of the register', async () => {
    const { listener, recorded } = harness([streamResponse([event('01234567', 10), event('07777777', 11), event('SC999999', 12)])]);
    await listener.start();

    expect(recorded.map((r) => r.companyNumber)).toEqual(['01234567', 'SC999999']);
    expect(listener.stats.eventsSeen).toBe(3);
    expect(listener.stats.eventsMatched).toBe(2);
  });

  it('advances the timepoint past events that are not ours, so a reconnect does not replay the firehose', async () => {
    const { listener, state } = harness([streamResponse([event('07777777', 55)])]);
    await listener.start();
    expect(state.some((p) => p.timepoint === 55)).toBe(true);
  });

  it('sends basic auth with the streaming key, and resumes from the stored timepoint', async () => {
    const { listener, fetchMock } = harness([streamResponse([])]);
    await listener.start(999);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://stream.companieshouse.gov.uk/companies?timepoint=999');
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from('test-stream-key:').toString('base64')}`);
  });

  it('reassembles a record split across two chunks', async () => {
    const whole = event('01234567', 20);
    const { listener, recorded } = harness([streamResponse([whole.slice(0, 30), whole.slice(30)])]);
    await listener.start();
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ companyNumber: '01234567', timepoint: 20 });
  });

  it('ignores heartbeats and malformed lines without dropping the connection', async () => {
    const { listener, recorded } = harness([streamResponse(['\n', '\n', '{ not json\n', event('01234567', 30)])]);
    await listener.start();
    expect(recorded).toHaveLength(1);
    expect(listener.stats.eventsSeen).toBe(1);
  });

  it('skips churn in fields the app never shows', async () => {
    const { listener, recorded } = harness([streamResponse([event('01234567', 40, ['links.self'])])]);
    await listener.start();
    expect(recorded).toHaveLength(0);
    expect(listener.stats.eventsMatched).toBe(1);
  });

  it('records a deletion even though it carries no changed fields', async () => {
    const { listener, recorded } = harness([streamResponse([event('01234567', 41, [], 'deleted')])]);
    await listener.start();
    expect(recorded[0]).toMatchObject({ type: 'deleted' });
  });

  it('does not record the same event twice when a reconnect replays it', async () => {
    const { listener, recorded } = harness([streamResponse([event('01234567', 50)]), streamResponse([event('01234567', 50), event('01234567', 51)])], { maxAttempts: 2 });
    await listener.start();
    expect(recorded.map((r) => r.timepoint)).toEqual([50, 51]);
  });

  it('waits the full minute Companies House require after a 429', async () => {
    const waits = [];
    const { listener } = harness([streamResponse([], { status: 429 }), streamResponse([])], { maxAttempts: 2, sleep: async (ms) => void waits.push(ms) });
    await listener.start();
    expect(waits[0]).toBeGreaterThanOrEqual(60_000);
  });

  it('does not sleep after its final attempt', async () => {
    const waits = [];
    const { listener } = harness([streamResponse([], { status: 429 })], { maxAttempts: 1, sleep: async (ms) => void waits.push(ms) });
    await listener.start();
    expect(listener.stats.lastReason).toBe('rateLimited');
    expect(waits).toEqual([]);
  });

  it('drops a stale timepoint after a 416 and reconnects without one', async () => {
    const { listener, fetchMock } = harness([streamResponse([], { status: 416 }), streamResponse([])], { maxAttempts: 2 });
    await listener.start(12345);

    expect(fetchMock.mock.calls[0][0]).toContain('timepoint=12345');
    expect(fetchMock.mock.calls[1][0]).toBe('https://stream.companieshouse.gov.uk/companies');
  });

  it('reconnects from the last processed timepoint after the stream ends', async () => {
    const { listener, fetchMock } = harness([streamResponse([event('01234567', 60)]), streamResponse([])], { maxAttempts: 2 });
    await listener.start();
    expect(fetchMock.mock.calls[1][0]).toContain('timepoint=60');
  });

  it('records the failure and backs off when the connection throws', async () => {
    const state = [];
    const listener = new CompaniesHouseStreamListener({
      apiKey: 'k',
      fetch: async () => {
        throw new Error('socket hang up');
      },
      sleep: async () => {},
      now: () => 0,
      writeState: async (patch) => void state.push(patch),
      recordChange: async () => true,
      watchedCompanyNumbers: async () => new Set(),
      maxAttempts: 1,
    });
    await listener.start();
    expect(listener.stats.lastReason).toBe('network');
    expect(state.some((p) => p.lastError === 'socket hang up')).toBe(true);
  });

  it('never connects without a streaming key, rather than sending a broken header', async () => {
    const fetchMock = vi.fn();
    const listener = new CompaniesHouseStreamListener({ apiKey: '', fetch: fetchMock, sleep: async () => {}, now: () => 0, writeState: async () => {}, recordChange: async () => true, watchedCompanyNumbers: async () => new Set(), maxAttempts: 1 });
    await listener.start();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps the previous watched set when the database blips, instead of watching nothing', async () => {
    let call = 0;
    const { listener, recorded } = harness([streamResponse([event('01234567', 70)]), streamResponse([event('01234567', 71)])], {
      maxAttempts: 2,
      watchedRefreshMs: 0,
      watchedCompanyNumbers: async () => {
        call += 1;
        if (call === 2) throw new Error('db down');
        return new Set(['01234567']);
      },
    });
    await listener.start();
    expect(recorded.map((r) => r.timepoint)).toEqual([70, 71]);
  });

  it('reconnects when the stream goes silent past the heartbeat window', async () => {
    // A connection that is open but finished: read() never resolves. Checking
    // the clock on the way round the loop would never run again here, so the
    // idle window has to race the read.
    const listener = new CompaniesHouseStreamListener({
      apiKey: 'k',
      fetch: async () => ({
        ok: true,
        status: 200,
        body: { getReader: () => ({ read: () => new Promise(() => {}), cancel: async () => {} }) },
      }),
      sleep: async () => {},
      now: () => 0,
      writeState: async () => {},
      recordChange: async () => true,
      watchedCompanyNumbers: async () => new Set(),
      idleTimeoutMs: 5 * 60 * 1000,
      // Fire the idle timer immediately rather than waiting five real minutes.
      setTimeout: (fn) => setTimeout(fn, 0),
      clearTimeout: (t) => clearTimeout(t),
      maxAttempts: 1,
    });
    await listener.start();
    expect(listener.stats.lastReason).toBe('network');
  });

  it('keeps reading while chunks keep arriving, without tripping the idle window', async () => {
    let reads = 0;
    const listener = new CompaniesHouseStreamListener({
      apiKey: 'k',
      fetch: async () => ({
        ok: true,
        status: 200,
        body: {
          getReader: () => ({
            read: async () => {
              reads += 1;
              if (reads > 3) return { done: true, value: undefined };
              // A heartbeat proves the connection is alive even though it parses to nothing.
              return { done: false, value: encoder.encode('\n') };
            },
            cancel: async () => {},
          }),
        },
      }),
      sleep: async () => {},
      now: () => 0,
      writeState: async () => {},
      recordChange: async () => true,
      watchedCompanyNumbers: async () => new Set(),
      idleTimeoutMs: 50,
      maxAttempts: 1,
    });
    await listener.start();
    expect(listener.stats.lastReason).toBe('ended');
  });

  it('drains a rejected response\'s body before giving up on the connection', async () => {
    let cancelled = false;
    const listener = new CompaniesHouseStreamListener({
      apiKey: 'k',
      fetch: async () => ({ ok: false, status: 503, body: { cancel: async () => void (cancelled = true) } }),
      sleep: async () => {},
      now: () => 0,
      writeState: async () => {},
      recordChange: async () => true,
      watchedCompanyNumbers: async () => new Set(),
      maxAttempts: 1,
    });
    await listener.start();
    expect(cancelled).toBe(true);
  });

  it('does not choke on a rejected response with no body to cancel', async () => {
    const listener = new CompaniesHouseStreamListener({
      apiKey: 'k',
      fetch: async () => ({ ok: false, status: 500 }),
      sleep: async () => {},
      now: () => 0,
      writeState: async () => {},
      recordChange: async () => true,
      watchedCompanyNumbers: async () => new Set(),
      maxAttempts: 1,
    });
    await expect(listener.start()).resolves.toBeDefined();
  });

  it('throttles persisting the timepoint for lines outside the watch list, rather than one database write per line', async () => {
    const clock = { t: 0 };
    const { listener, state } = harness([streamResponse([event('07777777', 1), event('07777777', 2), event('07777777', 3)])], {
      now: () => clock.t,
      writeStateThrottleMs: 1000,
    });
    await listener.start();
    // All three unmatched lines land inside one throttle window (the clock
    // never advances), so only the forced flush when the read ends persists —
    // not one write per line.
    expect(state.filter((p) => p.timepoint !== undefined)).toHaveLength(1);
    expect(state.at(-1).timepoint).toBe(3);
  });

  it('still persists promptly once the throttle window has actually passed', async () => {
    // A clock that jumps forward a long way on every read, so whenever it is
    // checked the throttle window has always already elapsed — regardless
    // of exactly how many times #flushPendingState happens to call now().
    let t = 0;
    const { listener, state } = harness([streamResponse([event('07777777', 1), event('07777777', 2)])], {
      now: () => (t += 100_000),
      writeStateThrottleMs: 500,
    });
    await listener.start();
    expect(state.filter((p) => p.timepoint !== undefined).map((p) => p.timepoint)).toEqual([1, 2]);
  });

  it('always persists a matched change immediately, never throttled', async () => {
    const { listener, state } = harness([streamResponse([event('01234567', 5), event('01234567', 6)])], { now: () => 0, writeStateThrottleMs: 60_000 });
    await listener.start();
    expect(state.filter((p) => p.timepoint !== undefined).map((p) => p.timepoint)).toEqual([5, 6]);
  });

  it('stops cleanly when asked, without waiting out the backoff', async () => {
    let stopped = false;
    const { listener } = harness([streamResponse([event('01234567', 80)])], {
      maxAttempts: Infinity,
      // Stop from inside the first backoff, so the loop has to notice.
      sleep: async () => {
        if (!stopped) {
          stopped = true;
          void listener.stop();
        }
      },
    });
    await listener.start();
    expect(listener.running).toBe(false);
  });
});
