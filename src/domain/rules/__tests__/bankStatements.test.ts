import { describe, expect, it } from 'vitest';
import { accountKey, accountLabel, BANK_CATEGORIES, checkStatements, formatMoney, reconcile, summariseTransactions, type BankStatement, type BankTransaction } from '../bankStatements';

let n = 0;
const tx = (amount: number, overrides: Partial<BankTransaction> = {}): BankTransaction => ({ id: `btx_${(n += 1)}`, lineNo: n, date: '2026-01-10', description: 'x', amount, balance: null, category: 'Other / unsure', categorySource: 'ai', ...overrides });
const statement = (id: string, periodStart: string, periodEnd: string, opening: number | null, closing: number | null, transactions: BankTransaction[] = [], overrides: Partial<BankStatement> = {}): BankStatement => ({
  id,
  sourceUploadId: `inu_${id}`,
  uploadIds: [`inu_${id}`],
  status: 'extracted',
  error: null,
  bankName: 'Barclays',
  accountName: 'ABC LTD',
  accountLast4: '5678',
  periodStart,
  periodEnd,
  openingBalance: opening,
  closingBalance: closing,
  droppedLines: 0,
  transactions,
  ...overrides,
});

describe('categories', () => {
  it('are unique, and end with the honest "unsure"', () => {
    expect(new Set(BANK_CATEGORIES).size).toBe(BANK_CATEGORIES.length);
    expect(BANK_CATEGORIES.at(-1)).toBe('Other / unsure');
  });
});

describe('accounts', () => {
  it('group by bank and last four digits, falling back to the account name', () => {
    expect(accountKey(statement('a', '2026-01-01', '2026-01-31', 0, 0))).toBe('barclays|5678');
    expect(accountKey(statement('a', '2026-01-01', '2026-01-31', 0, 0, [], { bankName: ' BARCLAYS ' }))).toBe('barclays|5678');
    expect(accountKey(statement('a', '2026-01-01', '2026-01-31', 0, 0, [], { accountLast4: null }))).toBe('barclays|abc ltd');
  });

  it('are labelled for a person', () => {
    expect(accountLabel(statement('a', '2026-01-01', '2026-01-31', 0, 0))).toBe('Barclays ••••5678');
    expect(accountLabel(statement('a', '2026-01-01', '2026-01-31', 0, 0, [], { accountLast4: null }))).toBe('Barclays (ABC LTD)');
    expect(accountLabel(statement('a', '2026-01-01', '2026-01-31', 0, 0, [], { bankName: null, accountLast4: null, accountName: null }))).toBe('Bank account');
  });
});

describe('reconcile', () => {
  it('is ok when opening plus every line comes to the closing balance, to the penny', () => {
    expect(reconcile(statement('a', '2026-01-01', '2026-01-31', 100, 1304.32, [tx(1250.1), tx(-45.78)]))).toEqual({ status: 'ok' });
    expect(reconcile(statement('a', '2026-01-01', '2026-01-31', 0.1, 0.3, [tx(0.1), tx(0.1)]))).toEqual({ status: 'ok' });
  });

  it('says by how much it is off, in the direction a person would add it', () => {
    expect(reconcile(statement('a', '2026-01-01', '2026-01-31', 100, 1400, [tx(1250), tx(-45)]))).toEqual({ status: 'off', difference: 95 });
    expect(reconcile(statement('a', '2026-01-01', '2026-01-31', 100, 1000, [tx(1250), tx(-45)]))).toEqual({ status: 'off', difference: -305 });
  });

  it('cannot say when a balance was not printed', () => {
    expect(reconcile(statement('a', '2026-01-01', '2026-01-31', null, 10, [tx(10)]))).toEqual({ status: 'unknown' });
    expect(reconcile(statement('a', '2026-01-01', '2026-01-31', 0, null, [tx(10)]))).toEqual({ status: 'unknown' });
  });
});

