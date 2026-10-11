/**
 * Reads every transaction off a bank statement — photos, a PDF, or both — and
 * suggests a category for each, with one Claude request per statement.
 *
 * This is the one place the product deliberately holds transaction data (see
 * docs/PRODUCT_DECISIONS.md #19). Two rules keep it honest:
 *  - The model reads; it does not decide what is true. Everything it returns
 *    is checked here (sanitiseStatement) before it is stored: a line with a
 *    bad date or amount is dropped and counted, never guessed at, and the
 *    statement's own opening and closing balances are kept so the app can
 *    show whether the lines add up.
 *  - A full account number is never stored — only its last four digits.
 *
 * Sonnet, not Opus: transcribing lines is mechanical and statements are long,
 * so the cheaper model is the right one (TRANSACTIONS_MODEL overrides it).
 * Streaming, because a long statement is a long answer. Returns a result
 * object and never throws; the caller keeps the files either way.
 */
import Anthropic from '@anthropic-ai/sdk';
import { isoDate, partBlocks } from './intakeReader.mjs';

export const DEFAULT_TRANSACTIONS_MODEL = 'claude-sonnet-5-5';
export const DEFAULT_TRANSACTIONS_EFFORT = 'medium';
/** Lines are about 40 tokens each: this holds a statement of well over a thousand. */
const MAX_OUTPUT_TOKENS = 64000;
const MAX_DESCRIPTION_CHARS = 200;
/** Far beyond any statement; a runaway answer is cut here rather than stored. */
const MAX_TRANSACTIONS = 5000;

/** A small chart of accounts for a small practice's clients. Mirrored in src/domain/rules/bankStatements.ts (a test keeps them equal). */
export const BANK_CATEGORIES = [
  'Sales / income',
  'Other income',
  'Refund received',
  'Cost of sales',
  'Wages & salaries',
  'Rent & rates',
  'Utilities',
  'Telephone & internet',
  'Travel & motor',
  'Office costs',
  'Insurance',
  'Professional fees',
  'Subscriptions & software',
  'Advertising & marketing',
  'Equipment & repairs',
  'Bank charges & interest',
  'Loan repayment',
  'VAT',
  'HMRC (tax & NI)',
  'Director / owner drawings',
  'Dividends',
  'Transfer between accounts',
  'Other / unsure',
];

const nullableString = { anyOf: [{ type: 'string' }, { type: 'null' }] };
const nullableNumber = { anyOf: [{ type: 'number' }, { type: 'null' }] };

export const STATEMENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['bankName', 'accountName', 'accountLast4', 'periodStart', 'periodEnd', 'openingBalance', 'closingBalance', 'transactions'],
  properties: {
    bankName: { ...nullableString, description: 'The bank, as printed.' },
    accountName: { ...nullableString, description: 'The account holder or account name, as printed.' },
    accountLast4: { ...nullableString, description: 'The last four digits of the account number only. Never copy the whole number.' },
    periodStart: { ...nullableString, description: 'First day the statement covers, YYYY-MM-DD.' },
    periodEnd: { ...nullableString, description: 'Last day the statement covers, YYYY-MM-DD.' },
    openingBalance: { ...nullableNumber, description: 'Balance at the start of the period, in pounds, as printed (negative if overdrawn).' },
    closingBalance: { ...nullableNumber, description: 'Balance at the end of the period, in pounds, as printed (negative if overdrawn).' },
    transactions: {
      type: 'array',
      description: 'Every transaction line, in the order printed.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['date', 'description', 'amount', 'balance', 'category'],
        properties: {
          date: { type: 'string', description: 'YYYY-MM-DD. If only day and month are printed, take the year from the statement period.' },
          description: { type: 'string', description: 'The description as printed, trimmed.' },
          amount: { type: 'number', description: 'In pounds. Money in is positive, money out is negative.' },
          balance: { ...nullableNumber, description: 'The running balance after this line if the statement prints one, otherwise null.' },
          category: { type: 'string', enum: BANK_CATEGORIES },
        },
      },
    },
  },
};

const SYSTEM = `You read UK bank statements for an accountancy practice and copy out every transaction exactly as printed.

You are given numbered parts: photos or pages of one statement, in order. Work through every part. Copy each transaction line as its own entry — never merge lines, skip lines, or invent lines. Leave out running totals, "balance brought forward", and headings.

Amounts: money paid in is positive and money paid out is negative, in pounds with pence. If the statement has separate paid-in and paid-out columns, use the column; if it has a single amount with CR/DR or a minus sign, follow that. Copy the opening and closing balances as printed. Use null for anything the statement doesn't show — never work a figure out or guess one.

Give each line a category from the list for a small UK business or its owner, judging only from the description (a name that is plainly a supplier, a payroll run, HMRC, a loan, and so on). When the description doesn't make the category clear, use "Other / unsure" — a wrong guess costs the accountant more than an honest one.

Copy only the last four digits of the account number.`;

export function transactionsModel(env = process.env) {
  return env.TRANSACTIONS_MODEL || DEFAULT_TRANSACTIONS_MODEL;
}

