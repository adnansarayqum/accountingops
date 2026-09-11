import { expect, test } from '@playwright/test';
import * as XLSX from 'xlsx';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** Build a small synthetic roster file on disk for the upload input to reference. */
function buildRosterFile(): string {
  const rows = [
    { Name: 'Harbourline Consulting Ltd', 'Company no': '10101010', 'UTR number': '9988776655', 'Auth code': 'HBL321', 'Next accounts': new Date(2026, 5, 30), Due: new Date(2027, 2, 31), 'Date for CS': new Date(2026, 10, 1) },
    { Name: 'No Dates Trading Ltd', 'Company no': '20202020' },
    { 'Company no': '30303030' }, // missing name — should be skipped with a warning
  ];
  const sheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Sheet1');
  const dir = mkdtempSync(path.join(tmpdir(), 'roster-'));
  const file = path.join(dir, 'roster.xlsx');
  writeFileSync(file, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
  return file;
}

test.describe('import clients', () => {
  test.beforeEach(async ({ page }) => {
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Practice Today' })).toBeVisible();
  });

  test('parses a roster, previews it, and creates clients on confirm', async ({ page }) => {
    const file = buildRosterFile();
    await page.goto('/clients/import');
    await page.setInputFiles('input[type="file"]', file);

    await expect(page.getByText('2 clients ready to import')).toBeVisible();
    await expect(page.getByText('1 row skipped')).toBeVisible();
    await expect(page.getByText('Harbourline Consulting Ltd')).toBeVisible();
    await expect(page.getByText('No Dates Trading Ltd')).toBeVisible();

    await page.getByTestId('confirm-import').click();
    await expect(page).toHaveURL(/\/clients$/);
    await expect(page.getByText('2 clients ·')).toBeVisible();

    await page.getByRole('link', { name: 'Harbourline Consulting Ltd' }).first().click();
    await expect(page.getByRole('heading', { name: 'Harbourline Consulting Ltd' })).toBeVisible();
    await expect(page.getByText('UTR')).toBeVisible();
    await expect(page.getByText('Companies House authentication code')).toBeVisible();
  });

  test('enriches from Companies House when a key is configured, and Companies House wins over the spreadsheet', async ({ page }) => {
    // Simulate a configured API key and a real lookup, without touching the network.
    await page.route('**/api/companies-house/status', (route) => route.fulfill({ json: { configured: true } }));
    await page.route('**/api/companies-house/company/10101010', (route) =>
      route.fulfill({
        json: {
          companyNumber: '10101010',
          companyName: 'Harbourline Consulting Ltd',
          companyStatus: 'active',
          companyType: 'ltd',
          dateOfCreation: '2016-03-14',
          sicCodes: ['70229'],
          registeredOfficeAddress: { formatted: '42 Harbour Row, London, E1 6AN' },
          accountingReferenceDate: { day: '30', month: '06' },
          nextAccountsDueOn: '2027-12-31',
          nextAccountsPeriodEndOn: '2027-06-30',
          nextConfirmationStatementDueOn: '2027-01-15',
          source: 'companies_house',
        },
      }),
    );
    await page.route('**/api/companies-house/company/20202020', (route) => route.fulfill({ status: 404, json: { error: 'not_found' } }));

    const file = buildRosterFile();
    await page.goto('/clients/import');
    await page.setInputFiles('input[type="file"]', file);

    await expect(page.getByText('2 clients ready to import')).toBeVisible();
    await expect(page.getByText('No live Companies House data')).toHaveCount(0);

    const harbourRow = page.locator('tr', { hasText: 'Harbourline Consulting Ltd' });
    await expect(harbourRow.getByText('Live · active')).toBeVisible();
    const noDatesRow = page.locator('tr', { hasText: 'No Dates Trading Ltd' });
    await expect(noDatesRow.getByText('No live data')).toBeVisible();

    // Companies House's due dates replaced the spreadsheet's own ("Due" was 31 Mar 2027 in the file).
    await expect(harbourRow.getByText('31 Dec 2027')).toBeVisible();

    await page.getByTestId('confirm-import').click();
    await expect(page).toHaveURL(/\/clients$/);
    await page.getByRole('link', { name: 'Harbourline Consulting Ltd' }).first().click();
    await expect(page.getByRole('heading', { name: 'Harbourline Consulting Ltd' })).toBeVisible();
    await expect(page.getByText('42 Harbour Row, London, E1 6AN')).toBeVisible();
  });

  test('shows a warning and still allows import when no Companies House key is configured', async ({ page }) => {
    await page.route('**/api/companies-house/status', (route) => route.fulfill({ json: { configured: false } }));

    const file = buildRosterFile();
    await page.goto('/clients/import');
    await page.setInputFiles('input[type="file"]', file);

    await expect(page.getByText('No live Companies House data')).toBeVisible();
    await expect(page.getByText('2 clients ready to import')).toBeVisible();
    await page.getByTestId('confirm-import').click();
    await expect(page).toHaveURL(/\/clients$/);
  });

  test('re-importing the same roster skips already-imported clients', async ({ page }) => {
    const file = buildRosterFile();
    await page.goto('/clients/import');
    await page.setInputFiles('input[type="file"]', file);
    await expect(page.getByText('2 clients ready to import')).toBeVisible();
    await page.getByTestId('confirm-import').click();
    await expect(page).toHaveURL(/\/clients$/);

    await page.goto('/clients/import');
    await page.setInputFiles('input[type="file"]', file);
    await expect(page.getByText('2 clients ready to import')).toBeVisible();
    await page.getByTestId('confirm-import').click();
    await expect(page).toHaveURL(/\/clients$/);
    await expect(page.getByText('2 clients ·')).toBeVisible();
  });
});
