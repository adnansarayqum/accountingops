import { expect, test } from '@playwright/test';
import { seedFixture } from './fixtures';

test.describe('tab strip scroll cue', () => {
  test.beforeEach(async ({ page }) => {
    await seedFixture(page);
  });

  test('fades the edge with more tabs behind it exactly when the strip overflows', async ({ page }, testInfo) => {
    await page.goto('/clients/cl_abc');
    const list = page.getByRole('tablist');
    await expect(list).toBeVisible();
    const overflows = await list.evaluate((el) => el.scrollWidth > el.clientWidth + 1);

    if (testInfo.project.name === 'mobile') {
      // Four tabs with counts don't fit a phone: the cue must be there.
      expect(overflows).toBe(true);
      await expect(list).toHaveAttribute('data-overflow', 'right');
      await expect(page.getByTestId('tabs-fade-right')).toBeVisible();
      // The last tab is still reachable and selecting it scrolls it into view, so the cue flips sides.
      await page.getByRole('tab', { name: /Activity/ }).click();
      await expect(page.getByRole('tab', { name: /Activity/ })).toHaveAttribute('aria-selected', 'true');
      await expect(list).toHaveAttribute('data-overflow', 'left');
      await expect(page.getByTestId('tabs-fade-right')).toHaveCount(0);
    } else {
      expect(overflows).toBe(false);
      await expect(list).not.toHaveAttribute('data-overflow', /.+/);
      await expect(page.getByTestId('tabs-fade-right')).toHaveCount(0);
    }
  });
});
