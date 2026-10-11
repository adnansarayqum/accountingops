import { describe, expect, it } from 'vitest';
import { csvCell, exportFileName, exportLines, toCsv, type ExportLine } from '../bankExport';
import type { BankStatement } from '../bankStatements';

const line = (overrides: Partial<ExportLine> = {}): ExportLine => ({ id: 'btx_1', lineNo: 0, date: '2026-01-05', description: 'ACME LTD', amount: 1250, balance: 3250.5, category: 'Sales / income', categorySource: 'ai', account: 'Barclays ••••5678', period: '2026-01-01 to 2026-01-31', ...overrides });

describe('csvCell', () => {
  it('quotes what needs it and doubles any quote inside', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('Smith, J')).toBe('"Smith, J"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
  });

  it('defuses text a spreadsheet would run as a formula, but leaves numbers alone', () => {
    for (const evil of ['=HYPERLINK("http://x")', '+1+1', '-2+3', '@SUM(A1)', '\tcmd']) expect(csvCell(evil).replace(/^"/, '')).toMatch(/^'/);
    expect(csvCell({ figure: '-45.50' })).toBe('-45.50');
    expect(csvCell('Co-op')).toBe('Co-op');
  });
});

describe('toCsv', () => {
  const lines = [line(), line({ id: 'btx_2', date: '2026-01-09', description: 'Staples, Leeds', amount: -45.6, balance: null, category: 'Office costs', categorySource: 'user' })];

  it('writes Xero’s bank statement layout: starred date and amount, day-first dates, signed amounts', () => {
    expect(toCsv(lines, 'xero')).toBe('*Date,*Amount,Payee,Description,Reference,Check Number\r\n05/01/2026,1250.00,,ACME LTD,,\r\n09/01/2026,-45.60,,"Staples, Leeds",,\r\n');
  });

  it('writes QuickBooks’ three columns', () => {
    expect(toCsv(lines, 'quickbooks')).toBe('Date,Description,Amount\r\n05/01/2026,ACME LTD,1250.00\r\n09/01/2026,"Staples, Leeds",-45.60\r\n');
  });

  it('writes everything, telling a person’s category from a suggestion', () => {
    const csv = toCsv(lines, 'full').split('\r\n');
    expect(csv[0]).toBe('Date,Description,Amount,Money in,Money out,Balance,Category,Category set by,Account,Statement period');
    expect(csv[1]).toBe('2026-01-05,ACME LTD,1250.00,1250.00,,3250.50,Sales / income,Suggested,Barclays ••••5678,2026-01-01 to 2026-01-31');
    expect(csv[2]).toBe('2026-01-09,"Staples, Leeds",-45.60,,45.60,,Office costs,Person,Barclays ••••5678,2026-01-01 to 2026-01-31');
  });

  it('writes just the header for no lines, and neutralises a hostile description in every format', () => {
    expect(toCsv([], 'quickbooks')).toBe('Date,Description,Amount\r\n');
    const evil = [line({ description: '=cmd|\' /C calc\'!A0' })];
    for (const format of ['xero', 'quickbooks', 'full'] as const) expect(toCsv(evil, format)).toContain("'=cmd");
  });
});

describe('exportLines', () => {
  const statement = (id: string, last4: string, date: string, status: BankStatement['status'] = 'extracted'): BankStatement => ({
    id,
    sourceUploadId: `inu_${id}`,
    uploadIds: [],
    status,
    error: null,
    bankName: 'Barclays',
    accountName: null,
    accountLast4: last4,
    periodStart: '2026-01-01',
    periodEnd: '2026-01-31',
    openingBalance: null,
    closingBalance: null,
    droppedLines: 0,
    transactions: [{ id: `t_${id}_b`, lineNo: 1, date, description: 'second', amount: 1, balance: null, category: 'VAT', categorySource: 'ai' }, { id: `t_${id}_a`, lineNo: 0, date, description: 'first', amount: 1, balance: null, category: 'VAT', categorySource: 'ai' }],
  });

  it('merges statements into one list by date, then account, then the order printed, skipping unread ones', () => {
    const lines = exportLines([statement('x', '9999', '2026-01-05'), statement('y', '1111', '2026-01-05'), statement('z', '2222', '2026-01-02'), statement('r', '3333', '2026-01-01', 'reading')]);
    expect(lines.map((l) => [l.date, l.account, l.description])).toEqual([
      ['2026-01-02', 'Barclays ••••2222', 'first'],
      ['2026-01-02', 'Barclays ••••2222', 'second'],
      ['2026-01-05', 'Barclays ••••1111', 'first'],
      ['2026-01-05', 'Barclays ••••1111', 'second'],
      ['2026-01-05', 'Barclays ••••9999', 'first'],
      ['2026-01-05', 'Barclays ••••9999', 'second'],
    ]);
    expect(lines[0].period).toBe('2026-01-01 to 2026-01-31');
  });
});

describe('exportFileName', () => {
  it('is safe on every system', () => {
    expect(exportFileName('ABC Construction Ltd', 'xero')).toBe('ABC-Construction-Ltd-transactions-xero.csv');
    expect(exportFileName('../../etc/passwd & Sons', 'full')).toBe('etc-passwd-Sons-transactions-full.csv');
    expect(exportFileName('???', 'quickbooks')).toBe('client-transactions-quickbooks.csv');
  });
});
