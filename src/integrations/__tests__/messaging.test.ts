import { afterEach, describe, expect, it, vi } from 'vitest';
import { getMessagingStatus, sendEmail, whatsAppClickToChatUrl } from '../messaging';

afterEach(() => vi.unstubAllGlobals());

describe('whatsAppClickToChatUrl', () => {
  it('builds a wa.me link with the number in international digits and the message encoded', () => {
    expect(whatsAppClickToChatUrl('07700 900123', 'Hi Dave, still waiting for your loan statement.')).toBe('https://wa.me/447700900123?text=Hi%20Dave%2C%20still%20waiting%20for%20your%20loan%20statement.');
  });

  it('is null for a number WhatsApp could not open', () => {
    expect(whatsAppClickToChatUrl('not a number', 'hi')).toBeNull();
  });
});

describe('getMessagingStatus', () => {
  it('falls back to simulated when the server cannot be asked', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect((await getMessagingStatus()).email.provider).toBe('simulated');
  });

  it('passes the server\'s answer through', async () => {
    const live = { email: { provider: 'postmark', configured: true, from: 'x@y.z' }, whatsapp: { mode: 'click_to_chat' }, sms: { provider: 'simulated', configured: false } };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(live), { status: 200 })));
    expect(await getMessagingStatus()).toEqual(live);
  });
});

describe('sendEmail', () => {
  it('posts the email with its idempotency key and returns how it was delivered', async () => {
    let sent: unknown;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        sent = JSON.parse(init!.body as string);
        return new Response(JSON.stringify({ ok: true, providerName: 'postmark', providerMessageId: 'pm-1', status: 'sent' }), { status: 200 });
      }),
    );
    const result = await sendEmail({ to: 'a@b.c', subject: 'S', body: 'B', idempotencyKey: 'send_abcdefgh' });
    expect(sent).toEqual({ channel: 'email', to: 'a@b.c', subject: 'S', body: 'B', idempotencyKey: 'send_abcdefgh' });
    expect(result).toEqual({ providerName: 'postmark', providerMessageId: 'pm-1', status: 'sent' });
  });

  it('turns the server\'s codes into messages a person can act on', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'rejected_by_provider', detail: "Invalid 'To' address." }), { status: 400 })));
    await expect(sendEmail({ to: 'a@b.c', subject: 'S', body: 'B', idempotencyKey: 'send_abcdefgh' })).rejects.toThrow("The email provider refused this message. (Invalid 'To' address.)");
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'not_authenticated' }), { status: 401 })));
    await expect(sendEmail({ to: 'a@b.c', subject: 'S', body: 'B', idempotencyKey: 'send_abcdefgh' })).rejects.toThrow('sign in again');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    await expect(sendEmail({ to: 'a@b.c', subject: 'S', body: 'B', idempotencyKey: 'send_abcdefgh' })).rejects.toThrow("Couldn't reach the server");
  });
});
