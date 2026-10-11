import { addDays } from '../dates';

/**
 * Bank statement transactions, as the app shows and checks them. The lines
 * themselves are read by the server (server/lib/bankStatement.mjs); this is
 * everything that can be said about them without a model: whether a
 * statement adds up, whether months are missing between statements, and
 * totals by category. All of it is plain arithmetic a person can check.
 */

/**
 * The categories a line can be filed under — a small chart for a small
 * practice's clients, suggestions for the accountant's own bookkeeping and
 * never accounts of record. Must equal BANK_CATEGORIES in
 * server/lib/bankStatement.mjs; a server test keeps the two in step.
 */
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
] as const;

export type BankCategory = (typeof BANK_CATEGORIES)[number];

export interface BankTransaction {
  id: string;
  lineNo: number;
  date: string;
  description: string;
  /** Pounds; money in is positive, money out negative. */
  amount: number;
  balance: number | null;
  category: string;
  /** Whether the category is the model's suggestion or a person's correction. */
  categorySource: 'ai' | 'user';
}

export type BankStatementStatus = 'reading' | 'extracted' | 'failed';

export interface BankStatement {
  id: string;
  /** The first upload id of the document it was read from — how a client's documents find it. */
  sourceUploadId: string;
  uploadIds: string[];
  status: BankStatementStatus;
  error: string | null;
  bankName: string | null;
  accountName: string | null;
  /** The last four digits of the account number; the rest is never kept. */
  accountLast4: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  openingBalance: number | null;
  closingBalance: number | null;
  /** Lines the read could not back up and left out. */
  droppedLines: number;
  transactions: BankTransaction[];
}

/** A pence-level difference between two sums is rounding in the statement, not a missing line. */
export const BALANCE_TOLERANCE = 0.01;

const pence = (n: number) => Math.round(n * 100) / 100;

/** The account a statement belongs to, so one account's statements are checked together. */
export function accountKey(s: Pick<BankStatement, 'bankName' | 'accountLast4' | 'accountName'>): string {
  const bank = (s.bankName ?? '').trim().toLowerCase();
  return s.accountLast4 ? `${bank}|${s.accountLast4}` : `${bank}|${(s.accountName ?? '').trim().toLowerCase()}`;
}

export function accountLabel(s: Pick<BankStatement, 'bankName' | 'accountLast4' | 'accountName'>): string {
  const bank = s.bankName?.trim() || 'Bank account';
  if (s.accountLast4) return `${bank} ••••${s.accountLast4}`;
  return s.accountName?.trim() ? `${bank} (${s.accountName.trim()})` : bank;
}

export type Reconciliation =
  | { status: 'ok' }
  | { status: 'off'; difference: number }
  /** The statement didn't print an opening or closing balance, so it can't be checked. */
  | { status: 'unknown' };

/** Whether opening balance plus every line comes to the closing balance. */
export function reconcile(s: Pick<BankStatement, 'openingBalance' | 'closingBalance' | 'transactions'>): Reconciliation {
  if (s.openingBalance === null || s.closingBalance === null) return { status: 'unknown' };
  const expected = s.openingBalance + s.transactions.reduce((sum, t) => sum + t.amount, 0);
  const difference = pence(s.closingBalance - expected);
  return Math.abs(difference) <= BALANCE_TOLERANCE ? { status: 'ok' } : { status: 'off', difference };
}

export interface StatementGap {
  /** First and last day with no statement covering it. */
  from: string;
  to: string;
}

export interface StatementBreak {
  /** The earlier statement closes at `closing`, but the next one opens at `opening`. */
  before: string;
  after: string;
  closing: number;
  opening: number;
}

export interface StatementOverlap {
  first: string;
  second: string;
}

export interface AccountChecks {
  key: string;
  label: string;
  statements: number;
  from: string;
  to: string;
  gaps: StatementGap[];
  breaks: StatementBreak[];
  overlaps: StatementOverlap[];
}

export interface StatementProblem {
  statementId: string;
  label: string;
  period: string;
  droppedLines: number;
  reconciliation: Reconciliation;
}

export interface StatementChecks {
  accounts: AccountChecks[];
  /** Statements whose lines don't add up, or that had lines left out. */
  problems: StatementProblem[];
  /** Whether there is anything to report at all. */
  allClear: boolean;
}

const periodOf = (s: Pick<BankStatement, 'periodStart' | 'periodEnd'>) => `${s.periodStart ?? '?'} to ${s.periodEnd ?? '?'}`;

