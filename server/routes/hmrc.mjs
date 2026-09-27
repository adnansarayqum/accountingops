/**
 * HMRC Making Tax Digital routes.
 *
 * This is the only layer that holds HMRC credentials or OAuth tokens — the
 * browser never talks to HMRC, and never sees a token. It contributes the
 * half of the fraud prevention headers a server can know (the caller's
 * public IP and port, the vendor's own IP, product and version); the other
 * half describes the end user's device and is posted from the browser (see
 * src/integrations/hmrcDeviceData.ts), because for a "web application via
 * server" HMRC require both.
 *
 * Everything here needs a database (tokens have to live somewhere) and
 * returns 503 without one, so the browser-only mode is unaffected.
 */
import express from 'express';
import { randomUUID } from 'node:crypto';
import { isDatabaseConfigured } from '../lib/db.mjs';
import { createRateLimiter } from '../lib/rateLimit.mjs';
import { requireAuth } from './auth.mjs';
import { PERMISSIONS, requirePermission } from '../lib/authorization.mjs';
import { recordSecurityEvent } from '../lib/securityAudit.mjs';
import { baseUrl, fetchVatObligations, HmrcError, isHmrcConfigured, isSandbox } from '../lib/hmrc/client.mjs';
import { buildFraudPreventionHeaders, formatTimezone, missingHeaders } from '../lib/hmrc/fraudPreventionHeaders.mjs';
import { clearTokens, connectionStatus, exchangeToken, withFreshToken, writeTokens } from '../lib/hmrc/tokenStore.mjs';
import { isValidVrn, normaliseVrn } from '../lib/hmrc/vatObligations.mjs';

const router = express.Router();

/** Scopes this app asks for: reading obligations today, submitting returns later. */
const SCOPES = 'read:vat write:vat';

/** Short-lived one-time state values for the OAuth round trip, keyed by value. */
const pendingStates = new Map();
const STATE_TTL_MS = 10 * 60 * 1000;

function rememberState(userId) {
  const state = randomUUID();
  pendingStates.set(state, { userId, expiresAt: Date.now() + STATE_TTL_MS });
  // Opportunistic sweep — this map only ever holds a handful of entries.
  for (const [key, entry] of pendingStates) if (entry.expiresAt < Date.now()) pendingStates.delete(key);
  return state;
}

function consumeState(state) {
  const entry = pendingStates.get(state);
  if (!entry) return null;
  pendingStates.delete(state);
  return entry.expiresAt >= Date.now() ? entry : null;
}

function redirectUri(req) {
  const configured = process.env.HMRC_REDIRECT_URI;
  if (configured) return configured;
  return `${req.protocol}://${req.get('host')}/api/hmrc/callback`;
}

/**
 * The server's half of the fraud prevention headers, combined with the
 * device data the browser sent. Anything absent shows up in
 * `missingHeaders`, and the client refuses the call rather than sending a
 * set HMRC would later reject the application over.
 */
function fraudHeadersFor(req, device) {
  return buildFraudPreventionHeaders({
    device: {
      userAgent: device?.userAgent,
      deviceId: device?.deviceId,
      timezone: device?.timezoneOffsetMinutes === undefined ? device?.timezone : formatTimezone(device.timezoneOffsetMinutes),
      screens: device?.screens,
      windowSize: device?.windowSize,
    },
    // Express gives the originating address once `trust proxy` is set, which
    // server/index.mjs does for exactly this sort of reason.
    clientPublicIp: req.ip,
    clientPublicPort: req.socket?.remotePort,
    vendorPublicIp: process.env.HMRC_VENDOR_PUBLIC_IP,
    forwarded: process.env.HMRC_VENDOR_PUBLIC_IP ? [{ by: process.env.HMRC_VENDOR_PUBLIC_IP, for: req.ip }] : [],
    productName: 'Accounting Operations Hub',
    vendorVersion: { 'accounting-operations-hub': process.env.npm_package_version ?? '0.1.0' },
    licenseIds: { 'accounting-operations-hub': 'none' },
    userIds: { 'accounting-operations-hub': req.user?.id ?? 'unknown' },
    // This app's own sign-in is a single factor; HMRC want the header
    // present either way, and an empty list is the documented "none".
    multiFactor: [],
  });
}

/**
 * Open, like the other integrations' /status: the app decides which UI to
 * show from it before asking for anything, and none of it is secret. Says
 * plainly when it is pointed at the sandbox, because sandbox obligations
 * are canned scenarios, not real deadlines.
 */
router.get('/status', async (_req, res) => {
  const configured = isHmrcConfigured() && isDatabaseConfigured();
  if (!configured) return res.json({ configured: false, sandbox: isSandbox() });
  try {
    // connectedBy is an internal user id — of no use to an unauthenticated
    // caller, and no reason for this open route to hand it out.
    const { connectedBy: _connectedBy, ...status } = await connectionStatus();
    res.json({ configured: true, sandbox: isSandbox(), ...status });
  } catch {
    res.json({ configured: true, sandbox: isSandbox(), connected: false });
  }
});

router.use((req, res, next) => (isDatabaseConfigured() ? requireAuth(req, res, next) : res.status(503).json({ error: 'not_configured' })));
router.use((req, res, next) => (isHmrcConfigured() ? next() : res.status(503).json({ error: 'not_configured' })));

router.use(createRateLimiter({ windowMs: 60 * 1000, max: 30, keyFor: (req) => req.user?.id ?? req.ip }));

