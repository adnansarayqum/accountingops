/**
 * Automatic client reminders — the browser side of server/routes/automation.mjs.
 * Off (and hidden) in the browser-only mode, where there is no server to send anything.
 */

/** One reminder the server emailed, waiting to be recorded in the practice's data. */
export interface AutoReminderActivity {
  id: string;
  jobId: string;
  clientId: string;
  recipient: string;
  subject: string | null;
  body: string;
  stage: string;
  documentsRequested: string[];
  providerName: string | null;
  providerMessageId: string | null;
  sentAt: string;
}

export interface PlannedReminder {
  jobId: string;
  clientName: string;
  jobName: string;
  dueDate: string;
  stage: string;
  to: string;
  contactName: string;
  subject: string;
  body: string;
  sender: string;
}

export interface NeedsYou {
  jobId: string;
  clientName: string;
  jobName: string;
  stage: string;
  reason: string;
}

export interface AutomationStatus {
  status: string;
  problem: string | null;
  enabled: boolean;
  workingHours: boolean;
  hours: { from: number; to: number; timezone: string | null };
  due: PlannedReminder[];
  waiting: number;
  needsYou: NeedsYou[];
  emailReady: boolean;
  emailProblem: string | null;
  unknown: number;
}

export interface RunNowResult extends Omit<AutomationStatus, 'emailReady' | 'emailProblem' | 'unknown'> {
  sent: { clientName: string; jobName: string; stage: string }[];
  failed: number;
  unknownOutcome: number;
}

async function safeJson<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function getAutomationStatus(): Promise<AutomationStatus | null> {
  try {
    const res = await fetch('/api/automation/status');
    if (!res.ok) return null;
    return await safeJson<AutomationStatus>(res);
  } catch {
    return null;
  }
}

export async function previewAutomation(): Promise<Omit<AutomationStatus, 'emailReady' | 'emailProblem' | 'unknown'> | null> {
  try {
    const res = await fetch('/api/automation/preview', { method: 'POST' });
    if (!res.ok) return null;
    return await safeJson(res);
  } catch {
    return null;
  }
}

export async function runAutomationNow(options: { ignoreHours?: boolean } = {}): Promise<RunNowResult | { error: string }> {
  try {
    const res = await fetch('/api/automation/run-now', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ignoreHours: options.ignoreHours === true }) });
    const body = await safeJson<RunNowResult & { error?: string }>(res);
    if (!res.ok || !body) return { error: body?.error ?? `http_${res.status}` };
    return body;
  } catch {
    return { error: 'unavailable' };
  }
}

export async function getAutoReminderActivity(): Promise<AutoReminderActivity[]> {
  try {
    const res = await fetch('/api/automation/activity');
    if (!res.ok) return [];
    return (await safeJson<{ activity: AutoReminderActivity[] }>(res))?.activity ?? [];
  } catch {
    return [];
  }
}

export async function acknowledgeAutoReminders(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  try {
    const res = await fetch('/api/automation/activity/ack', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) });
    if (!res.ok) return 0;
    return (await safeJson<{ applied: number }>(res))?.applied ?? 0;
  } catch {
    return 0;
  }
}