describe('checkStatements', () => {
  it('is all clear for statements that follow on, add up and open where the last closed', () => {
    const checks = checkStatements([
      statement('feb', '2026-02-01', '2026-02-28', 150, 100, [tx(-50)]),
      statement('jan', '2026-01-01', '2026-01-31', 100, 150, [tx(50)]),
    ]);
    expect(checks.allClear).toBe(true);
    expect(checks.accounts).toEqual([{ key: 'barclays|5678', label: 'Barclays ••••5678', statements: 2, from: '2026-01-01', to: '2026-02-28', gaps: [], breaks: [], overlaps: [] }]);
    expect(checks.problems).toEqual([]);
  });

  it('finds days no statement covers, between statements of the same account', () => {
    const checks = checkStatements([statement('jan', '2026-01-01', '2026-01-31', 0, 0), statement('apr', '2026-04-01', '2026-04-30', 0, 0), statement('feb', '2026-02-01', '2026-02-28', 0, 0)]);
    expect(checks.accounts[0].gaps).toEqual([{ from: '2026-03-01', to: '2026-03-31' }]);
    expect(checks.allClear).toBe(false);
  });

  it('keeps accounts apart: a statement for another account is not a gap in this one', () => {
    const checks = checkStatements([
      statement('jan', '2026-01-01', '2026-01-31', 0, 0),
      statement('feb', '2026-02-01', '2026-02-28', 0, 0),
      statement('other', '2026-01-01', '2026-03-31', 0, 0, [], { accountLast4: '9999' }),
    ]);
    expect(checks.accounts.map((a) => [a.label, a.gaps.length])).toEqual([['Barclays ••••5678', 0], ['Barclays ••••9999', 0]]);
  });

  it('finds a statement that opens at a different balance than the last one closed at, when they follow on', () => {
    const checks = checkStatements([statement('jan', '2026-01-01', '2026-01-31', 0, 150), statement('feb', '2026-02-01', '2026-02-28', 175.5, 175.5)]);
    expect(checks.accounts[0].breaks).toEqual([{ before: 'jan', after: 'feb', closing: 150, opening: 175.5 }]);
    // A pence of rounding is not a break.
    expect(checkStatements([statement('jan', '2026-01-01', '2026-01-31', 0, 150), statement('feb', '2026-02-01', '2026-02-28', 150.01, 150.01)]).accounts[0].breaks).toEqual([]);
  });

  it('says so when statements overlap, since lines then appear twice, and does not call it a gap or a break', () => {
    const checks = checkStatements([statement('a', '2026-01-01', '2026-01-31', 0, 100), statement('b', '2026-01-20', '2026-02-20', 5, 5), statement('c', '2026-02-21', '2026-03-10', 5, 5)]);
    expect(checks.accounts[0]).toMatchObject({ overlaps: [{ first: 'a', second: 'b' }], gaps: [], breaks: [], to: '2026-03-10' });
  });

  it('flags statements whose lines do not add up or that had lines left out, naming the period', () => {
    const checks = checkStatements([
      statement('ok', '2026-01-01', '2026-01-31', 0, 50, [tx(50)]),
      statement('off', '2026-02-01', '2026-02-28', 50, 500, [tx(50)]),
      statement('dropped', '2026-03-01', '2026-03-31', 100, 100, [], { droppedLines: 3 }),
    ]);
    expect(checks.problems).toEqual([
      { statementId: 'off', label: 'Barclays ••••5678', period: '2026-02-01 to 2026-02-28', droppedLines: 0, reconciliation: { status: 'off', difference: 400 } },
      { statementId: 'dropped', label: 'Barclays ••••5678', period: '2026-03-01 to 2026-03-31', droppedLines: 3, reconciliation: { status: 'ok' } },
    ]);
  });

  it('leaves out statements still being read, failed ones, and ones with no period', () => {
    const checks = checkStatements([statement('a', '2026-01-01', '2026-01-31', 0, 0), statement('b', '2026-05-01', '2026-05-31', 0, 0, [], { status: 'reading' }), statement('c', '2026-07-01', '2026-07-31', 0, 0, [], { status: 'failed' }), statement('d', '2026-09-01', '2026-09-30', 0, 0, [], { periodStart: null })]);
    expect(checks.accounts[0]).toMatchObject({ statements: 1, gaps: [] });
    expect(checkStatements([])).toEqual({ accounts: [], problems: [], allClear: true });
  });
});

describe('summariseTransactions', () => {
  it('totals money in and out, and by category with the largest movement first', () => {
    const summary = summariseTransactions([tx(1000, { category: 'Sales / income' }), tx(250.5, { category: 'Sales / income' }), tx(-45.1, { category: 'Office costs' }), tx(-45.2, { category: 'Office costs' }), tx(-400, { category: 'Rent & rates' }), tx(0.1, { category: 'Other / unsure' })]);
    expect(summary).toEqual({
      moneyIn: 1250.6,
      moneyOut: 490.3,
      count: 6,
      byCategory: [
        { category: 'Sales / income', moneyIn: 1250.5, moneyOut: 0, count: 2 },
        { category: 'Rent & rates', moneyIn: 0, moneyOut: 400, count: 1 },
        { category: 'Office costs', moneyIn: 0, moneyOut: 90.3, count: 2 },
        { category: 'Other / unsure', moneyIn: 0.1, moneyOut: 0, count: 1 },
      ],
    });
    expect(summariseTransactions([])).toEqual({ moneyIn: 0, moneyOut: 0, count: 0, byCategory: [] });
  });
});

describe('formatMoney', () => {
  it('always shows pence, with thousands separators, and a minus for money out', () => {
    expect(formatMoney(1250.5)).toBe('£1,250.50');
    expect(formatMoney(-45.68)).toBe('-£45.68');
    expect(formatMoney(0)).toBe('£0.00');
    expect(formatMoney(-0.001)).toBe('£0.00');
    expect(formatMoney(1234567.891)).toBe('£1,234,567.89');
  });
});
