import { afterEach, describe, expect, it, vi } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { BANK_CATEGORIES as APP_CATEGORIES } from '../../../src/domain/rules/bankStatements.ts';
import { BANK_CATEGORIES, DEFAULT_TRANSACTIONS_MODEL, extractStatement, sanitiseStatement, STATEMENT_SCHEMA } from '../bankStatement.mjs';

const line = (overrides = {}) => ({ date: '2026-01-05', description: 'ACME LTD  FASTER PAYMENT', amount: 1250, balance: 3250.5, category: 'Sales / income', ...overrides });
const raw = (overrides = {}) => ({
  bankName: 'Barclays',
  accountName: 'ABC CONSTRUCTION LTD',
  accountLast4: '12345678',
  periodStart: '2026-01-01',
  periodEnd: '2026-01-31',
  openingBalance: 2000.5,
  closingBalance: 3250.5,
  transactions: [line()],
  ...overrides,
});

describe('sanitiseStatement', () => {
  it('keeps well-formed lines in order, tidied, and only the last four digits of the account number', () => {
    const result = sanitiseStatement(raw({ transactions: [line(), line({ date: '2026-01-09', description: '  Staples\n  UK ', amount: -45.678, balance: null, category: 'Office costs' })] }));
    expect(result.dropped).toBe(0);
    expect(result.statement).toEqual({ bankName: 'Barclays', accountName: 'ABC CONSTRUCTION LTD', accountLast4: '5678', periodStart: '2026-01-01', periodEnd: '2026-01-31', openingBalance: 2000.5, closingBalance: 3250.5 });
    expect(result.transactions).toEqual([
      { lineNo: 0, date: '2026-01-05', description: 'ACME LTD FASTER PAYMENT', amount: 1250, balance: 3250.5, category: 'Sales / income' },
      { lineNo: 1, date: '2026-01-09', description: 'Staples UK', amount: -45.68, balance: null, category: 'Office costs' },
    ]);
  });

  it('drops and counts lines it cannot trust, and renumbers the rest', () => {
    const result = sanitiseStatement(raw({ transactions: [line({ date: '2026-02-30' }), line({ date: '05/01/2026' }), line({ description: '   ' }), line({ amount: Number.NaN }), line({ amount: '12' }), line({ amount: 1e12 }), line({ description: 'Good' })] }));
    expect(result.dropped).toBe(6);
    expect(result.transactions.map((t) => [t.lineNo, t.description])).toEqual([[0, 'Good']]);
  });

  it('files an unknown category as unsure rather than inventing one', () => {
    expect(sanitiseStatement(raw({ transactions: [line({ category: 'Crypto gains' })] })).transactions[0].category).toBe('Other / unsure');
  });

  it('works the period out from the lines when it is missing or backwards, and never stores a whole account number', () => {
    const lines = [line({ date: '2026-03-10' }), line({ date: '2026-03-02' }), line({ date: '2026-03-31' })];
    expect(sanitiseStatement(raw({ periodStart: null, periodEnd: 'soon', transactions: lines })).statement).toMatchObject({ periodStart: '2026-03-02', periodEnd: '2026-03-31' });
    expect(sanitiseStatement(raw({ periodStart: '2026-04-30', periodEnd: '2026-04-01', transactions: lines })).statement).toMatchObject({ periodStart: '2026-03-02', periodEnd: '2026-03-31' });
    expect(sanitiseStatement(raw({ accountLast4: '12' })).statement.accountLast4).toBeNull();
    expect(sanitiseStatement(raw({ accountLast4: 'sort 20-00-00 acc 1234 5678' })).statement.accountLast4).toBe('5678');
  });

  it('says so when there is nothing to keep', () => {
    expect(sanitiseStatement(raw({ transactions: [] }))).toEqual({ error: 'no_transactions' });
    expect(sanitiseStatement(raw({ transactions: [line({ amount: null })] }))).toEqual({ error: 'no_transactions' });
    expect(sanitiseStatement(undefined)).toEqual({ error: 'no_transactions' });
  });

  it('caps a runaway answer and counts what it dropped', () => {
    const result = sanitiseStatement(raw({ transactions: Array.from({ length: 5003 }, () => line()) }));
    expect(result.transactions).toHaveLength(5000);
    expect(result.dropped).toBe(3);
  });
});

