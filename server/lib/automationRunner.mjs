/**
 * One pass of the automatic reminders: read the practice, plan what is due,
 * and send it — or, with `dryRun`, say what would be sent and send nothing.
 * Used by the scheduler (every ten minutes) and by the Settings page's
 * "preview" and "run now".
 *
 * Fails closed at every step: switched off, no real email provider, outside
 * working hours, nothing due — each ends the pass with a named reason, and
 * only a real provider ever sends (the simulated one would record a
 * reminder as sent that never left).
 *
 * Collaborators are injected so the whole flow is tested without a
 * database, a provider or a clock.
 */
import { planReminders, RULES } from './automation.mjs';
import { MessagingError } from './messaging/errors.mjs';

function log(level, message, extra = {}) {
  console.log(JSON.stringify({ level, at: new Date().toISOString(), source: 'automation', message, ...extra }));
}

/** Whether the provider might have delivered even though we hold no confirmation: only a clear refusal from it means it did not. */
function outcomeIsAmbiguous(err) {
  return !(err instanceof MessagingError) || err.code === 'upstream_unreachable';
}

/** The email provider, only if it really delivers. Returns { provider } or { problem }. */
export function usableProvider(getProvider) {
  let provider;
  try {
    provider = getProvider();
  } catch (err) {
    return { problem: err instanceof MessagingError ? err.code : 'provider_error' };
  }
  if (provider.name === 'simulated') return { problem: 'simulated_provider' };
  if (!provider.isConfigured()) return { problem: 'provider_not_configured' };
  return { provider };
}

/**
 * Returns { status, plan?, sent?, failed?, unknown? } where status is one of:
 * no_data, off, no_provider, outside_hours, nothing_due, preview, done.
 */
export async function runAutomation({ now = new Date(), dryRun = false, ignoreHours = false }, deps) {
  const { readSnapshot, getProvider, pendingByJob, claimReminder, completeReminder, releaseReminder, markReminderUnknown } = deps;

  const snapshot = await readSnapshot();
  if (!snapshot) return { status: 'no_data' };
  const plan = planReminders({ snapshot, now, pending: await pendingByJob() });
  if (!plan.enabled) return { status: 'off', plan };

  const usable = usableProvider(getProvider);
  if (usable.problem) return { status: 'no_provider', problem: usable.problem, plan };
  if (dryRun) return { status: 'preview', plan };
  if (!plan.workingHours && !ignoreHours) return { status: 'outside_hours', plan };
  if (plan.due.length === 0) return { status: 'nothing_due', plan };

  const { provider } = usable;
  const result = { status: 'done', plan, sent: [], failed: [], unknown: [] };
  for (const item of plan.due.slice(0, RULES.maxPerRun)) {
    const id = await claimReminder({ jobId: item.jobId, stepNo: item.stepNo, clientId: item.clientId, recipient: item.to, subject: item.subject, body: item.body, stage: item.stage, documentsRequested: item.documentsRequested });
    if (!id) continue; // that step was already taken — by an earlier pass, or another instance
    try {
      const sent = await provider.send({ to: item.to, subject: item.subject, body: item.body });
      await completeReminder(id, { providerName: provider.name, providerMessageId: sent.providerMessageId });
      result.sent.push({ id, jobId: item.jobId, clientName: item.clientName, jobName: item.jobName, stage: item.stage });
      log('info', 'Reminder sent automatically', { jobId: item.jobId, stage: item.stage, recipientDomain: item.to.split('@').pop().toLowerCase() });
    } catch (err) {
      if (outcomeIsAmbiguous(err)) {
        await markReminderUnknown(id).catch(() => {});
        result.unknown.push({ id, jobId: item.jobId, clientName: item.clientName });
        log('error', `Automatic reminder of unknown outcome for ${item.jobId}: ${err?.message ?? err}`);
      } else {
        await releaseReminder(id).catch(() => {});
        result.failed.push({ jobId: item.jobId, clientName: item.clientName, error: err?.code ?? 'failed' });
        log('error', `Automatic reminder refused for ${item.jobId}: ${err?.code ?? err?.message ?? err}`);
      }
    }
  }
  return result;
}
