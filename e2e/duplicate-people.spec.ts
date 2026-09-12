import { expect, test } from '@playwright/test';
import { seedFixture } from './fixtures';

test.describe('merging duplicate people', () => {
  test.beforeEach(async ({ page }) => {
    // Dave Thompson a second time, the way an older import wrote him:
    // surname first, with a director role at ABC (which Dave already holds)
    // and one at Greenfield (which he doesn't).
    await seedFixture(page, (data) => {
      data.people.push({ id: 'p_dave_dup', practiceId: data.practice.id, fullName: 'THOMPSON, Dave' });
      data.personRoles.push(
        { id: 'pr_dup_1', practiceId: data.practice.id, personId: 'p_dave_dup', clientId: 'cl_abc', kind: 'director', identityVerification: 'not_started', personalCodeCaptured: false, evidenceStatus: 'none' },
        { id: 'pr_dup_2', practiceId: data.practice.id, personId: 'p_dave_dup', clientId: 'cl_greenfield', kind: 'director', identityVerification: 'not_started', personalCodeCaptured: false, evidenceStatus: 'none' },
      );
    });
  });

  test('lists the duplicate, merges it on confirmation, and the client shows the person once per role afterwards', async ({ page }) => {
    // Before: ABC's Directors & PSCs card shows Dave three times (director, PSC, and the duplicate director).
    await page.goto('/clients/cl_abc');
    const rolesCard = page.locator('div.card', { has: page.getByRole('heading', { name: 'Directors & PSCs' }) });
    await expect(rolesCard.getByText('Dave Thompson', { exact: true })).toHaveCount(3);

    await page.goto('/settings');
    const card = page.getByTestId('duplicate-people');
    await expect(card.getByTestId('duplicate-group-p_dave')).toContainText('recorded 2 times');
    await expect(card.getByTestId('duplicate-group-p_dave')).toContainText('ABC Construction Ltd, Greenfield Design Ltd');

    page.once('dialog', (dialog) => {
      expect(dialog.message()).toContain('Merge 1 duplicate record?');
      void dialog.accept();
    });
    await card.getByTestId('merge-duplicate-people').click();
    await expect(page.getByText('Duplicates merged')).toBeVisible();
    await expect(card).toContainText('No duplicate people found.');

    // After: director + PSC only, and the moved Greenfield role now belongs to the kept record.
    await page.goto('/clients/cl_abc');
    await expect(rolesCard.getByText('Dave Thompson', { exact: true })).toHaveCount(2);
    await page.goto('/clients/cl_greenfield');
    await expect(page.locator('div.card', { has: page.getByRole('heading', { name: 'Directors & PSCs' }) }).getByText('Dave Thompson', { exact: true })).toHaveCount(1);

    // Persisted, not just on screen.
    await page.reload();
    await page.goto('/settings');
    await expect(page.getByTestId('duplicate-people')).toContainText('No duplicate people found.');
  });

  test('declining the confirmation changes nothing', async ({ page }) => {
    await page.goto('/settings');
    page.once('dialog', (dialog) => void dialog.dismiss());
    await page.getByTestId('merge-duplicate-people').click();
    await expect(page.getByTestId('duplicate-group-p_dave')).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('duplicate-group-p_dave')).toBeVisible();
  });
});
