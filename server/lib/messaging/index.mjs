/**
 * Outbound messaging providers. One adapter per provider, each exposing
 * `send(message) → { providerMessageId, status }`, selected per channel
 * from the environment and defaulting to `simulated` — so development,
 * tests and a deployment with no provider configured all behave exactly
 * as the app always has: the message is logged, nothing leaves.
 *
 * Only email has a real provider (Postmark). WhatsApp is deliberately not
 * a provider: business-initiated WhatsApp messages need Meta-approved
 * templates and a verified business, so the app instead hands the drafted
 * message to the accountant's own WhatsApp (see src/integrations/
 * messaging.ts — a wa.me link) and records that it did. SMS stays simulated
 * until a sender is chosen (docs/INTEGRATIONS.md).
 */
import { simulatedProvider } from './simulated.mjs';
import { postmarkProvider } from './postmark.mjs';
import { MessagingError } from './errors.mjs';
import { isDatabaseConfigured } from '../db.mjs';

export { MessagingError };

const EMAIL_PROVIDERS = { simulated: simulatedProvider, postmark: postmarkProvider };

function namedEmailProvider() {
  const name = (process.env.MESSAGING_EMAIL_PROVIDER ?? 'simulated').trim().toLowerCase();
  const provider = EMAIL_PROVIDERS[name];
  if (!provider) throw new MessagingError(500, 'unknown_provider', `MESSAGING_EMAIL_PROVIDER=${name}`);
  return provider;
}

/**
 * A provider that really delivers mail may only run in authenticated,
 * server-backed mode — the mode where every request carries a signed-in
 * user, sends are attributed and idempotent across restarts, and the
 * security audit trail exists. Without a database the app is the original
 * browser-only build with no login at all, and there a real send would be
 * open to anyone who can reach the URL. Fail closed: refuse, never fall back
 * to simulating silently (the UI would then log a "sent" that never left).
 */
export function realSendsAllowed() {
  return isDatabaseConfigured();
}

/**
 * The email provider named by MESSAGING_EMAIL_PROVIDER, or simulated. An
 * unknown name is a configuration error, not a silent fallback, and a real
 * provider without authenticated server-backed mode is refused — see
 * realSendsAllowed().
 */
export function emailProvider() {
  const provider = namedEmailProvider();
  if (provider.name !== 'simulated' && !realSendsAllowed()) throw new MessagingError(503, 'authenticated_mode_required');
  return provider;
}

/** What each channel does right now — shown in Settings and used by the composer to word its buttons. */
export function messagingStatus() {
  let email;
  try {
    const provider = namedEmailProvider();
    if (provider.name !== 'simulated' && !realSendsAllowed()) {
      email = { provider: provider.name, configured: false, from: null, error: 'authenticated_mode_required' };
    } else {
      email = { provider: provider.name, configured: provider.isConfigured(), from: provider.isConfigured() ? provider.fromAddress() : null };
    }
  } catch (err) {
    email = { provider: 'unknown', configured: false, from: null, error: err.detail };
  }
  return {
    email,
    whatsapp: { mode: 'click_to_chat' },
    sms: { provider: 'simulated', configured: false },
  };
}
