import { expect, test } from '@playwright/test';
import { seedFixture } from './fixtures';

/** Overlays — palette, notifications, the phone navigation drawer — behave like overlays: reachable, dismissable, on screen. */
test.describe('overlays', () => {
  test.beforeEach(async ({ page }) => {
    await seedFixture(page);
  });

  test('the notifications popover stays inside the viewport', async ({ page }) => {
    await page.getByRole('button', { name: /Notifications/ }).click();
    const popover = page.getByTestId('notifications-popover');
    await expect(popover).toBeVisible();
    await expect(popover.getByText('Notifications', { exact: true })).toBeVisible();
    const box = (await popover.boundingBox())!;
    const width = page.viewportSize()!.width;
    expect(box.x, 'left edge on screen').toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, 'right edge on screen').toBeLessThanOrEqual(width + 1);
    await page.keyboard.press('Escape');
    await expect(popover).toHaveCount(0);
  });

  test('the command palette closes on Escape and opens the first match on Enter', async ({ page }) => {
    await page.getByTestId('open-search').click();
    const input = page.getByTestId('command-input');
    await expect(input).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(input).toHaveCount(0);

    await page.getByTestId('open-search').click();
    await page.getByTestId('command-input').fill('abc');
    await expect(page.getByRole('option').first()).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/clients\/cl_abc$/);
  });

  test('the phone navigation drawer takes focus and closes on Escape', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'the drawer only exists below the desktop breakpoint');
    await page.getByRole('button', { name: 'Open navigation' }).click();
    const drawer = page.getByTestId('mobile-drawer');
    await expect(drawer).toHaveAttribute('data-open', 'true');
    await expect(page.getByRole('dialog', { name: 'Navigation' }).getByRole('button', { name: 'Close navigation' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveAttribute('data-open', 'false');
  });
});
