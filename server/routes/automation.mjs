/**
 * Automatic client reminders — status, a preview of what would go, a manual
 * "run now", and the hand-off of what was sent into the practice's data.
 * Signed-in users only; the whole router answers 503 without a database, so
 * browser-only mode is untouched. The scheduler itself is in
 * lib/automationScheduler.mjs and starts with the server.
 *
 * Switching it on is a practice setting stored in the snapshot
 * (practice.automation.autoReminders), guarded like every other practice
 * setting; nothing here can turn it on.
 */
import express from 'express';
import { isDatabaseConfigured } from '../lib/db.mjs';
import { createRateLimiter } from '../lib/rateLimit.mjs';
import { PERMISSIONS, requirePermission } from '../lib/authorization.mjs';
import { recordSecurityEvent } from '../lib/securityAudit.mjs';
import { requireAuth } from './auth.mjs';
import { runAutomation, usableProvider } from '../lib/automationRunner.mjs';
import { automationDeps } from '../lib/automationScheduler.mjs';
import { markActivityApplied, pendingActivity, unknownReminders } from '../lib/automationStore.mjs';
import { RULES } from '../lib/automation.mjs';

const router = express.Router();

router.use((req, res, next) => (isDatabaseConfigured() ? next() : res.status(503).json({ error: 'not_configured' })));
router.use(requireAuth);
router.use(express.json({ limit: '16kb' }));

// "Run now" sends real email to clients.
const runLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 3, keyFor: (req) => req.user.id, name: 'rate_limited' });

/** What a person needs to see about one planned reminder. */
const outline = (item) => ({ jobId: item.jobId, clientName: item.clientName, jobName: item.jobName, dueDate: item.dueDate, stage: item.stage, to: item.to, contactName: item.contactName, subject: item.subject, body: item.body, sender: item.sender });

function summary(result) {
  const plan = result.plan;
  return {
    status: result.status,
    problem: result.problem ?? null,
    enabled: plan?.enabled ?? false,
    workingHours: plan?.workingHours ?? false,
    hours: { from: RULES.firstHour, to: RULES.lastHour, timezone: plan?.timezone ?? null },
    due: (plan?.due ?? []).map(outline),
    waiting: (plan?.waiting ?? []).length,
    needsYou: (plan?.needsYou ?? []).map((n) => ({ jobId: n.jobId, clientName: n.clientName, jobName: n.jobName, stage: n.stage, reason: n.reason })),
  };
}

// Where things stand, without sending anything.
router.get('/status', async (_req, res) => {
  const deps = automationDeps();
  const result = await runAutomation({ dryRun: true }, deps);
  const provider = usableProvider(deps.getProvider);
  res.json({ ...summary(result), emailReady: Boolean(provider.provider), emailProblem: provider.problem ?? null, unknown: (await unknownReminders()).length });
});

// What would be sent right now, in full — for checking before trusting it.
router.post('/preview', async (_req, res) => {
  res.json(summary(await runAutomation({ dryRun: true }, automationDeps())));
});

// Sends what is due now instead of waiting for the next pass. Practice settings are the owner's and manager's to run.
router.post('/run-now', requirePermission(PERMISSIONS.PRACTICE_CONFIGURE), runLimiter, async (req, res) => {
  const ignoreHours = req.body?.ignoreHours === true;
  const result = await runAutomation({ ignoreHours }, automationDeps());
  if (result.status === 'done') {
    await recordSecurityEvent({ req, action: 'automation.run_now', targetType: 'practice', targetId: 'prac_main', details: { sent: result.sent.length, failed: result.failed.length, unknown: result.unknown.length, ignoreHours } }).catch(() => {});
  }
  res.json({ ...summary(result), sent: (result.sent ?? []).map((s) => ({ clientName: s.clientName, jobName: s.jobName, stage: s.stage })), failed: result.failed?.length ?? 0, unknownOutcome: result.unknown?.length ?? 0 });
});

// Reminders the server sent, waiting to be recorded in the practice's data by an open tab.
router.get('/activity', async (_req, res) => {
  res.json({ activity: await pendingActivity() });
});

router.post('/activity/ack', async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.slice(0, 500) : [];
  res.json({ applied: await markActivityApplied(ids) });
});

export default router;
