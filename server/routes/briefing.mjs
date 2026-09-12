/**
 * Morning briefing by email: each signed-in user's own settings, and a
 * "send me one now" so the first one is not a wait until tomorrow.
 * Needs a database (the settings live on the user row) and answers 503
 * without one, like everything else that does.
 */
import express from 'express';
import { isDatabaseConfigured } from '../lib/db.mjs';
import { createRateLimiter } from '../lib/rateLimit.mjs';
import { requireAuth } from './auth.mjs';
import { composeBriefing, isValidEmail, localParts } from '../lib/briefing.mjs';
import { readBriefingSettings, readPracticeSnapshot, writeBriefingSettings } from '../lib/briefingStore.mjs';
import { emailProvider, MessagingError, messagingStatus } from '../lib/messaging/index.mjs';
import { sendHourFromEnv } from '../lib/briefingScheduler.mjs';

const router = express.Router();

router.use((req, res, next) => (isDatabaseConfigured() ? requireAuth(req, res, next) : res.status(503).json({ error: 'not_configured' })));
router.use(express.json({ limit: '4kb' }));

router.get('/', async (req, res) => {
  const settings = await readBriefingSettings(req.user.id);
  res.json({ ...(settings ?? { email: null, enabled: false, lastSentOn: null }), sendHour: sendHourFromEnv(), provider: messagingStatus().email });
});

router.put('/', async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
  const enabled = Boolean(req.body?.enabled);
  if (enabled && !isValidEmail(email)) return res.status(400).json({ error: 'invalid_email' });
  if (email && !isValidEmail(email)) return res.status(400).json({ error: 'invalid_email' });
  const settings = await writeBriefingSettings(req.user.id, { email: email || null, enabled });
  res.json({ ...settings, sendHour: sendHourFromEnv(), provider: messagingStatus().email });
});

/** Sends today's briefing to the caller right now, whatever the schedule says. Rate limited: it is an email. */
router.post('/send-now', createRateLimiter({ windowMs: 10 * 60 * 1000, max: 3, keyFor: (req) => req.user?.id ?? req.ip }), async (req, res) => {
  const settings = await readBriefingSettings(req.user.id);
  if (!settings?.email || !isValidEmail(settings.email)) return res.status(400).json({ error: 'email_required' });
  try {
    const provider = emailProvider();
    if (!provider.isConfigured()) return res.status(503).json({ error: 'not_configured' });
    const snapshot = (await readPracticeSnapshot()) ?? {};
    const today = localParts(new Date(), snapshot.practice?.timezone ?? 'Europe/London').date;
    const { subject, body, counts } = composeBriefing(snapshot, today, { appUrl: process.env.PUBLIC_APP_URL ?? `${req.protocol}://${req.get('host')}` });
    const result = await provider.send({ to: settings.email, subject, body });
    res.json({ sent: true, status: result.status, to: settings.email, counts });
  } catch (err) {
    if (err instanceof MessagingError) return res.status(err.status).json({ error: err.code });
    console.error(JSON.stringify({ level: 'error', at: new Date().toISOString(), source: 'briefing', message: err?.message ?? String(err) }));
    res.status(500).json({ error: 'unknown_error' });
  }
});

export default router;
