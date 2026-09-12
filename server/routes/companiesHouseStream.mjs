/**
 * What the Companies House streaming listener has seen. Read-only from the
 * browser's point of view, apart from acknowledging changes once they've
 * been pulled in.
 *
 * The listener itself never touches the practice snapshot (see
 * lib/companiesHouseStreamStore.mjs). These routes are the seam: the app
 * asks what changed, shows it, and the existing "Refresh from Companies
 * House" action — which a person triggers and which saves as a normal
 * version — is what actually updates the data.
 */
import express from 'express';
import { isDatabaseConfigured } from '../lib/db.mjs';
import { isStreamConfigured } from '../lib/companiesHouseStreamListener.mjs';
import { acknowledgeChanges, countPendingChanges, pendingChanges, readStreamState } from '../lib/companiesHouseStreamStore.mjs';
import { requireAuth } from './auth.mjs';

const router = express.Router();

/**
 * Whether the stream is usable at all. Open like the REST proxy's /status:
 * the app decides which UI to show from it before asking for anything, and
 * neither flag is a secret.
 *
 * The stream needs a database as well as a key — it has nowhere to record
 * what it saw otherwise — so the browser-only mode reports it off rather
 * than showing an integration that can't work there.
 */
router.get('/status', (_req, res) => {
  res.json({ configured: isStreamConfigured() && isDatabaseConfigured() });
});

router.use((req, res, next) => (isDatabaseConfigured() ? requireAuth(req, res, next) : res.status(503).json({ error: 'not_configured' })));

/** Recent unacknowledged changes, plus enough listener state to say whether it's actually connected. */
router.get('/changes', async (_req, res) => {
  if (!isStreamConfigured()) return res.status(503).json({ error: 'not_configured' });
  try {
    const [changes, pending, state] = await Promise.all([pendingChanges(50), countPendingChanges(), readStreamState()]);
    res.json({
      changes,
      pending,
      connectedAt: state.connectedAt,
      lastEventAt: state.lastEventAt,
      // A stored error is the honest answer to "why is nothing coming
      // through" — surfaced rather than swallowed.
      lastError: state.lastError,
    });
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', at: new Date().toISOString(), source: 'companies_house_stream', message: err?.message ?? String(err) }));
    res.status(500).json({ error: 'unknown_error' });
  }
});

/**
 * Marks changes dealt with. `companyNumbers` clears just those; an empty or
 * absent list clears everything pending, which is what "I've refreshed them
 * all" means.
 */
router.post('/changes/ack', express.json({ limit: '16kb' }), async (req, res) => {
  if (!isStreamConfigured()) return res.status(503).json({ error: 'not_configured' });
  const numbers = Array.isArray(req.body?.companyNumbers) ? req.body.companyNumbers.slice(0, 500) : null;
  try {
    const acknowledged = await acknowledgeChanges(numbers);
    res.json({ acknowledged });
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', at: new Date().toISOString(), source: 'companies_house_stream', message: err?.message ?? String(err) }));
    res.status(500).json({ error: 'unknown_error' });
  }
});

export default router;
