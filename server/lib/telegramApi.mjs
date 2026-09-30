/**
 * Telegram Bot API — outbound calls only. The token is read here and
 * nowhere else; routes/telegram.mjs never touches it directly, the same
 * discipline every other provider's credentials get in this codebase.
 */
const BASE = 'https://api.telegram.org';

function apiUrl(method, env = process.env) {
  return `${BASE}/bot${env.TELEGRAM_BOT_TOKEN}/${method}`;
}

/**
 * Best-effort: a failed reply is logged, never thrown. The webhook has
 * already acknowledged Telegram's update by the time this runs, so there is
 * no request left to fail — losing a reply to Ray is unfortunate, but it
 * must not turn into a retried, possibly-duplicated webhook delivery.
 */
export async function sendMessage(chatId, text, env = process.env) {
  try {
    const res = await fetch(apiUrl('sendMessage', env), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.error(JSON.stringify({ level: 'error', at: new Date().toISOString(), source: 'telegram', message: `sendMessage failed: ${res.status}` }));
    }
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', at: new Date().toISOString(), source: 'telegram', message: `sendMessage failed: ${err?.message ?? err}` }));
  }
}
