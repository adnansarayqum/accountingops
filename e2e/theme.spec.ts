import { expect, test } from '@playwright/test';

/**
 * The theme is applied by a small script that runs before the app bundle
 * (public/theme-init.js) so dark-mode users never see a light flash. It
 * used to be inline in index.html; the Content-Security-Policy the preview
 * and production servers now send forbids inline scripts, so this checks
 * that the external script still runs under that policy — and that the
 * policy is actually being served.
 */
test.describe('theme initialisation under the Content-Security-Policy', () => {
  test('serves the CSP and still applies a stored dark theme before the app loads', async ({ page }) => {
    // Answer the web-font requests with nothing rather than aborting them:
    // an aborted request logs a console error of its own, which would be
    // indistinguishable from a real failure below.
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    const response = await page.goto('/');
    expect(response?.headers()['content-security-policy']).toContain("script-src 'self'");
    expect(response?.headers()['x-frame-options']).toBe('DENY');

    await page.evaluate(() => localStorage.setItem('practiceops.theme', 'dark'));
    await page.reload();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await expect(page.getByRole('heading', { name: 'Practice Today' })).toBeVisible();

    await page.evaluate(() => localStorage.setItem('practiceops.theme', 'light'));
    await page.reload();
    await expect(page.locator('html')).not.toHaveClass(/dark/);

    expect(errors, 'no CSP violations or script errors').toEqual([]);
  });
});
