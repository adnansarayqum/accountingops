/**
 * Client portal — the app's side.
 *
 * Two audiences share this file because they share the shapes:
 *
 *  - the practice, signed in: create a link for a job, see its links, revoke
 *    one, read what clients sent, and acknowledge activity once the store
 *    has applied it;
 *  - the public portal page, which has no session: read the one job the
 *    token unlocks, upload against it, or approve it.
 *
 * Everything degrades to "off": in the browser-only mode there is no server
 * to ask, and the practice-side functions report `configured: false` so the
 * UI hides itself rather than offering a link that cannot exist.
 */

export type PortalPurpose = 'upload' | 'approve';

export interface PortalLink {
  id: string;
  purpose: PortalPurpose;
  message: string | null;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  revokedAt: string | null;
  lastOpenedAt: string | null;
  state: 'live' | 'used' | 'revoked' | 'expired' | 'not_found';
}

export interface PortalActivity {
  id: string;
  linkId: string;
  clientId: string;
  jobId: string;
  kind: 'upload' | 'approval';
  requestItemId: string | null;
  uploadId: string | null;
  fileName: string | null;
  sizeKb: number | null;
  decision: 'approved' | 'rejected' | null;
  actorName: string | null;
  note: string | null;
  createdAt: string;
}

export interface PublicJobView {
  practiceName: string;
  clientName: string;
  jobName: string;
  periodEnd: string;
  dueDate: string;
  purpose: PortalPurpose;
  outstanding: { id: string; label: string }[];
  approvalPending: boolean;
  message: string | null;
  hasAttachment: boolean;
  expiresAt: string;
}

async function safeJson<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Turns a File into the JSON the server accepts. Base64 rather than multipart, so no new dependency and one size rule end to end. */
export async function fileToUploadBody(file: File): Promise<{ fileName: string; contentType: string; contentBase64: string }> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return { fileName: file.name, contentType: file.type || 'application/octet-stream', contentBase64: btoa(binary) };
}

// ---------------------------------------------------------------------------
// Practice side
// ---------------------------------------------------------------------------

export async function getPortalStatus(): Promise<{ configured: boolean; maxFileBytes: number }> {
  try {
    const res = await fetch('/api/portal/status');
    if (!res.ok) return { configured: false, maxFileBytes: 0 };
    return (await safeJson<{ configured: boolean; maxFileBytes: number }>(res)) ?? { configured: false, maxFileBytes: 0 };
  } catch {
    return { configured: false, maxFileBytes: 0 };
  }
}

export async function createPortalLink(input: { clientId: string; jobId: string; purpose: PortalPurpose; message?: string; expiresInDays?: number; attachment?: { fileName: string; contentType: string; contentBase64: string } }): Promise<{ id: string; url: string } | { error: string }> {
  try {
    const res = await fetch('/api/portal/links', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    const body = await safeJson<{ id: string; url: string; error?: string }>(res);
    if (!res.ok || !body?.url) return { error: body?.error ?? `http_${res.status}` };
    return { id: body.id, url: body.url };
  } catch {
    return { error: 'unavailable' };
  }
}

export async function listPortalLinks(jobId: string): Promise<PortalLink[]> {
  try {
    const res = await fetch(`/api/portal/links?jobId=${encodeURIComponent(jobId)}`);
    if (!res.ok) return [];
    return (await safeJson<{ links: PortalLink[] }>(res))?.links ?? [];
  } catch {
    return [];
  }
}

export async function revokePortalLink(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/portal/links/${encodeURIComponent(id)}/revoke`, { method: 'POST' });
    return res.ok;
  } catch {
    return false;
  }
}

export async function getPortalActivity(): Promise<PortalActivity[]> {
  try {
    const res = await fetch('/api/portal/activity');
    if (!res.ok) return [];
    return (await safeJson<{ activity: PortalActivity[] }>(res))?.activity ?? [];
  } catch {
    return [];
  }
}

export async function acknowledgePortalActivity(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  try {
    const res = await fetch('/api/portal/activity/ack', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) });
    if (!res.ok) return 0;
    return (await safeJson<{ applied: number }>(res))?.applied ?? 0;
  } catch {
    return 0;
  }
}

/** Where a portal upload can be downloaded by the signed-in practice. */
export function portalUploadUrl(uploadId: string): string {
  return `/api/portal/uploads/${encodeURIComponent(uploadId)}`;
}

// ---------------------------------------------------------------------------
// Public side
// ---------------------------------------------------------------------------

export type PublicOutcome = 'ok' | 'not_found' | 'unavailable';

export async function getPublicJob(token: string): Promise<{ outcome: PublicOutcome; view: PublicJobView | null }> {
  try {
    const res = await fetch(`/api/portal/p/${encodeURIComponent(token)}`);
    if (res.status === 404) return { outcome: 'not_found', view: null };
    if (!res.ok) return { outcome: 'unavailable', view: null };
    const view = await safeJson<PublicJobView>(res);
    return view ? { outcome: 'ok', view } : { outcome: 'unavailable', view: null };
  } catch {
    return { outcome: 'unavailable', view: null };
  }
}

export function publicAttachmentUrl(token: string): string {
  return `/api/portal/p/${encodeURIComponent(token)}/attachment`;
}

export async function uploadToPortal(token: string, file: File, requestItemId?: string): Promise<{ ok: true; fileName: string } | { ok: false; error: string }> {
  try {
    const body = await fileToUploadBody(file);
    const res = await fetch(`/api/portal/p/${encodeURIComponent(token)}/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, requestItemId }),
    });
    const parsed = await safeJson<{ ok?: boolean; fileName?: string; error?: string }>(res);
    if (res.ok && parsed?.fileName) return { ok: true, fileName: parsed.fileName };
    return { ok: false, error: parsed?.error ?? (res.status === 413 ? 'too_large' : `http_${res.status}`) };
  } catch {
    return { ok: false, error: 'unavailable' };
  }
}

export async function approveViaPortal(token: string, input: { decision: 'approved' | 'rejected'; name: string; note?: string }): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/portal/p/${encodeURIComponent(token)}/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    if (res.ok) return { ok: true };
    return { ok: false, error: (await safeJson<{ error?: string }>(res))?.error ?? `http_${res.status}` };
  } catch {
    return { ok: false, error: 'unavailable' };
  }
}

/** Plain English for the error codes the server returns, so the client sees a sentence and not a token. */
export function describePortalError(error: string): string {
  switch (error) {
    case 'too_large':
      return 'That file is too large. Please keep each file under 10 MB.';
    case 'unsupported_type':
      return 'That type of file is not accepted. PDFs, images, spreadsheets and Word documents are fine.';
    case 'too_many_files':
      return 'This link has reached its limit of files. Please contact your accountant for a new one.';
    case 'empty':
    case 'malformed':
      return 'That file could not be read. Please try again.';
    case 'name_required':
      return 'Please enter your name.';
    case 'not_found':
      return 'This link is no longer valid.';
    default:
      return 'Something went wrong. Please try again in a moment.';
  }
}
