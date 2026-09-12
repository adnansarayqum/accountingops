/**
 * Messaging — the client side. Email goes through this app's own
 * /api/messages/send (the provider credential lives only on the server).
 * WhatsApp is handed to the accountant's own WhatsApp via a wa.me link with
 * the drafted message filled in: business-initiated WhatsApp messages need
 * Meta-approved templates and a verified business, and for three people
 * sending a few dozen reminders that machinery isn't worth it. SMS is
 * simulated until a sender is chosen — see docs/INTEGRATIONS.md.
 */
import { toUkE164Digits } from '../domain/phone';

export interface MessagingStatus {
  email: { provider: string; configured: boolean; from: string | null };
  whatsapp: { mode: 'click_to_chat' };
  sms: { provider: string; configured: boolean };
}

const SIMULATED_STATUS: MessagingStatus = { email: { provider: 'simulated', configured: true, from: null }, whatsapp: { mode: 'click_to_chat' }, sms: { provider: 'simulated', configured: false } };

export async function getMessagingStatus(): Promise<MessagingStatus> {
  try {
    const res = await fetch('/api/messages/status');
    if (!res.ok) return SIMULATED_STATUS;
    return ((await res.json()) as MessagingStatus | null) ?? SIMULATED_STATUS;
  } catch {
    return SIMULATED_STATUS;
  }
}

export type DeliveryStatus = 'sent' | 'simulated' | 'handed_off';

export interface EmailSendResult {
  providerName: string;
  providerMessageId?: string;
  status: DeliveryStatus;
}

const SEND_ERRORS: Record<string, string> = {
  invalid_recipient: "That doesn't look like an email address.",
  invalid_subject: 'Add a subject line.',
  invalid_body: 'Add a message.',
  not_configured: 'Email sending is not set up on the server.',
  invalid_credentials: "The server's email credentials were rejected — check POSTMARK_SERVER_TOKEN.",
  rejected_by_provider: 'The email provider refused this message.',
  rate_limited: 'Too many messages in a short time — wait a minute and try again.',
  upstream_unreachable: "Couldn't reach the email provider. Try again in a moment.",
  not_authenticated: 'Your session has expired — sign in again.',
};

/** Sends one email through the server. Resolves with how it was delivered; throws with a message fit for a toast. */
export async function sendEmail(input: { to: string; subject: string; body: string; replyTo?: string; idempotencyKey: string }): Promise<EmailSendResult> {
  let res: Response;
  try {
    res = await fetch('/api/messages/send', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: 'email', ...input }),
    });
  } catch {
    throw new Error("Couldn't reach the server to send the email.");
  }
  const payload = (await res.json().catch(() => ({}))) as { error?: string; detail?: string; providerName?: string; providerMessageId?: string; status?: DeliveryStatus };
  if (!res.ok) {
    const base = SEND_ERRORS[payload.error ?? ''] ?? "Couldn't send the email.";
    throw new Error(payload.detail ? `${base} (${payload.detail})` : base);
  }
  return { providerName: payload.providerName ?? 'unknown', providerMessageId: payload.providerMessageId, status: payload.status ?? 'sent' };
}

/** A link that opens WhatsApp (app or web) on `phone` with `text` ready to send; null when the number isn't usable. */
export function whatsAppClickToChatUrl(phone: string, text: string): string | null {
  const digits = toUkE164Digits(phone);
  if (!digits) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}
