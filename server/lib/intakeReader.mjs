/**
 * Reads whatever was shared into the app — photos, PDFs, plain text, in any
 * mix — with one Claude request per batch, and says which documents are in
 * it, which client each is for, and what each says.
 *
 * One request per batch, not per file, because the model has to see the
 * whole batch to tell five photos of one bank statement from five
 * different letters. It answers with `documents[]`, each naming the parts
 * (by index) that belong to it; groupParts() then checks that answer, since
 * a part left out or claimed twice must still end up somewhere exactly once.
 *
 * What leaves the server: the shared files and text, and each client's name
 * plus the non-sensitive identifiers documentMatch.mjs allow-lists. Never
 * credentials. Returns null rather than throwing on anything short of a
 * clean read; the caller keeps every file regardless.
 */
import Anthropic from '@anthropic-ai/sdk';

export const DEFAULT_INTAKE_MODEL = 'claude-opus-5-5';

/** What Claude can read directly: images as image blocks, PDFs as document blocks, text as text. */
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
export const READABLE_TYPES = [...IMAGE_TYPES, 'application/pdf', 'text/plain'];

export const DOCUMENT_TYPES = [
  'Bank statement',
  'Receipt or purchase invoice',
  'Sales invoice',
  'Payslip, P60 or P45',
  'Corporation Tax notice to deliver',
  'Corporation Tax statement',
  'Self Assessment statement',
  'Self Assessment notice',
  'VAT notice',
  'PAYE notice',
  'Penalty notice',
  'Companies House correspondence',
  'Other HMRC letter',
  'Message from the client',
  'Other',
];

// anyOf rather than a type array: it's the form structured outputs documents as supported.
const nullableString = { anyOf: [{ type: 'string' }, { type: 'null' }] };

const DOCUMENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['parts', 'documentType', 'reference', 'letterDate', 'period', 'identifiers', 'clientId', 'confidence', 'rationale', 'summary'],
  properties: {
    parts: { type: 'array', items: { type: 'integer' }, description: 'Indexes of the parts that make up this document, in page order.' },
    documentType: { type: 'string', enum: DOCUMENT_TYPES },
    reference: nullableString,
    letterDate: { ...nullableString, description: 'The date printed on the document, YYYY-MM-DD.' },
    period: { ...nullableString, description: 'The period or tax year it covers, as printed (for a bank statement, its date range).' },
    identifiers: {
      type: 'object',
      additionalProperties: false,
      required: ['companyNumber', 'utr', 'vatNumber', 'payeReference'],
      properties: { companyNumber: nullableString, utr: nullableString, vatNumber: nullableString, payeReference: nullableString },
    },
    clientId: { ...nullableString, description: 'The id of the matching client from the roster, or null.' },
    confidence: { type: 'number', description: '0 to 1: how sure this document is for clientId.' },
    rationale: { type: 'string', description: 'One sentence a practice accountant can check.' },
    summary: { type: 'string', description: 'One short line saying what this document is, for the practice to scan.' },
  },
};

export const INTAKE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['documents'],
  properties: { documents: { type: 'array', items: DOCUMENT_SCHEMA } },
};

const SYSTEM = `You read what a UK accountancy practice has been sent — by clients on WhatsApp or email, or by HMRC and Companies House — and sort it into documents for filing.

You are given numbered parts: photos, PDFs and text. Work out which parts belong together: several photos of the pages of one bank statement are one document; a letter and an unrelated receipt are two. Every part belongs to exactly one document. Text a client typed (a message, an email body) is its own document of type "Message from the client" unless it is plainly the body of a document it came with.

For each document, read exactly what is printed. Copy identifiers (company number, UTR, VAT number, PAYE reference) as they appear, and use null for anything not shown — never infer one from the client list. Pick clientId only from the roster you are given, using the names and identifiers on the document; use null if none fits. Confidence reflects how sure you are about the client, and should be low when a photo is unclear or a name only loosely matches.`;

export function intakeModel(env = process.env) {
  return env.INTAKE_MODEL || DEFAULT_INTAKE_MODEL;
}

let defaultClient;
function getClient() {
  defaultClient ??= new Anthropic();
  return defaultClient;
}

