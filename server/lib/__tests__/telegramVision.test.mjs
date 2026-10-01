import { afterEach, describe, expect, it, vi } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { DEFAULT_VISION_MODEL, EXTRACTION_SCHEMA, readLetter } from '../telegramVision.mjs';

const extraction = {
  documentType: 'VAT notice',
  reference: 'X1',
  letterDate: '2026-09-01',
  period: null,
  identifiers: { companyNumber: null, utr: null, vatNumber: '123456789', payeReference: null },
  clientId: 'cl_khan',
  confidence: 0.9,
  rationale: 'VAT number matches.',
};

function fakeClient(respond) {
  const create = vi.fn(respond);
  return { client: { beta: { messages: { create } } }, create };
}

const reply = (overrides = {}) => async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(extraction) }], ...overrides });
const input = { bytes: Buffer.from('fake-jpeg'), mediaType: 'image/jpeg', roster: [{ id: 'cl_khan', name: 'Khan Consulting', identifiers: [] }] };

afterEach(() => vi.restoreAllMocks());

describe('readLetter', () => {
  it('sends the photo and roster with a JSON schema, refusal fallbacks, and the configured model', async () => {
    const { client, create } = fakeClient(reply());
    expect(await readLetter(input, { client, env: {} })).toEqual(extraction);

    const request = create.mock.calls[0][0];
    expect(request.model).toBe(DEFAULT_VISION_MODEL);
    expect(request.output_config).toEqual({ effort: 'high', format: { type: 'json_schema', schema: EXTRACTION_SCHEMA } });
    expect(request).toMatchObject({ betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
    const [image, text] = request.messages[0].content;
    expect(image).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: Buffer.from('fake-jpeg').toString('base64') } });
    expect(text.text).toContain('Khan Consulting');

    await readLetter(input, { client, env: { TELEGRAM_VISION_MODEL: 'claude-sonnet-5-5' } });
    expect(create.mock.calls[1][0].model).toBe('claude-sonnet-5-5');
  });

  it('returns null — never throws — when the read does not finish cleanly', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const bad of [
      reply({ stop_reason: 'refusal', stop_details: { category: 'cyber' }, content: [] }),
      reply({ stop_reason: 'max_tokens' }),
      reply({ content: [{ type: 'text', text: '{not json' }] }),
      reply({ content: [] }),
    ]) {
      expect(await readLetter(input, { client: fakeClient(bad).client, env: {} })).toBeNull();
    }
  });

  it('returns null on an API or network error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const apiError = new Anthropic.APIError(500, { error: { message: 'boom' } }, 'boom', new Headers());
    expect(await readLetter(input, { client: fakeClient(async () => { throw apiError; }).client, env: {} })).toBeNull();
    expect(await readLetter(input, { client: fakeClient(async () => { throw new TypeError('fetch failed'); }).client, env: {} })).toBeNull();
  });
});
