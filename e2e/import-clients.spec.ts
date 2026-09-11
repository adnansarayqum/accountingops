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
