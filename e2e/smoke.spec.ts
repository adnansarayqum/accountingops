import { expect, test } from '@playwright/test';

test('browser-only app loads and lazy routes remain navigable', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('dashboard')).toBeVisible();

  await page.getByRole('link', { name: 'Clients', exact: true }).click();
  await expect(page).toHaveURL(/\/clients$/);
  await expect(page.getByRole('heading', { name: 'Clients' })).toBeVisible();
});
