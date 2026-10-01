/**
 * Reads a photographed letter with Claude — the only place this server
 * calls a language model. What leaves the server: the photo, and each
 * client's name plus the non-sensitive identifiers telegramMatch.mjs
 * allow-lists. Never credentials.
 *
 * Returns null rather than throwing on anything short of a clean read
 * (refusal, truncated output, malformed JSON, an API error): the caller
 * treats every one of those the same way — the photo is kept and Ray is
 * told it couldn't be read.
 */
import Anthropic from '@anthropic-ai/sdk';

export const DEFAULT_VISION_MODEL = 'claude-opus-5-5';

export const DOCUMENT_TYPES = [
  'Corporation Tax notice to deliver',
  'Corporation Tax statement',
  'Self Assessment statement',
  'Self Assessment notice',
  'VAT notice',
  'PAYE notice',
  'Penalty notice',
  'Companies House correspondence',
  'Other HMRC letter',
  'Other',
];

// anyOf rather than a type array: it's the form structured outputs documents as supported.
const nullableString = { anyOf: [{ type: 'string' }, { type: 'null' }] };

export const EXTRACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['documentType', 'reference', 'letterDate', 'period', 'identifiers', 'clientId', 'confidence', 'rationale'],
  properties: {
    documentType: { type: 'string', enum: DOCUMENT_TYPES },
    reference: nullableString,
    letterDate: { ...nullableString, description: 'YYYY-MM-DD' },
    period: { ...nullableString, description: 'The tax period or year the letter concerns, as printed.' },
    identifiers: {
      type: 'object',
      additionalProperties: false,
      required: ['companyNumber', 'utr', 'vatNumber', 'payeReference'],
      properties: { companyNumber: nullableString, utr: nullableString, vatNumber: nullableString, payeReference: nullableString },
    },
    clientId: { ...nullableString, description: 'The id of the matching client from the roster, or null.' },
    confidence: { type: 'number', description: '0 to 1: how sure the letter is for clientId.' },
    rationale: { type: 'string', description: 'One sentence a practice accountant can check.' },
  },
};

const SYSTEM = `You read photographs of letters sent to a UK accountancy practice, usually from HMRC or Companies House, and say which of the practice's clients each letter is for.

Read exactly what is printed. Copy identifiers (company number, UTR, VAT number, PAYE reference) as they appear, and use null for anything not on the letter — never infer one from the client list. Pick clientId only from the roster you are given, using the name and identifiers on the letter; use null if none fits. Confidence reflects how sure you are about the client, and should be low when the photo is unclear or the name only loosely matches.`;

export function visionModel(env = process.env) {
  return env.TELEGRAM_VISION_MODEL || DEFAULT_VISION_MODEL;
}

let defaultClient;
function getClient() {
  defaultClient ??= new Anthropic();
  return defaultClient;
}

function log(message) {
  console.error(JSON.stringify({ level: 'error', at: new Date().toISOString(), source: 'telegram-vision', message }));
}

export async function readLetter({ bytes, mediaType, roster }, { client = getClient(), env = process.env } = {}) {
  let response;
  try {
    response = await client.beta.messages.create({
      model: visionModel(env),
      max_tokens: 16000,
      system: SYSTEM,
      output_config: { effort: 'high', format: { type: 'json_schema', schema: EXTRACTION_SCHEMA } },
      // A safety classifier can misfire on an ordinary letter; this reruns
      // the same request on a fallback model rather than failing the read.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: Buffer.from(bytes).toString('base64') } },
            { type: 'text', text: `The practice's clients:\n${JSON.stringify(roster)}\n\nWhich client is this letter for, and what does it say?` },
          ],
        },
      ],
    });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) log('Rate limited reading a letter');
    else if (err instanceof Anthropic.APIError) log(`API error ${err.status ?? ''} reading a letter: ${err.message}`);
    else log(`Could not reach the model: ${err?.message ?? err}`);
    return null;
  }

  if (response.stop_reason !== 'end_turn') {
    log(`Letter read stopped early: ${response.stop_reason}${response.stop_details?.category ? ` (${response.stop_details.category})` : ''}`);
    return null;
  }
  const text = response.content.find((block) => block.type === 'text')?.text;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    log('Letter read returned malformed JSON');
    return null;
  }
}
