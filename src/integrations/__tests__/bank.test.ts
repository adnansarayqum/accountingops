import { afterEach, describe, expect, it, vi } from 'vitest';
import { getBankStatements, requestStatementRead, setTransactionCategory } from '../bank';

function respond(status: number, body: unknown) {
  const spy = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', spy);
  return spy;
}
const offline = () => vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('offline'))));

afterEach(() => vi.unstubAllGlobals());

describe('getBankStatements', () => {
  it('asks for the statements of the documents given', async () => {
    const spy = respond(200, { statements: [{ id: 'bst_1' }], canRead: true, categories: [] });
    expect(await getBankStatements(['inu_a', 'inu_b'])).toEqual({ statements: [{ id: 'bst_1' }], canRead: true });
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/bank/statements/query');
    expect(JSON.parse(String(init.body))).toEqual({ uploadIds: ['inu_a', 'inu_b'] });
  });

  it('asks nothing for no documents, and answers null when there is no server or it fails', async () => {
    const spy = respond(200, {});
    expect(await getBankStatements([])).toEqual({ statements: [], canRead: false });
    expect(spy).not.toHaveBeenCalled();
    respond(503, { error: 'not_configured' });
    expect(await getBankStatements(['inu_a'])).toBeNull();
    respond(401, {});
    expect(await getBankStatements(['inu_a'])).toBeNull();
    offline();
    expect(await getBankStatements(['inu_a'])).toBeNull();
  });
});

describe('requestStatementRead', () => {
  it('starts a read of a document’s pages and says what became of it', async () => {
    const spy = respond(202, { status: 'reading' });
    expect(await requestStatementRead(['inu_a', 'inu_b'])).toEqual({ ok: true, status: 'reading' });
    expect(JSON.parse(String((spy.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toEqual({ uploadIds: ['inu_a', 'inu_b'] });
    respond(200, { status: 'extracted' });
    expect(await requestStatementRead(['inu_a'])).toEqual({ ok: true, status: 'extracted' });
  });

  it('turns each refusal into something the page can explain', async () => {
    for (const [status, error] of [[503, 'not_configured'], [429, 'rate_limited'], [404, 'not_found'], [500, 'failed']] as const) {
      respond(status, {});
      expect(await requestStatementRead(['inu_a'])).toEqual({ ok: false, error });
    }
    offline();
    expect(await requestStatementRead(['inu_a'])).toEqual({ ok: false, error: 'failed' });
  });
});

describe('setTransactionCategory', () => {
  it('saves a category by transaction id', async () => {
    const spy = respond(200, { id: 'btx_1' });
    expect(await setTransactionCategory('btx_1/../x', 'VAT')).toBe(true);
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/bank/transactions/btx_1%2F..%2Fx');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toEqual({ category: 'VAT' });
    respond(404, {});
    expect(await setTransactionCategory('btx_9', 'VAT')).toBe(false);
    offline();
    expect(await setTransactionCategory('btx_9', 'VAT')).toBe(false);
  });
});
