/**
 * Transactional email through Postmark's REST API. Needs three variables:
 * POSTMARK_SERVER_TOKEN (the server's API token — never sent to the
 * browser), MESSAGING_FROM_EMAIL (a sender signature or domain verified in
 * Postmark) and optionally MESSAGING_FROM_NAME. Postmark's own message id
 * is returned so the communication can be traced in its activity log.
 */
import { MessagingError } from './errors.mjs';
import { isDatabaseConfigured } from '../db.mjs';

const API_URL = 'https://api.postmarkapp.com/email';
const SEND_TIMEOUT_MS = 20_000;
const MESSAGE_STREAM = process.env.POSTMARK_MESSAGE_STREAM ?? 'outbound';

function fromAddress() {
  const email = process.env.MESSAGING_FROM_EMAIL?.trim();
  if (!email) return null;
  const name = process.env.MESSAGING_FROM_NAME?.trim();
  return name ? `${name} <${email}>` : email;
}

export const postmarkProvider = {
  name: 'postmark',
  isConfigured: () => Boolean(process.env.POSTMARK_SERVER_TOKEN?.trim() && fromAddress()),
  fromAddress,
  async send({ to, subject, body, replyTo }) {
    // Enforced here as well as where the provider is chosen (index.mjs), so
    // no caller — a route, the briefing scheduler, a future job — can reach
    // Postmark by holding the adapter directly.
    if (!isDatabaseConfigured()) throw new MessagingError(503, 'authenticated_mode_required');
    if (!postmarkProvider.isConfigured()) throw new MessagingError(503, 'not_configured');
    let res;
    try {
      res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'X-Postmark-Server-Token': process.env.POSTMARK_SERVER_TOKEN.trim(), 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ From: fromAddress(), To: to, Subject: subject, TextBody: body, ReplyTo: replyTo || undefined, MessageStream: MESSAGE_STREAM }),
        // Bounded so a hung provider cannot hold an idempotency claim past its lease (lib/emailClaims.mjs).
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
    } catch {
      throw new MessagingError(502, 'upstream_unreachable');
    }
    const payload = await res.json().catch(() => ({}));
    if (res.status === 401) throw new MessagingError(502, 'invalid_credentials');
    if (res.status === 422) throw new MessagingError(400, 'rejected_by_provider', payload.Message);
    if (res.status === 429) throw new MessagingError(429, 'rate_limited');
    if (!res.ok) throw new MessagingError(502, `upstream_${res.status}`);
    return { providerMessageId: payload.MessageID, status: 'sent' };
  },
};