/**
 * Starts the consent round trip: returns the URL rather than redirecting, so the SPA controls the navigation.
 *
 * Connecting (and disconnecting, below) changes what the whole practice's HMRC
 * agent credentials do, so it is reserved for `hmrc.connect` — see
 * docs/PERMISSIONS.md. Looking things up through an existing connection is
 * ordinary work and only needs `hmrc.read`. Each is recorded in the security
 * audit log; for the two that change the connection, the record is written
 * first and the action does not go ahead if it cannot be.
 */
router.get('/connect', requirePermission(PERMISSIONS.HMRC_CONNECT), async (req, res) => {
  await recordSecurityEvent({ req, action: 'hmrc.connect_started', targetType: 'hmrc', targetId: 'agent-services-account', details: { sandbox: isSandbox() } });
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.HMRC_CLIENT_ID,
    scope: SCOPES,
    state: rememberState(req.user.id),
    redirect_uri: redirectUri(req),
  });
  res.json({ url: `${baseUrl()}/oauth/authorize?${params.toString()}`, sandbox: isSandbox() });
});

/**
 * Where HMRC send the user back. The state value proves this is the round
 * trip we started; without that check anyone could hand us a code.
 */
router.get('/callback', requirePermission(PERMISSIONS.HMRC_CONNECT), async (req, res) => {
  const { code, state, error } = req.query;
  if (error) {
    await recordSecurityEvent({ req, action: 'hmrc.connect_refused', outcome: 'failure', targetType: 'hmrc', targetId: 'agent-services-account' }).catch(() => {});
    return res.status(400).json({ error: 'consent_refused', detail: String(error).slice(0, 200) });
  }
  const remembered = consumeState(String(state ?? ''));
  // Bound to the session that started the round trip, not just to a state
  // value that exists: without this, a link crafted with an attacker's own
  // valid state and code, opened by a different signed-in practice user
  // (SameSite=Lax still sends the cookie on this top-level navigation),
  // would complete the exchange inside that other user's session.
  if (!remembered || remembered.userId !== req.user.id) return res.status(400).json({ error: 'invalid_state' });
  if (!code) return res.status(400).json({ error: 'missing_code' });

  try {
    const tokens = await exchangeToken({ grant_type: 'authorization_code', code: String(code), redirect_uri: redirectUri(req) });
    await writeTokens({ ...tokens, connectedBy: remembered.userId });
    // The connection is made either way; a failed audit write is loud, not fatal.
    await recordSecurityEvent({ req, action: 'hmrc.connected', targetType: 'hmrc', targetId: 'agent-services-account', details: { sandbox: isSandbox(), scope: tokens.scope ?? null } }).catch((auditErr) => {
      console.error(JSON.stringify({ level: 'error', at: new Date().toISOString(), source: 'security_audit', message: `Could not record hmrc.connected: ${auditErr?.message ?? auditErr}` }));
    });
    res.json({ connected: true, sandbox: isSandbox() });
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', at: new Date().toISOString(), source: 'hmrc', message: `Token exchange failed: ${err?.message ?? err}` }));
    await recordSecurityEvent({ req, action: 'hmrc.connect_failed', outcome: 'failure', targetType: 'hmrc', targetId: 'agent-services-account' }).catch(() => {});
    res.status(502).json({ error: 'token_exchange_failed' });
  }
});

router.post('/disconnect', requirePermission(PERMISSIONS.HMRC_CONNECT), async (req, res) => {
  // Recorded before the tokens go: no disconnect without a trace.
  await recordSecurityEvent({ req, action: 'hmrc.disconnected', targetType: 'hmrc', targetId: 'agent-services-account' });
  res.json({ disconnected: await clearTokens() });
});

/**
 * A client's VAT obligations, straight from HMRC. The device half of the
 * fraud prevention headers is posted with the request, which is why this is
 * a POST for what reads like a GET.
 */
router.post('/vat/:vrn/obligations', requirePermission(PERMISSIONS.HMRC_READ), express.json({ limit: '16kb' }), async (req, res) => {
  const vrn = normaliseVrn(String(req.params.vrn ?? ''));
  if (!vrn || !isValidVrn(vrn)) return res.status(400).json({ error: 'invalid_vrn' });

  const fraudHeaders = fraudHeadersFor(req, req.body?.device);
  const missing = missingHeaders(fraudHeaders);
  if (missing.length > 0) {
    // Deliberately explicit: HMRC accept an incomplete set in the sandbox
    // and refuse the application at approval time.
    return res.status(400).json({ error: 'fraud_headers_incomplete', missing });
  }

  try {
    const obligations = await withFreshToken((accessToken) =>
      fetchVatObligations(vrn, {
        accessToken,
        fraudHeaders,
        status: req.body?.status ?? 'open',
        from: req.body?.from,
        to: req.body?.to,
        testScenario: req.body?.testScenario,
      }),
    );
    res.json({ obligations, sandbox: isSandbox() });
  } catch (err) {
    if (err?.code === 'not_connected' || err?.code === 'refresh_failed') return res.status(409).json({ error: err.code });
    if (err instanceof HmrcError) return res.status(err.status >= 400 && err.status < 600 ? err.status : 502).json({ error: err.code, detail: err.detail ?? null });
    console.error(JSON.stringify({ level: 'error', at: new Date().toISOString(), source: 'hmrc', message: err?.message ?? String(err) }));
    res.status(500).json({ error: 'unknown_error' });
  }
});

export default router;
