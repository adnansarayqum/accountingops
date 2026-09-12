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

export { MessagingError };

const EMAIL_PROVIDERS = { simulated: simulatedProvider, postmark: postmarkProvider };

/** The email provider named by MESSAGING_EMAIL_PROVIDER, or simulated. An unknown name is a configuration error, not a silent fallback. */
export function emailProvider() {
  const name = (process.env.MESSAGING_EMAIL_PROVIDER ?? 'simulated').trim().toLowerCase();
  const provider = EMAIL_PROVIDERS[name];
  if (!provider) throw new MessagingError(500, 'unknown_provider', `MESSAGING_EMAIL_PROVIDER=${name}`);
  return provider;
}

/** What each channel does right now — shown in Settings and used by the composer to word its buttons. */
export function messagingStatus() {
  let email;
  try {
    const provider = emailProvider();
    email = { provider: provider.name, configured: provider.isConfigured(), from: provider.isConfigured() ? provider.fromAddress() : null };
  } catch (err) {
    email = { provider: 'unknown', configured: false, from: null, error: err.detail };
  }
  return {
    email,
    whatsapp: { mode: 'click_to_chat' },
    sms: { provider: 'simulated', configured: false },
  };
}
