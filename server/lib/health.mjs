/**
 * Shared base for the /health response. Mounted identically in
 * server/index.mjs (production) and vite.config.ts's dev/preview
 * middleware — src/application/auth.ts checks `database` here before ever
 * calling /api/auth/me, so this needs to behave the same in both places or
 * that check silently falls through to a request that 503s.
 *
 * `database` says whether a database is *configured*; `databaseReachable`
 * says whether it answered just now (null when none is configured). The
 * two are kept apart on purpose: a configured-but-unreachable database
 * means "the shared practice exists but can't be read right now", which
 * the client must show as an outage — never as the browser-only mode,
 * where anything typed would be saved to one browser and lost to the team.
 */
import { isDatabaseConfigured, query } from './db.mjs';

const PING_TIMEOUT_MS = 2000;

export async function healthPayload() {
  const database = isDatabaseConfigured();
  const databaseReachable = database ? await pingDatabase() : null;
  return { status: database && !databaseReachable ? 'degraded' : 'ok', database, databaseReachable };
}

/** Never throws and never hangs: a slow or refused connection is simply "not reachable". */
async function pingDatabase() {
  let timer;
  const timedOut = new Promise((resolve) => {
    timer = setTimeout(() => resolve(false), PING_TIMEOUT_MS);
  });
  try {
    return await Promise.race([query('select 1').then(() => true, () => false), timedOut]);
  } finally {
    clearTimeout(timer);
  }
}
