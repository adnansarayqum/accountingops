import { expect, test } from '@playwright/test';

/**
 * The seam between the server-backed and browser-only modes. The rule under
 * test: "no database configured" is the browser-only mode, but "a database
 * that isn't answering" is an outage and must never quietly become the
 * browser-only mode — anything typed into it would be saved to this browser
 * alone and never reach the shared practice.
 *
 * The preview server this suite runs against has no database, so the
 * outage is staged by answering /health (and /api/auth/me) in the browser.
 */
test.describe('database outage', () => {
  test.beforeEach(async ({ page }) => {
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  });

  test('a configured-but-unreachable database shows the outage screen, and Try again recovers', async ({ page }) => {
    await page.route('**/health', (route) => route.fulfill({ json: { status: 'degraded', database: true, databaseReachable: false } }));
    await page.goto('/');
    await expect(page.getByRole('heading', { name: "The practice database isn't reachable" })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Practice Today' })).toHaveCount(0);
    // Nothing was written to this browser while the shared practice was out of reach.
    expect(await page.evaluate(() => localStorage.getItem('practiceops.data'))).toBeNull();

    // The database comes back (here: the real preview server answers, with no database at all).
    await page.unroute('**/health');
    await page.getByTestId('unavailable-retry').click();
    await expect(page.getByRole('heading', { name: 'Practice Today' })).toBeVisible();
  });

  test('a server error from the session check is an outage, not the browser-only mode', async ({ page }) => {
    await page.route('**/health', (route) => route.fulfill({ json: { status: 'ok', database: true, databaseReachable: true } }));
    await page.route('**/api/auth/me', (route) => route.fulfill({ status: 500, json: { error: 'Something went wrong.' } }));
    await page.goto('/');
    await expect(page.getByRole('heading', { name: "The practice database isn't reachable" })).toBeVisible();
    await expect(page.getByTestId('login-username')).toHaveCount(0);
  });
});
