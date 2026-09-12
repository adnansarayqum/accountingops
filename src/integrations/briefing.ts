/**
 * Morning briefing by email — the app's side of a per-user setting. Off
 * (and hidden) in the browser-only mode, where there are no accounts to
 * attach an address to.
 */

export interface BriefingSettings {
  email: string | null;
  enabled: boolean;
  lastSentOn: string | null;
  sendHour: number;
  provider: { provider: string; configured: boolean; from: string | null };
}

async function safeJson<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function getBriefingSettings(): Promise<BriefingSettings | null> {
  try {
    const res = await fetch('/api/briefing');
    if (!res.ok) return null;
    return safeJson<BriefingSettings>(res);
  } catch {
    return null;
  }
}

export async function saveBriefingSettings(input: { email: string; enabled: boolean }): Promise<BriefingSettings | { error: string }> {
  try {
    const res = await fetch('/api/briefing', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    const body = await safeJson<BriefingSettings & { error?: string }>(res);
    if (!res.ok || !body) return { error: body?.error ?? `http_${res.status}` };
    return body;
  } catch {
    return { error: 'unavailable' };
  }
}

export async function sendBriefingNow(): Promise<{ sent: true; status: string; to: string } | { sent: false; error: string }> {
  try {
    const res = await fetch('/api/briefing/send-now', { method: 'POST' });
    const body = await safeJson<{ status?: string; to?: string; error?: string }>(res);
    if (res.ok && body?.to) return { sent: true, status: body.status ?? 'sent', to: body.to };
    return { sent: false, error: body?.error ?? `http_${res.status}` };
  } catch {
    return { sent: false, error: 'unavailable' };
  }
}
