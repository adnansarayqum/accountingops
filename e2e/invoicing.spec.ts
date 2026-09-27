import { expect, test } from '@playwright/test';
import { seedFixture } from './fixtures';

test.describe('invoicing', () => {
  test.beforeEach(async ({ page }) => {
    await seedFixture(page);
  });

  test('shows the fixture invoice on the client page and in the practice-wide list', async ({ page }) => {
    await page.goto('/clients/cl_khan');
    const card = page.getByTestId('invoices-card');
    await expect(card).toContainText('£120 outstanding across 1 invoice');
    const row = card.getByTestId('invoice-row-inv_khan_1');
    await expect(row).toContainText('INV-1042');
    await expect(row).toContainText('Sent');

    await page.goto('/invoices');
    await expect(page.getByTestId('invoices-list')).toContainText('INV-1042');
  });

  test('creates an invoice from unbilled WIP and logged time, priced at the practice hourly rate', async ({ page }) => {
    await page.goto('/clients/cl_abc');
    const card = page.getByTestId('invoices-card');
    await card.getByTestId('invoice-create-open').click();

    const modal = page.getByRole('dialog', { name: 'Create invoice' });
    await modal.getByTestId('create-invoice-wip-wip_abc_1').getByRole('checkbox').check();
    await modal.getByTestId('create-invoice-time-time_abc_1').getByRole('checkbox').check();
    // £150 WIP + (45 minutes at £60/hour = £45).
    await expect(modal.getByTestId('create-invoice-save')).toContainText('£195');
    await modal.getByTestId('create-invoice-save').click();

    await expect(page.getByText(/Invoice INV-\d+ created/)).toBeVisible();
    await expect(page).toHaveURL(/\/invoices\/inv_/);
    await expect(page.getByText('Subtotal')).toBeVisible();
    await expect(page.locator('#invoice-print-area')).toContainText('£195');
    await expect(page.locator('#invoice-print-area')).toContainText('Advised on a VAT partial exemption query outside the return itself.');
    await expect(page.locator('#invoice-print-area')).toContainText('Time (45 minutes)');
  });

  test('a client with nothing unbilled shows the empty message and disables submit', async ({ page }) => {
    await page.goto('/clients/cl_brown');
    await page.getByTestId('invoices-card').getByTestId('invoice-create-open').click();
    const modal = page.getByRole('dialog', { name: 'Create invoice' });
    await expect(modal).toContainText('Nothing unbilled for this client.');
    await expect(modal.getByTestId('create-invoice-save')).toBeDisabled();
  });

  test('moves an invoice draft -> sent -> paid, and the buttons update as it goes', async ({ page }) => {
    await page.goto('/clients/cl_abc');
    await page.getByTestId('invoices-card').getByTestId('invoice-create-open').click();
    const modal = page.getByRole('dialog', { name: 'Create invoice' });
    await modal.getByTestId('create-invoice-wip-wip_abc_2').getByRole('checkbox').check();
    await modal.getByTestId('create-invoice-save').click();
    await expect(page).toHaveURL(/\/invoices\/inv_/);

    await expect(page.getByTestId('invoice-mark-sent')).toBeVisible();
    await expect(page.getByTestId('invoice-mark-paid')).toHaveCount(0);
    await page.getByTestId('invoice-mark-sent').click();
    await expect(page.getByText('Sent', { exact: true })).toBeVisible();
    await expect(page.getByTestId('invoice-mark-sent')).toHaveCount(0);

    await page.getByTestId('invoice-mark-paid').click();
    await expect(page.getByText('Paid', { exact: true })).toBeVisible();
    await expect(page.getByTestId('invoice-mark-paid')).toHaveCount(0);
    await expect(page.getByTestId('invoice-void-open')).toHaveCount(0);
  });

  test('voids a draft invoice and releases its WIP entry back to unbilled', async ({ page }) => {
    await page.goto('/clients/cl_abc');
    await page.getByTestId('invoices-card').getByTestId('invoice-create-open').click();
    const modal = page.getByRole('dialog', { name: 'Create invoice' });
    await modal.getByTestId('create-invoice-wip-wip_abc_1').getByRole('checkbox').check();
    await modal.getByTestId('create-invoice-save').click();
    await expect(page).toHaveURL(/\/invoices\/inv_/);

    await page.getByTestId('invoice-void-open').click();
    await page.getByTestId('invoice-void-confirm').click();
    await expect(page.getByText('Invoice voided')).toBeVisible();
    await expect(page.getByText('Void', { exact: true })).toBeVisible();

    await page.goto('/clients/cl_abc');
    const wipCard = page.getByTestId('wip-card');
    await expect(wipCard).toContainText('£240 unbilled across 2 items');
    await expect(wipCard.getByTestId('wip-row-wip_abc_1')).toBeVisible();
  });

  test('filters the invoices list by status and client', async ({ page }) => {
    await page.goto('/invoices');
    const list = page.getByTestId('invoices-list');
    await expect(list).toContainText('INV-1042');

    await page.getByLabel('Status').selectOption('paid');
    await expect(page.getByText('No invoices match these filters')).toBeVisible();

    await page.getByLabel('Status').selectOption('all');
    await page.getByLabel('Client').selectOption('cl_khan');
    await expect(list).toContainText('INV-1042');
    await page.getByLabel('Client').selectOption('cl_abc');
    await expect(page.getByText('No invoices match these filters')).toBeVisible();
  });

  test('the print button opens the browser print dialog', async ({ page }) => {
    await page.goto('/clients/cl_khan');
    await page.getByTestId('invoice-row-inv_khan_1').click();
    await expect(page).toHaveURL(/\/invoices\/inv_khan_1/);

    let printed = false;
    await page.exposeFunction('__reportPrint', () => {
      printed = true;
    });
    await page.evaluate(() => {
      window.print = () => (window as unknown as { __reportPrint: () => void }).__reportPrint();
    });
    await page.getByTestId('invoice-print').click();
    await expect.poll(() => printed).toBe(true);
  });
});
