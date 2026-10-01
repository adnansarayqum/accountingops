import { afterEach, describe, expect, it, vi } from 'vitest';
import { answerCallback, editMessage, sendMessage } from '../telegramApi.mjs';

const env = { TELEGRAM_BOT_TOKEN: 'bot-token' };

function stubFetch(result = { message_id: 42 }, ok = true) {
  const spy = vi.fn(async () => new Response(JSON.stringify({ ok, result }), { status: ok ? 200 : 400 }));
  vi.stubGlobal('fetch', spy);
  return spy;
}
const sent = (spy, i = 0) => ({ url: spy.mock.calls[i][0], body: JSON.parse(spy.mock.calls[i][1].body) });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('telegramApi', () => {
  it('sends a plain message and returns its id', async () => {
    const spy = stubFetch();
    expect(await sendMessage(7, 'hi', { env })).toBe(42);
    expect(sent(spy)).toEqual({ url: 'https://api.telegram.org/botbot-token/sendMessage', body: { chat_id: 7, text: 'hi' } });
  });

  it('lays buttons out one per row as an inline keyboard', async () => {
    const spy = stubFetch();
    await sendMessage(7, 'Which?', { env, buttons: [{ text: 'Acme Ltd', data: 'p:a:0' }, { text: 'Someone else', data: 'p:a:x' }] });
    expect(sent(spy).body.reply_markup).toEqual({ inline_keyboard: [[{ text: 'Acme Ltd', callback_data: 'p:a:0' }], [{ text: 'Someone else', callback_data: 'p:a:x' }]] });
  });

  it('edits by numeric message id and answers callbacks', async () => {
    const spy = stubFetch(true);
    await editMessage(7, '901', 'Filed.', { env });
    await answerCallback('cb1', 'Done', { env });
    expect(sent(spy, 0)).toEqual({ url: 'https://api.telegram.org/botbot-token/editMessageText', body: { chat_id: 7, message_id: 901, text: 'Filed.' } });
    expect(sent(spy, 1)).toEqual({ url: 'https://api.telegram.org/botbot-token/answerCallbackQuery', body: { callback_query_id: 'cb1', text: 'Done' } });
  });

  it('never throws — a failed call is logged and returns null', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    stubFetch(null, false);
    expect(await sendMessage(7, 'hi', { env })).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    expect(await sendMessage(7, 'hi', { env })).toBeNull();
    await expect(answerCallback('cb', 'x', { env })).resolves.toBeUndefined();
  });
});