function log(message) {
  console.error(JSON.stringify({ level: 'error', at: new Date().toISOString(), source: 'intake-reader', message }));
}

/** One content block per part, each preceded by its number so the model can refer to it. */
export function partBlocks(parts) {
  const blocks = [];
  parts.forEach((part, index) => {
    blocks.push({ type: 'text', text: `Part ${index}${part.fileName ? ` (${part.fileName})` : ''}:` });
    if (part.mediaType === 'application/pdf') {
      blocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: Buffer.from(part.bytes).toString('base64') } });
    } else if (IMAGE_TYPES.includes(part.mediaType)) {
      blocks.push({ type: 'image', source: { type: 'base64', media_type: part.mediaType, data: Buffer.from(part.bytes).toString('base64') } });
    } else {
      // Typed by whoever sent it — fenced so it reads as content to file,
      // never as instructions; the output is schema-bound either way.
      blocks.push({ type: 'text', text: `<shared_text>\n${Buffer.from(part.bytes).toString('utf8')}\n</shared_text>` });
    }
  });
  return blocks;
}

/**
 * The model's grouping, made safe to act on: out-of-range or repeated part
 * indexes are dropped (first claim wins), a document left with no parts is
 * discarded, and any part nobody claimed becomes a document of its own so
 * nothing shared is ever lost.
 */
export function groupParts(documents, partCount) {
  const claimed = new Set();
  const grouped = [];
  for (const doc of Array.isArray(documents) ? documents : []) {
    const parts = [];
    for (const i of Array.isArray(doc?.parts) ? doc.parts : []) {
      if (!Number.isInteger(i) || i < 0 || i >= partCount || claimed.has(i)) continue;
      claimed.add(i);
      parts.push(i);
    }
    if (parts.length === 0) continue;
    grouped.push({ ...doc, parts });
  }
  for (let i = 0; i < partCount; i += 1) {
    if (!claimed.has(i)) grouped.push(unreadDocument([i]));
  }
  return grouped;
}

/** A document the model didn't (or couldn't) read: filed for a person to sort. */
export function unreadDocument(parts) {
  return {
    parts,
    documentType: 'Other',
    reference: null,
    letterDate: null,
    period: null,
    identifiers: { companyNumber: null, utr: null, vatNumber: null, payeReference: null },
    clientId: null,
    confidence: 0,
    rationale: 'Not read automatically — sort it in Smart Inbox.',
    summary: '',
  };
}

/**
 * parts: [{ bytes, mediaType, fileName? }]. Returns the grouped documents,
 * or null when the read failed outright (the caller then files every part
 * unread).
 */
export async function readBatch({ parts, roster }, { client = getClient(), env = process.env } = {}) {
  let response;
  try {
    response = await client.beta.messages.create({
      model: intakeModel(env),
      max_tokens: 16000,
      system: SYSTEM,
      output_config: { effort: 'high', format: { type: 'json_schema', schema: INTAKE_SCHEMA } },
      // A safety classifier can misfire on an ordinary document; this reruns
      // the same request on a fallback model rather than failing the read.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      messages: [
        {
          role: 'user',
          content: [
            ...partBlocks(parts),
            { type: 'text', text: `The practice's clients:\n${JSON.stringify(roster)}\n\nSort these ${parts.length} parts into documents, and say which client each is for and what it says.` },
          ],
        },
      ],
    });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) log('Rate limited reading a batch');
    else if (err instanceof Anthropic.APIError) log(`API error ${err.status ?? ''} reading a batch: ${err.message}`);
    else log(`Could not reach the model: ${err?.message ?? err}`);
    return null;
  }

  if (response.stop_reason !== 'end_turn') {
    log(`Batch read stopped early: ${response.stop_reason}${response.stop_details?.category ? ` (${response.stop_details.category})` : ''}`);
    return null;
  }
  const text = response.content.find((block) => block.type === 'text')?.text;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    log('Batch read returned malformed JSON');
    return null;
  }
  if (!parsed || !Array.isArray(parsed.documents)) return null;
  return groupParts(parsed.documents, parts.length);
}