let defaultClient;
function getClient() {
  defaultClient ??= new Anthropic();
  return defaultClient;
}

function log(message) {
  console.error(JSON.stringify({ level: 'error', at: new Date().toISOString(), source: 'bank-statement', message }));
}

const trimmed = (value, max) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const money = (value) => (typeof value === 'number' && Number.isFinite(value) && Math.abs(value) < 1e9 ? Math.round(value * 100) / 100 : null);

function last4(value) {
  const digits = typeof value === 'string' ? value.replace(/\D/g, '') : '';
  return digits.length >= 4 ? digits.slice(-4) : null;
}

/**
 * The model's statement, made safe to store. Lines with a bad date, a
 * missing description or a non-finite amount are dropped and counted
 * (`dropped`) so the app can say the read was incomplete. A period the model
 * left out or got wrong is taken from the lines themselves.
 * Returns { statement, transactions, dropped }, or { error: 'no_transactions' }.
 */
export function sanitiseStatement(raw) {
  const lines = Array.isArray(raw?.transactions) ? raw.transactions.slice(0, MAX_TRANSACTIONS) : [];
  const transactions = [];
  let dropped = Array.isArray(raw?.transactions) ? Math.max(0, raw.transactions.length - MAX_TRANSACTIONS) : 0;
  for (const line of lines) {
    const date = isoDate(line?.date);
    const description = trimmed(line?.description, MAX_DESCRIPTION_CHARS);
    const amount = money(line?.amount);
    if (!date || !description || amount === null) {
      dropped += 1;
      continue;
    }
    transactions.push({
      lineNo: transactions.length,
      date,
      description,
      amount,
      balance: money(line?.balance),
      category: BANK_CATEGORIES.includes(line?.category) ? line.category : 'Other / unsure',
    });
  }
  if (transactions.length === 0) return { error: 'no_transactions' };

  const dates = transactions.map((t) => t.date).sort();
  const periodStart = isoDate(raw?.periodStart) ?? dates[0];
  const periodEnd = isoDate(raw?.periodEnd) ?? dates[dates.length - 1];
  return {
    statement: {
      bankName: trimmed(raw?.bankName, 80) || null,
      accountName: trimmed(raw?.accountName, 120) || null,
      accountLast4: last4(raw?.accountLast4),
      // A period that runs backwards is a misread; the lines themselves are the better witness.
      periodStart: periodStart <= periodEnd ? periodStart : dates[0],
      periodEnd: periodStart <= periodEnd ? periodEnd : dates[dates.length - 1],
      openingBalance: money(raw?.openingBalance),
      closingBalance: money(raw?.closingBalance),
    },
    transactions,
    dropped,
  };
}

/**
 * parts: [{ bytes, mediaType, fileName? }] — the statement's pages in order.
 * Returns { ok: true, ...sanitised } or { ok: false, error, message } where
 * `error` is one of: refused, too_long, unreadable, no_transactions, failed.
 */
export async function extractStatement({ parts }, { client = getClient(), env = process.env } = {}) {
  let message;
  try {
    // Streamed: a long statement is a long answer, and a long non-streaming
    // request would hit the SDK's timeout guard.
    const stream = client.beta.messages.stream({
      model: transactionsModel(env),
      max_tokens: MAX_OUTPUT_TOKENS,
      system: SYSTEM,
      output_config: { effort: env.TRANSACTIONS_EFFORT || DEFAULT_TRANSACTIONS_EFFORT, format: { type: 'json_schema', schema: STATEMENT_SCHEMA } },
      // A safety classifier can misfire on an ordinary statement; this reruns
      // the same request on a fallback model rather than failing the read.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      messages: [
        {
          role: 'user',
          content: [...partBlocks(parts), { type: 'text', text: `Copy out every transaction on this statement (${parts.length} ${parts.length === 1 ? 'part' : 'parts'}).` }],
        },
      ],
    });
    message = await stream.finalMessage();
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) log('Rate limited reading a statement');
    else if (err instanceof Anthropic.APIError) log(`API error ${err.status ?? ''} reading a statement: ${err.message}`);
    else log(`Could not reach the model: ${err?.message ?? err}`);
    return { ok: false, error: 'failed', message: 'The statement could not be read just now. Try again in a few minutes.' };
  }

  if (message.stop_reason === 'max_tokens') {
    log('Statement read ran out of room');
    return { ok: false, error: 'too_long', message: 'That statement is too long to read in one go.' };
  }
  if (message.stop_reason !== 'end_turn') {
    log(`Statement read stopped early: ${message.stop_reason}${message.stop_details?.category ? ` (${message.stop_details.category})` : ''}`);
    return { ok: false, error: 'refused', message: 'The statement could not be read.' };
  }
  const text = message.content.find((block) => block.type === 'text')?.text;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    log('Statement read returned malformed JSON');
    return { ok: false, error: 'unreadable', message: 'The statement could not be read.' };
  }
  const sanitised = sanitiseStatement(parsed);
  if (sanitised.error) return { ok: false, error: 'no_transactions', message: 'No transactions could be found on that document.' };
  return { ok: true, ...sanitised };
}
