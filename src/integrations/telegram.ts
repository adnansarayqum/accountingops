/**
 * The practice's own Telegram bot connection — one link per signed-in user,
 * not per practice (unlike HMRC's single practice-wide connection).
 */

export interface TelegramStatus {
  configured: boolean;
}

export interface TelegramLinkState {
  linked: boolean;
  linkedAt: string | null;
}

export interface TelegramLinkCode {
  code: string;
  expiresAt: string;
}

async function safeJson<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function getTelegramStatus(): Promise<TelegramStatus> {
  try {
    const res = await fetch('/api/telegram/status');
    if (!res.ok) return { configured: false };
    return (await safeJson<TelegramStatus>(res)) ?? { configured: false };
  } catch {
    return { configured: false };
  }
}

export async function getTelegramLink(): Promise<TelegramLinkState> {
  try {
    const res = await fetch('/api/telegram/link');
    if (!res.ok) return { linked: false, linkedAt: null };
    return (await safeJson<TelegramLinkState>(res)) ?? { linked: false, linkedAt: null };
  } catch {
    return { linked: false, linkedAt: null };
  }
}

/** A one-time code to send the bot as `/start <code>`. Null when the server couldn't issue one. */
export async function createTelegramLinkCode(): Promise<TelegramLinkCode | null> {
  try {
    const res = await fetch('/api/telegram/link-codes', { method: 'POST' });
    if (!res.ok) return null;
    return await safeJson<TelegramLinkCode>(res);
  } catch {
    return null;
  }
}
