/**
 * The agent's HMRC OAuth tokens.
 *
 * HMRC authorise the *agent services account*, not this app per client:
 * one authorisation covers every client who has appointed the practice,
 * and HMRC check that appointment themselves on each call. So there is one
 * token row, not one per client.
 *
 * Access tokens are short-lived (HMRC issue four hours) and refresh tokens
 * are long-lived, so `withFreshToken` refreshes rather than sending the
 * user back through the consent screen. Nothing in here is ever returned to
 * the browser: the routes expose *whether* a connection exists and when it
 * expires, never the tokens themselves.
 */
import { ensureSchema, query } from '../db.mjs';
import { baseUrl } from './client.mjs';
import { decryptToken, encryptToken, isEncryptionConfigured } from './tokenCrypto.mjs';

const TOKEN_ID = 'agent-services-account';

/** Refresh this far before expiry, so a call in flight can't cross the boundary. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export async function readTokens() {
  await ensureSchema();
  const { rows } = await query('select access_token, refresh_token, scope, expires_at, connected_by, connected_at from hmrc_agent_tokens where id = $1', [TOKEN_ID]);
  const row = rows[0];
  if (!row) return null;
  return {
    accessToken: decryptToken(row.access_token),
    refreshToken: decryptToken(row.refresh_token),
    scope: row.scope,
    expiresAt: row.expires_at,
    connectedBy: row.connected_by,
    connectedAt: row.connected_at,
  };
}

export async function writeTokens({ accessToken, refreshToken, scope, expiresInSeconds, connectedBy }) {
  await ensureSchema();
  const expiresAt = new Date(Date.now() + Math.max(0, Number(expiresInSeconds) || 0) * 1000);
  await query(
    `insert into hmrc_agent_tokens (id, access_token, refresh_token, scope, expires_at, connected_by, updated_at)
     values ($1, $2, $3, $4, $5, $6, now())
     on conflict (id) do update set
       access_token  = excluded.access_token,
       -- HMRC do not always reissue a refresh token on refresh; keeping the
       -- existing one is what stops a refresh from silently disconnecting us.
       refresh_token = coalesce(excluded.refresh_token, hmrc_agent_tokens.refresh_token),
       scope         = coalesce(excluded.scope, hmrc_agent_tokens.scope),
       expires_at    = excluded.expires_at,
       connected_by  = coalesce(excluded.connected_by, hmrc_agent_tokens.connected_by),
       updated_at    = now()`,
    [TOKEN_ID, encryptToken(accessToken), encryptToken(refreshToken ?? null), scope ?? null, expiresAt, connectedBy ?? null],
  );
  return expiresAt;
}

export async function clearTokens() {
  await ensureSchema();
  const { rowCount } = await query('delete from hmrc_agent_tokens where id = $1', [TOKEN_ID]);
  return rowCount > 0;
}

/** Safe to show: says whether we're connected and when it lapses, never the token. */
export async function connectionStatus() {
  const tokens = await readTokens();
  if (!tokens) return { connected: false, tokenEncryption: isEncryptionConfigured() };
  return {
    connected: true,
    expiresAt: tokens.expiresAt,
    connectedAt: tokens.connectedAt,
    connectedBy: tokens.connectedBy,
    scope: tokens.scope,
    tokenEncryption: isEncryptionConfigured(),
    canRefresh: Boolean(tokens.refreshToken),
  };
}

export function isExpiring(expiresAt, now = Date.now()) {
  return new Date(expiresAt).getTime() - now <= REFRESH_MARGIN_MS;
}

/**
 * Exchanges an authorisation code, or a refresh token, for a fresh access
 * token. HMRC's token endpoint takes form-encoded credentials.
 */
export async function exchangeToken(params, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const body = new URLSearchParams({
    client_id: env.HMRC_CLIENT_ID ?? '',
    client_secret: env.HMRC_CLIENT_SECRET ?? '',
    ...params,
  });
  const res = await fetchImpl(`${baseUrl(env)}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: body.toString(),
    signal: AbortSignal.timeout(20_000),
  });
  let payload = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }
  if (!res.ok || !payload?.access_token) {
    const error = new Error(payload?.error ?? `token_exchange_failed_${res.status}`);
    error.status = res.status;
    throw error;
  }
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? null,
    scope: payload.scope ?? null,
    expiresInSeconds: payload.expires_in ?? 0,
  };
}

/**
 * Runs `use` with a valid access token, refreshing first if the stored one
 * is at or near expiry. Throws `not_connected` when nobody has linked an
 * agent account yet, and `refresh_failed` when the refresh token has been
 * revoked — both of which the UI turns into "reconnect", not a generic
 * error.
 */
export async function withFreshToken(use, { env = process.env, fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
  const tokens = await readTokens();
  if (!tokens) {
    const err = new Error('not_connected');
    err.code = 'not_connected';
    throw err;
  }
  if (!isExpiring(tokens.expiresAt, now())) return use(tokens.accessToken);

  if (!tokens.refreshToken) {
    const err = new Error('refresh_failed');
    err.code = 'refresh_failed';
    throw err;
  }
  const refreshed = await sharedRefresh(tokens.refreshToken, { env, fetchImpl });
  return use(refreshed.accessToken);
}

/**
 * There is one agent-level token, so two requests arriving near expiry
 * (two obligations calls a moment apart, say) can both see it as expiring
 * and both try to refresh at once. HMRC rotates the refresh token on use,
 * so the second exchange would otherwise fail with `invalid_grant` even
 * though the connection is fine — a spurious "please reconnect" for
 * whichever caller lost the race. Sharing one in-flight refresh promise
 * means only the first caller actually talks to HMRC; every concurrent
 * caller awaits the same result. The check and the assignment below are
 * both synchronous — no `await` between them — so this is safe under
 * concurrent async calls without any external lock.
 */
let refreshInFlight = null;

function sharedRefresh(refreshToken, { env, fetchImpl }) {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const refreshed = await exchangeToken({ grant_type: 'refresh_token', refresh_token: refreshToken }, { env, fetchImpl });
        await writeTokens(refreshed);
        return refreshed;
      } catch (cause) {
        const err = new Error('refresh_failed');
        err.code = 'refresh_failed';
        err.cause = cause;
        throw err;
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  return refreshInFlight;
}
