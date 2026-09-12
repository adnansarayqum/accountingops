import { expect, test } from '@playwright/test';

/**
 * A brand-new practice has no seeded/demo data at all — every list starts
 * empty and the first real client is added by hand. This is the actual
 * production entry point (there is no "load sample data" button).
 */
test.describe('brand-new practice', () => {
  test.beforeEach(async ({ page }) => {
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.getByTestId('dashboard')).toBeVisible();
  });

  test('boots with no clients, jobs or inbox items', async ({ page }) => {
    await expect(page.getByTestId('attention-card')).toHaveCount(0);
    await page.goto('/clients');
    await expect(page.getByRole('heading', { name: 'Clients' })).toBeVisible();
    await expect(page.getByText('No clients match')).toBeVisible();
    await page.goto('/inbox');
    await expect(page.getByText('Inbox cleared')).toBeVisible();
  });

  test('adding the first client makes it appear everywhere', async ({ page }) => {
    await page.goto('/clients/new');
    await page.getByLabel('Client / company name').fill('Harbour Cycles Ltd');
    await page.getByLabel('Main contact').fill('Jamie Harbour');
    await page.getByRole('button', { name: 'Create client' }).click();
    await expect(page.getByRole('heading', { name: 'Harbour Cycles Ltd' })).toBeVisible();

    await page.goto('/clients');
    await expect(page.getByRole('link', { name: 'Harbour Cycles Ltd' }).first()).toBeVisible();
  });
});
