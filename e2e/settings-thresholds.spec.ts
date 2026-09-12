import { expect, test } from '@playwright/test';
import { seedFixture } from './fixtures';

test.describe('configurable timing thresholds', () => {
  test.beforeEach(async ({ page }) => {
    await seedFixture(page);
  });

  test('widening the due soon window in Settings changes what the dashboard counts as due soon, and the change persists', async ({ page }) => {
    await page.goto('/settings');
    const dueSoon = page.getByLabel('Due soon window');
    await expect(dueSoon).toHaveValue('14');

    // Greenfield's confirmation statement is due in 18 days — outside the default
    // 14-day window, so the CS01 tile reads as scheduled rather than due soon.
    await page.goto('/');
    const tiles = page.getByTestId('service-tiles');
    const cs01 = page.getByTestId('service-tile-grid').getByRole('link', { name: /CS01/ });
    await expect(tiles.getByRole('heading', { level: 2 })).toContainText('due within 14 days');
    await expect(cs01).toContainText('next in 18 days');

    await page.goto('/settings');
    await dueSoon.fill('20');
    await page.getByRole('button', { name: 'Save thresholds' }).click();
    await expect(page.getByText('Timing thresholds updated')).toBeVisible();

    // Reflected on the dashboard immediately, without a reload.
    await page.goto('/');
    await expect(tiles.getByRole('heading', { level: 2 })).toContainText('due within 20 days');
    await expect(cs01).toContainText('due within 20 days');

    // Persisted, not just on-screen state.
    await page.reload();
    await expect(cs01).toContainText('due within 20 days');
    await page.goto('/settings');
    await expect(page.getByLabel('Due soon window')).toHaveValue('20');
  });

  test('an out-of-range value is rejected without touching what is stored, and Reset to defaults restores the form', async ({ page }) => {
    await page.goto('/settings');
    const staleField = page.getByLabel('Stale job threshold');
    await staleField.fill('0');
    await page.getByRole('button', { name: 'Save thresholds' }).click();
    await expect(page.getByText('Enter a whole number from 1 to 365.')).toBeVisible();

    await page.reload();
    // Nothing was saved — still the default.
    await expect(page.getByLabel('Stale job threshold')).toHaveValue('14');

    await page.getByLabel('Due soon window').fill('30');
    await page.getByRole('button', { name: 'Reset to defaults' }).click();
    await expect(page.getByLabel('Due soon window')).toHaveValue('14');
  });
});