describe('the schema', () => {
  it('offers the same categories the app lets a person choose from, in the same order', () => {
    expect([...APP_CATEGORIES]).toEqual(BANK_CATEGORIES);
  });

  it('offers exactly the categories the app knows, and requires every field so nothing is silently left out', () => {
    expect(STATEMENT_SCHEMA.properties.transactions.items.properties.category.enum).toEqual(BANK_CATEGORIES);
    expect(new Set(BANK_CATEGORIES).size).toBe(BANK_CATEGORIES.length);
    expect(STATEMENT_SCHEMA.required).toEqual(Object.keys(STATEMENT_SCHEMA.properties));
    expect(STATEMENT_SCHEMA.properties.transactions.items.required).toEqual(Object.keys(STATEMENT_SCHEMA.properties.transactions.items.properties));
  });
});

const parts = [
  { bytes: Buffer.from([0xff, 0xd8, 0xff]), mediaType: 'image/jpeg', fileName: 'p1.jpg' },
  { bytes: Buffer.from('%PDF-1.7'), mediaType: 'application/pdf', fileName: 'p2.pdf' },
];

function fakeClient(respond) {
  const stream = vi.fn((params) => ({ finalMessage: () => respond(params) }));
  return { client: { beta: { messages: { stream } } }, stream };
}
const reply = (body, overrides = {}) => async () => ({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify(body) }], ...overrides });

afterEach(() => vi.restoreAllMocks());

describe('extractStatement', () => {
  it('streams one Sonnet request with every page, the schema and the refusal fallbacks, and returns the sanitised statement', async () => {
    const { client, stream } = fakeClient(reply(raw()));
    const result = await extractStatement({ parts }, { client, env: {} });
    expect(result).toMatchObject({ ok: true, dropped: 0, statement: { bankName: 'Barclays', accountLast4: '5678' }, transactions: [{ description: 'ACME LTD FASTER PAYMENT' }] });

    const request = stream.mock.calls[0][0];
    expect(request.model).toBe(DEFAULT_TRANSACTIONS_MODEL);
    expect(DEFAULT_TRANSACTIONS_MODEL).toBe('claude-sonnet-5-5');
    expect(request.output_config).toEqual({ effort: 'medium', format: { type: 'json_schema', schema: STATEMENT_SCHEMA } });
    expect(request).toMatchObject({ betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
    expect(request).not.toHaveProperty('thinking');
    expect(request.max_tokens).toBeGreaterThanOrEqual(32000);
    const content = request.messages[0].content;
    expect(content.map((b) => b.type)).toEqual(['text', 'image', 'text', 'document', 'text']);
    expect(content.at(-1).text).toContain('2 parts');
  });

  it('takes the model and effort from the environment', async () => {
    const { client, stream } = fakeClient(reply(raw()));
    await extractStatement({ parts }, { client, env: { TRANSACTIONS_MODEL: 'claude-haiku-5-5', TRANSACTIONS_EFFORT: 'low' } });
    expect(stream.mock.calls[0][0]).toMatchObject({ model: 'claude-haiku-5-5', output_config: { effort: 'low' } });
  });

  it('says why a read failed, in words for the person, and never throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const apiError = new Anthropic.APIError(500, { error: { message: 'boom' } }, 'boom', new Headers());
    const cases = [
      [reply({}, { stop_reason: 'max_tokens' }), 'too_long'],
      [reply({}, { stop_reason: 'refusal', content: [] }), 'refused'],
      [async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{oops' }] }), 'unreadable'],
      [reply(raw({ transactions: [] })), 'no_transactions'],
      [
        async () => {
          throw apiError;
        },
        'failed',
      ],
      [
        async () => {
          throw new Anthropic.RateLimitError(429, {}, 'slow down', new Headers());
        },
        'failed',
      ],
    ];
    for (const [respond, error] of cases) {
      const result = await extractStatement({ parts }, { client: fakeClient(respond).client, env: {} });
      expect(result).toMatchObject({ ok: false, error, message: expect.any(String) });
    }
  });
});
