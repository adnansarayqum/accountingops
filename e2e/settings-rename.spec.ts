import { expect, test } from '@playwright/test';
import { seedFixture } from './fixtures';

test.describe('team member rename', () => {
  test.beforeEach(async ({ page }) => {
    await seedFixture(page);
  });

  test('corrects a typo in a team member’s name and it shows up everywhere', async ({ page }) => {
    await page.goto('/settings');
    const teamItem = page.getByTestId('team-member-u_sarah');
    await teamItem.getByRole('button', { name: 'Edit name for Sarah Mitchell' }).click();
    await teamItem.getByRole('textbox').fill('Sarah Raihan Mitchell');
    await teamItem.getByRole('button', { name: 'Save name' }).click();

    await expect(teamItem.getByText('Sarah Raihan Mitchell')).toBeVisible();
    // The rename also shows up in the "signed in as" switcher (local, no-database mode).
    await expect(page.getByLabel('Signed in as')).toContainText('Sarah Raihan Mitchell');

    // Persisted, not just local component state — reload the same /settings route.
    await page.reload();
    await expect(page.getByTestId('team-member-u_sarah').getByText('Sarah Raihan Mitchell')).toBeVisible();
  });
});
