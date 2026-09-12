import { expect, test } from '@playwright/test';
import { seedFixture } from './fixtures';

/**
 * The morning-briefing settings card is per-user and server-side, so the
 * browser-only build must not show it at all. Saving and sending are
 * covered against a real database in server/routes/__tests__/auth.test.mjs.
 */
test.describe('morning briefing by email', () => {
  test('is absent in the browser-only mode, where there is no account to attach an address to', async ({ page }) => {
    await seedFixture(page);
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await expect(page.getByTestId('briefing-email')).toHaveCount(0);
  });
});
