import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { buildFixtureData } from '../src/testing/fixtures';
import { todayIso } from '../src/domain/dates';

/**
 * A client's bank transactions, in a real browser: the statements and checks,
 * correcting a category, and downloading the CSV for Xero. The server is
 * mocked (signed-in mode needs a database the preview build doesn't have);
 * its real behaviour is covered by server/routes/__tests__/bank.test.mjs and
 * bankStore.db.test.mjs.
 */
const line = (id: string, date: string, description: string, amount: number, category: string) => ({ id, lineNo: 0, date, description, amount, balance: null, category, categorySource: 'ai' });
const statement = (id: string, start: string, end: string, opening: number, closing: number, transactions: ReturnType<typeof line>[]) => ({
  id,
  sourceUploadId: `inu_${id}`,
  uploadIds: [`inu_${id}`],
  status: 'extracted',
  error: null,
  bankName: 'Barclays',
  accountName: 'ABC CONSTRUCTION LTD',
  accountLast4: '5678',
  periodStart: start,
  periodEnd: end,
  openingBalance: opening,
  closingBalance: closing,
  droppedLines: 0,
  transactions,
});

test('a client’s bank transactions: statements, checks, a corrected category and an Xero export', async ({ page }) => {
  const data = buildFixtureData(todayIso());
  for (const id of ['jan', 'apr']) {
    data.documents.push({ id: `doc_${id}`, practiceId: data.practice.id, clientId: 'cl_abc', fileName: `${id}-statement.pdf`, documentType: 'Bank statement', receivedAt: new Date().toISOString(), source: 'inbox', sizeKb: 100, intakeUploadIds: [`inu_${id}`] });
  }
  const statements = [
    statement('jan', '2026-01-01', '2026-01-31', 100, 1304.4, [line('t1', '2026-01-05', 'ACME LTD FASTER PAYMENT', 1250, 'Sales / income'), line('t2', '2026-01-09', 'STAPLES, LEEDS', -45.6, 'Office costs')]),
    statement('apr', '2026-04-01', '2026-04-30', 1304.4, 1204.4, [line('t3', '2026-04-02', '=HYPERLINK("http://evil.example")', -100, 'Rent & rates')]),
  ];
  const patched: { id: string; category: string }[] = [];
  const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.route('**/health', (r) => r.fulfill(json({ ok: true, database: true, databaseReachable: true })));
  await page.route('**/api/auth/me', (r) => r.fulfill(json({ user: { id: 'u_adnan', username: 'adnan', name: 'Adnan Sarayqum', role: 'owner', mustChangePassword: false, permissions: [] } })));
  await page.route('**/api/practice-data', (r) => (r.request().method() === 'GET' ? r.fulfill(json({ data, version: 1 })) : r.fulfill(json({ version: 2 }))));
  await page.route('**/api/intake/status', (r) => r.fulfill(json({ configured: true })));
  await page.route('**/api/intake/activity', (r) => r.fulfill(json({ activity: [] })));
  await page.route('**/api/bank/statements/query', (r) => r.fulfill(json({ statements, canRead: true, categories: [] })));
  await page.route('**/api/bank/transactions/*', async (r) => {
    const id = r.request().url().split('/transactions/')[1];
    const { category } = r.request().postDataJSON() as { category: string };
    patched.push({ id, category });
    for (const s of statements) for (const t of s.transactions) if (t.id === id) Object.assign(t, { category, categorySource: 'user' });
    await r.fulfill(json({ id, category, categorySource: 'user' }));
  });

  // The client page says what was read, and links through.
  await page.goto('/clients/cl_abc');
  const card = page.getByTestId('bank-statements-card');
  await expect(card).toContainText('2 statements received · 2 read · 3 transactions');
  await card.getByTestId('bank-transactions-open').click();
  await expect(page).toHaveURL(/\/clients\/cl_abc\/transactions$/);

  // The statements, and the check that notices the missing months.
  await expect(page.getByTestId('statement-doc_jan')).toContainText('Adds up');
  await expect(page.getByTestId('statement-checks')).toContainText('Missing: nothing covers 1 Feb 2026 – 31 Mar 2026');
  await expect(page.getByTestId('tx-t2')).toContainText('-£45.60');

  // Correcting a category saves it, and it survives a reload of the data.
  await page.getByTestId('tx-category-t2').selectOption('Travel & motor');
  await expect.poll(() => patched).toEqual([{ id: 't2', category: 'Travel & motor' }]);
  await page.reload();
  await expect(page.getByTestId('tx-category-t2')).toHaveValue('Travel & motor');

  // The Xero export: Xero's layout, day-first dates, quoted commas, and a formula defused.
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-xero').click()]);
  expect(download.suggestedFilename()).toBe('ABC-Construction-Ltd-transactions-xero.csv');
  const csv = readFileSync((await download.path()) as string, 'utf8');
  expect(csv).toBe(
    ['*Date,*Amount,Payee,Description,Reference,Check Number', '05/01/2026,1250.00,,ACME LTD FASTER PAYMENT,,', '09/01/2026,-45.60,,"STAPLES, LEEDS",,', '02/04/2026,-100.00,,"\'=HYPERLINK(""http://evil.example"")",,', ''].join('\r\n'),
  );
});
