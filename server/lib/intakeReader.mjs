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

/** The practice's service codes (src/domain/types.ts ServiceCode) — what a deadline can be for. */
export const SERVICE_CODES = ['annual_accounts', 'corporation_tax', 'vat', 'payroll', 'self_assessment', 'confirmation_statement', 'mtd_income_tax', 'bookkeeping_review'];

// anyOf rather than a type array: it's the form structured outputs documents as supported.
const nullableString = { anyOf: [{ type: 'string' }, { type: 'null' }] };

/**
 * Facts only — never a decision. The app compares these with its own
 * records and proposes any change for the practice to approve.
 */
const FACTS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['deadline', 'service', 'periodEnd', 'penaltyAmount', 'appealBy', 'clientDetails'],
  properties: {
    deadline: { ...nullableString, description: 'The date by which the document says something must be filed or paid, YYYY-MM-DD; null if it sets none.' },
    service: { anyOf: [{ type: 'string', enum: SERVICE_CODES }, { type: 'null' }], description: 'Which filing or obligation that deadline is for.' },
    periodEnd: { ...nullableString, description: 'The end date of the accounting or tax period it concerns, YYYY-MM-DD.' },
    penaltyAmount: { anyOf: [{ type: 'number' }, { type: 'null' }], description: 'A penalty charged, in pounds, if this is a penalty notice.' },
    appealBy: { ...nullableString, description: 'The last date to appeal that penalty, YYYY-MM-DD.' },
    clientDetails: {
      type: 'object',
      additionalProperties: false,
      required: ['email', 'phone', 'address', 'yearEnd'],
      description: 'Only details the client gives about themselves in a message; null otherwise.',
      properties: {
        email: nullableString,
        phone: nullableString,
        address: nullableString,
        yearEnd: { ...nullableString, description: 'Their accounting year end, as "31 March".' },
      },
    },
  },
};

const DOCUMENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['parts', 'documentType', 'reference', 'letterDate', 'period', 'identifiers', 'clientId', 'confidence', 'rationale', 'summary', 'facts'],
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
    facts: FACTS_SCHEMA,
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

For each document, read exactly what is printed. Copy identifiers (company number, UTR, VAT number, PAYE reference) as they appear, and use null for anything not shown — never infer one from the client list. Pick clientId only from the roster you are given, using the names and identifiers on the document; use null if none fits. Confidence reflects how sure you are about the client, and should be low when a photo is unclear or a name only loosely matches.

Under facts, record only what the document states: a filing or payment deadline and what it is for, the period end, a penalty amount and the date to appeal it, and any contact details or year end a client gives for themselves in a message. Use null for anything it does not say. Do not work out a deadline from rules you know — only copy one that is printed or written.`;

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
    facts: null,
  };
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function isoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  const year = date.getUTCFullYear();
  return year >= 2000 && year <= 2100 ? value : null;
}

function text(value, max) {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed && trimmed.length <= max ? trimmed : null;
}

function yearEnd(value) {
  const match = /^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)$/i.exec(text(value, 20) ?? '');
  const month = match && MONTHS.find((m) => m.toLowerCase() === match[2].toLowerCase());
  const day = match ? Number(match[1]) : 0;
  return month && day >= 1 && day <= 31 ? `${day} ${month}` : null;
}

/** "1234 56789 0" → "1234567890"; anything not ten digits is dropped. */
function utr(value) {
  const digits = typeof value === 'string' ? value.replace(/[\s-]/g, '') : '';
  return /^\d{10}$/.test(digits) ? digits : null;
}

/** "GB 123 4567 89" → "GB123456789"; nine digits (or twelve for a branch), GB prefix optional. */
function vatNumber(value) {
  const compact = typeof value === 'string' ? value.replace(/[\s-]/g, '').toUpperCase() : '';
  const digits = compact.replace(/^GB/, '');
  return /^(\d{9}|\d{12})$/.test(digits) ? `GB${digits}` : null;
}

/**
 * What the model said, made safe to store and compare: each field is a
 * well-formed value or null — never a half-read date or a stray sentence.
 * The UTR and VAT number come from the document's identifiers. Returns
 * null when nothing useful is left.
 */
export function sanitiseFacts(facts, identifiers) {
  const raw = facts && typeof facts === 'object' ? facts : {};
  const details = raw.clientDetails && typeof raw.clientDetails === 'object' ? raw.clientDetails : {};
  const amount = typeof raw.penaltyAmount === 'number' && Number.isFinite(raw.penaltyAmount) && raw.penaltyAmount > 0 && raw.penaltyAmount < 1e7 ? Math.round(raw.penaltyAmount * 100) / 100 : null;
  const email = text(details.email, 254);
  const phone = text(details.phone, 40);
  const clean = {
    deadline: isoDate(raw.deadline),
    service: SERVICE_CODES.includes(raw.service) ? raw.service : null,
    periodEnd: isoDate(raw.periodEnd),
    penaltyAmount: amount,
    appealBy: isoDate(raw.appealBy),
    utr: utr(identifiers?.utr),
    vatNumber: vatNumber(identifiers?.vatNumber),
    email: email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null,
    phone: phone && /^\+?[\d\s()-]{6,}$/.test(phone) ? phone : null,
    address: text(details.address, 300),
    yearEnd: yearEnd(details.yearEnd),
  };
  return Object.values(clean).some((v) => v !== null) ? clean : null;
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
