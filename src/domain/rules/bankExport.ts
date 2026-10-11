import { accountLabel, type BankStatement, type BankTransaction } from './bankStatements';

/**
 * CSV files for the accountant to load into her own software. The app never
 * connects to Xero or QuickBooks (docs/PRODUCT_DECISIONS.md #17, #19) — the
 * export is the whole of the relationship — so these follow each product's
 * documented bank-statement import layout and nothing more.
 */

export type ExportFormat = 'xero' | 'quickbooks' | 'full';

export const EXPORT_FORMATS: { format: ExportFormat; label: string; description: string }[] = [
  { format: 'xero', label: 'Xero', description: 'Bank statement import: date, amount, description.' },
  { format: 'quickbooks', label: 'QuickBooks', description: 'Three columns: date, description, amount.' },
  { format: 'full', label: 'Everything (CSV)', description: 'Every field, including the category and account.' },
];

/** A line with the account it came from, for exports across more than one. */
export type ExportLine = BankTransaction & { account: string; period: string };

export function exportLines(statements: BankStatement[]): ExportLine[] {
  return statements
    .filter((s) => s.status === 'extracted')
    .flatMap((s) => s.transactions.map((t) => ({ ...t, account: accountLabel(s), period: `${s.periodStart ?? ''} to ${s.periodEnd ?? ''}` })))
    .sort((a, b) => a.date.localeCompare(b.date) || a.account.localeCompare(b.account) || a.lineNo - b.lineNo);
}

/** UK day-first, which both products read for a UK file. */
const ukDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** A number already formatted for a cell: never defused, since "-45.60" is a figure, not text. */
interface Figure {
  figure: string;
}
type Cell = string | Figure;
const amount = (n: number): Figure => ({ figure: n.toFixed(2) });

/**
 * One CSV cell. Quoted when it holds a comma, quote or line break. A text
 * cell that starts with = + - @ (or a tab or return) is prefixed with an
 * apostrophe, because a spreadsheet would otherwise run it as a formula —
 * and a transaction description is whatever the payer typed.
 */
export function csvCell(value: Cell): string {
  if (typeof value !== 'string') return value.figure;
  let text = value;
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const row = (cells: Cell[]) => cells.map(csvCell).join(',');

export function toCsv(lines: ExportLine[], format: ExportFormat): string {
  const rows: string[] = [];
  if (format === 'xero') {
    rows.push(row(['*Date', '*Amount', 'Payee', 'Description', 'Reference', 'Check Number']));
    for (const t of lines) rows.push(row([ukDate(t.date), amount(t.amount), '', t.description, '', '']));
  } else if (format === 'quickbooks') {
    rows.push(row(['Date', 'Description', 'Amount']));
    for (const t of lines) rows.push(row([ukDate(t.date), t.description, amount(t.amount)]));
  } else {
    rows.push(row(['Date', 'Description', 'Amount', 'Money in', 'Money out', 'Balance', 'Category', 'Category set by', 'Account', 'Statement period']));
    for (const t of lines) {
      rows.push(
        row([t.date, t.description, amount(t.amount), t.amount > 0 ? amount(t.amount) : '', t.amount < 0 ? amount(-t.amount) : '', t.balance === null ? '' : amount(t.balance), t.category, t.categorySource === 'user' ? 'Person' : 'Suggested', t.account, t.period]),
      );
    }
  }
  return `${rows.join('\r\n')}\r\n`;
}

/** A filename safe on every system, e.g. "ABC-Construction-Ltd-transactions-xero.csv". */
export function exportFileName(clientName: string, format: ExportFormat): string {
  const slug = clientName.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'client';
  return `${slug}-transactions-${format}.csv`;
}
