/**
 * Documents shared into the app — the browser side of server/routes/intake.mjs.
 */
import type { DocumentFacts } from '../domain/types';

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
  /** What the document states, sanitised by the server; null when it said nothing usable or wasn't read. */
  facts?: DocumentFacts | null;
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

/** What the server found in one share, as the share screen shows it. */
export interface SharedDocument {
  id: string;
  fileName: string;
  uploadIds: string[];
  /** True when it will be attached to clientId as it stands. */
  filed: boolean;
  clientId: string | null;
  clientName: string | null;
  candidates: { id: string; name: string | null }[];
  documentType: string;
  summary: string | null;
  confidence: number;
  rationale: string;
}

export interface ShareResult {
  batchId: string;
  /** False when nothing could read the share (no API key, or the read failed): every part lands in Smart Inbox to sort. */
  read: boolean;
  documents: SharedDocument[];
}

export type ShareError = 'already_shared' | 'not_configured' | 'too_large' | 'unsupported' | 'failed';

export interface ShareFile {
  fileName: string;
  contentType: string;
  contentBase64: string;
}

/** Sends one share to be stored and read. The read can take a while on a long statement, so callers should show progress. */
export async function sendShare(files: ShareFile[], text: string): Promise<{ ok: true; result: ShareResult } | { ok: false; error: ShareError }> {
  try {
    const res = await fetch('/api/intake/batches', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files, text }) });
    if (res.ok) {
      const result = await safeJson<ShareResult>(res);
      return result ? { ok: true, result } : { ok: false, error: 'failed' };
    }
    const code = (await safeJson<{ error?: string }>(res))?.error;
    if (res.status === 409) return { ok: false, error: 'already_shared' };
    if (res.status === 503) return { ok: false, error: 'not_configured' };
    if (res.status === 413 || code === 'file_too_large' || code === 'batch_too_large' || code === 'too_many_files' || code === 'text_too_long') return { ok: false, error: 'too_large' };
    if (code === 'unsupported_type' || code === 'content_mismatch') return { ok: false, error: 'unsupported' };
    return { ok: false, error: 'failed' };
  } catch {
    return { ok: false, error: 'failed' };
  }
}

/** Corrects the client for one document before the practice picks it up; null leaves it to sort in Smart Inbox. */
export async function assignSharedDocument(documentId: string, clientId: string | null): Promise<boolean> {
  try {
    const res = await fetch(`/api/intake/activity/${encodeURIComponent(documentId)}/assign`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId }) });
    return res.ok;
  } catch {
    return false;
  }
}

/** "Done": let the practice's tabs pick the share up straight away rather than when its hold runs out. */
export async function releaseShare(batchId: string): Promise<void> {
  try {
    await fetch(`/api/intake/batches/${encodeURIComponent(batchId)}/release`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  } catch {
    // The hold runs out on its own; nothing is lost.
  }
}

/** A personal upload key, for the iPhone Shortcut. The key itself is only ever shown once, when made. */
export interface UploadKey {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export async function listUploadKeys(): Promise<UploadKey[] | null> {
  try {
    const res = await fetch('/api/intake/tokens');
    if (!res.ok) return null;
    return (await safeJson<{ tokens: UploadKey[] }>(res))?.tokens ?? null;
  } catch {
    return null;
  }
}

export async function createUploadKey(label: string): Promise<{ ok: true; key: UploadKey; token: string } | { ok: false; error: 'too_many' | 'failed' }> {
  try {
    const res = await fetch('/api/intake/tokens', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label }) });
    if (res.status === 409) return { ok: false, error: 'too_many' };
    const made = res.ok ? await safeJson<{ id: string; label: string; token: string }>(res) : null;
    if (!made) return { ok: false, error: 'failed' };
    return { ok: true, key: { id: made.id, label: made.label, createdAt: new Date().toISOString(), lastUsedAt: null }, token: made.token };
  } catch {
    return { ok: false, error: 'failed' };
  }
}

export async function revokeUploadKey(id: string): Promise<boolean> {
  try {
    return (await fetch(`/api/intake/tokens/${encodeURIComponent(id)}`, { method: 'DELETE' })).ok;
  } catch {
    return false;
  }
}
