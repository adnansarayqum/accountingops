import { expect, test } from '@playwright/test';
import { seedFixture } from './fixtures';

/**
 * A spreadsheet roster carries accounts and confirmation statement dates but
 * never a CT600 date, so limited companies imported that way have no
 * corporation tax work at all. Settings → Corporation tax derives it from
 * the accounting period end already on file.
 */
test.describe('generating corporation tax obligations', () => {
  test.beforeEach(async ({ page }) => {
    // The state an import leaves behind: no corporation tax anywhere.
    await seedFixture(page, (data) => {
      data.obligations = data.obligations.filter((o) => o.serviceCode !== 'corporation_tax');
      data.jobs = data.jobs.filter((j) => j.serviceCode !== 'corporation_tax');
      data.subscriptions = data.subscriptions.filter((s) => s.serviceCode !== 'corporation_tax');
    });
  });

  test('lists what it would create, creates it on confirmation, and the dashboard tile fills in', async ({ page }) => {
    // Before: the CT600 tile has nothing to show.
    await page.goto('/');
    const tile = page.getByTestId('service-tile-grid').getByRole('link', { name: /CT600/ });
    await expect(tile).toContainText('nothing tracked yet');

    await page.goto('/settings');
    const card = page.getByTestId('corporation-tax-backfill');
    const row = card.getByTestId('corporation-tax-row-cl_abc');
    await expect(row).toContainText('ABC Construction Ltd');
    await expect(row).toContainText('CT600 due');
    await expect(row).toContainText('tax payable');

    const button = card.getByTestId('generate-corporation-tax');
    const label = (await button.textContent()) ?? '';
    const count = Number(label.match(/\d+/)?.[0]);
    expect(count).toBeGreaterThan(0);

    page.once('dialog', (dialog) => {
      expect(dialog.message()).toContain(`Create corporation tax for ${count} clients?`);
      void dialog.accept();
    });
    await button.click();
    await expect(page.getByText('Corporation tax added')).toBeVisible();
    await expect(card).toContainText('Every limited company with an accounting period already has corporation tax on file.');

    // After: the tile counts real work, and the job carries both statutory dates.
    await page.goto('/');
    await expect(tile).not.toContainText('nothing tracked yet');
    await expect(tile).toContainText('open');

    await page.goto('/clients/cl_abc');
    await page.getByRole('link', { name: /Corporation Tax/ }).first().click();
    await expect(page.getByTestId('ct-payment-due')).toContainText('Tax payable');

    // Persisted, not just on screen.
    await page.goto('/settings');
    await page.reload();
    await expect(page.getByTestId('corporation-tax-backfill')).toContainText('already has corporation tax on file');
  });

  test('declining the confirmation changes nothing', async ({ page }) => {
    await page.goto('/settings');
    const card = page.getByTestId('corporation-tax-backfill');
    const before = await card.getByTestId('generate-corporation-tax').textContent();

    page.once('dialog', (dialog) => void dialog.dismiss());
    await card.getByTestId('generate-corporation-tax').click();
    await expect(card.getByTestId('generate-corporation-tax')).toHaveText(before ?? '');
    await expect(card.getByTestId('corporation-tax-row-cl_abc')).toBeVisible();
  });
});