/**
 * The checks across a client's read statements: per account, days no
 * statement covers, statements that overlap (so lines appear twice), and a
 * statement that opens at a different balance than the last one closed at;
 * and per statement, lines that don't add up or were left out. Statements
 * still being read, or that failed, aren't checked.
 */
export function checkStatements(statements: BankStatement[]): StatementChecks {
  const read = statements.filter((s) => s.status === 'extracted' && s.periodStart && s.periodEnd);
  const byAccount = new Map<string, BankStatement[]>();
  for (const s of read) byAccount.set(accountKey(s), [...(byAccount.get(accountKey(s)) ?? []), s]);

  const accounts: AccountChecks[] = [];
  for (const [key, group] of byAccount) {
    const sorted = [...group].sort((a, b) => (a.periodStart as string).localeCompare(b.periodStart as string) || (a.periodEnd as string).localeCompare(b.periodEnd as string));
    const gaps: StatementGap[] = [];
    const breaks: StatementBreak[] = [];
    const overlaps: StatementOverlap[] = [];
    let latest = sorted[0];
    for (const s of sorted.slice(1)) {
      const dayAfter = addDays(latest.periodEnd as string, 1);
      if ((s.periodStart as string) > dayAfter) gaps.push({ from: dayAfter, to: addDays(s.periodStart as string, -1) });
      else if ((s.periodStart as string) <= (latest.periodEnd as string)) overlaps.push({ first: latest.id, second: s.id });
      else if (latest.closingBalance !== null && s.openingBalance !== null && Math.abs(pence(latest.closingBalance - s.openingBalance)) > BALANCE_TOLERANCE) {
        breaks.push({ before: latest.id, after: s.id, closing: latest.closingBalance, opening: s.openingBalance });
      }
      if ((s.periodEnd as string) > (latest.periodEnd as string)) latest = s;
    }
    accounts.push({ key, label: accountLabel(sorted[0]), statements: sorted.length, from: sorted[0].periodStart as string, to: latest.periodEnd as string, gaps, breaks, overlaps });
  }
  accounts.sort((a, b) => a.label.localeCompare(b.label));

  const problems: StatementProblem[] = [];
  for (const s of read) {
    const reconciliation = reconcile(s);
    if (reconciliation.status === 'off' || s.droppedLines > 0) problems.push({ statementId: s.id, label: accountLabel(s), period: periodOf(s), droppedLines: s.droppedLines, reconciliation });
  }

  const allClear = problems.length === 0 && accounts.every((a) => a.gaps.length === 0 && a.breaks.length === 0 && a.overlaps.length === 0);
  return { accounts, problems, allClear };
}

export interface CategoryTotal {
  category: string;
  moneyIn: number;
  moneyOut: number;
  count: number;
}

export interface TransactionSummary {
  moneyIn: number;
  /** A positive number: how much went out. */
  moneyOut: number;
  count: number;
  byCategory: CategoryTotal[];
}

/** Totals for a set of lines, and by category (largest movement first). */
export function summariseTransactions(transactions: Pick<BankTransaction, 'amount' | 'category'>[]): TransactionSummary {
  const byCategory = new Map<string, CategoryTotal>();
  let moneyIn = 0;
  let moneyOut = 0;
  for (const t of transactions) {
    const total = byCategory.get(t.category) ?? { category: t.category, moneyIn: 0, moneyOut: 0, count: 0 };
    total.count += 1;
    if (t.amount >= 0) {
      moneyIn += t.amount;
      total.moneyIn += t.amount;
    } else {
      moneyOut -= t.amount;
      total.moneyOut -= t.amount;
    }
    byCategory.set(t.category, total);
  }
  const rounded = [...byCategory.values()].map((c) => ({ ...c, moneyIn: pence(c.moneyIn), moneyOut: pence(c.moneyOut) }));
  rounded.sort((a, b) => b.moneyIn + b.moneyOut - (a.moneyIn + a.moneyOut) || a.category.localeCompare(b.category));
  return { moneyIn: pence(moneyIn), moneyOut: pence(moneyOut), count: transactions.length, byCategory: rounded };
}

/** "£1,250.50", with a leading minus for money out: "-£45.68". Always two decimal places. */
export function formatMoney(amount: number): string {
  const text = Math.abs(amount).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${amount < 0 && Number(text.replace(/,/g, '')) !== 0 ? '-' : ''}£${text}`;
}
