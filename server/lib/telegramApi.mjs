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
/** Returns the sent message's id (so a later reply can edit it), or null when it didn't send. */
export async function sendMessage(chatId, text, env = process.env) {
  try {
    const res = await fetch(apiUrl('sendMessage', env), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      log(`sendMessage failed: ${res.status}`);
      return null;
    }
    const body = await res.json().catch(() => null);
    return body?.result?.message_id ?? null;
  } catch (err) {
    log(`sendMessage failed: ${err?.message ?? err}`);
    return null;
  }
}

/** Larger than any phone photo of a letter; Telegram's own bot download limit is 20 MB. */
export const MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024;

/**
 * Fetches a file a user sent, by its file_id: getFile for the path, then
 * the bytes. Throws on failure — unlike a reply, there is nothing useful
 * to carry on with if the photo itself can't be fetched.
 */
export async function downloadFile(fileId, env = process.env) {
  const meta = await fetch(apiUrl('getFile', env), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_id: fileId }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = meta.ok ? await meta.json() : null;
  const filePath = body?.result?.file_path;
  if (!filePath) throw new Error(`getFile failed: ${meta.status}`);
  if (body.result.file_size > MAX_DOWNLOAD_BYTES) throw new Error('file_too_large');

  const res = await fetch(`${BASE}/file/bot${env.TELEGRAM_BOT_TOKEN}/${filePath}`, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`file download failed: ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > MAX_DOWNLOAD_BYTES) throw new Error('file_too_large');
  return { bytes, filePath };
}

function log(message) {
  console.error(JSON.stringify({ level: 'error', at: new Date().toISOString(), source: 'telegram', message }));
}
