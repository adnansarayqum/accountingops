/**
 * Documents shared into the app — the browser side of server/routes/intake.mjs.
 */

/** One document the server read from a share, waiting to be pulled into Smart Inbox. */
export interface IntakeActivity {
  id: string;
  batchId: string;
  source: string;
  uploadIds: string[];
  clientId: string | null;
  /** True when confident enough (or picked by a person) to attach to clientId at once. */
  filed: boolean;
  documentType: string;
  period: string | null;
  extractedReference: string | null;
  extractedDate: string | null;
  summary: string | null;
  confidence: number;
  rationale: string;
  fileName: string;
  sizeKb: number;
  createdAt: string;
}

async function safeJson<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function getIntakeStatus(): Promise<{ configured: boolean }> {
  try {
    const res = await fetch('/api/intake/status');
    if (!res.ok) return { configured: false };
    return (await safeJson<{ configured: boolean }>(res)) ?? { configured: false };
  } catch {
    return { configured: false };
  }
}

export async function getIntakeActivity(): Promise<IntakeActivity[]> {
  try {
    const res = await fetch('/api/intake/activity');
    if (!res.ok) return [];
    return (await safeJson<{ activity: IntakeActivity[] }>(res))?.activity ?? [];
  } catch {
    return [];
  }
}

export async function acknowledgeIntakeActivity(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  try {
    const res = await fetch('/api/intake/activity/ack', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) });
    if (!res.ok) return 0;
    return (await safeJson<{ applied: number }>(res))?.applied ?? 0;
  } catch {
    return 0;
  }
}

export function intakeUploadUrl(uploadId: string): string {
  return `/api/intake/uploads/${encodeURIComponent(uploadId)}`;
}
