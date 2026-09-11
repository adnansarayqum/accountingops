import { expect, test } from '@playwright/test';

const ROUTES = ['/', '/attention', '/inbox', '/clients', '/clients/new', '/clients/cl_abc', '/jobs', '/jobs/job_abc_accounts', '/chasing', '/onboarding', '/capacity', '/readiness', '/briefing', '/activity', '/ask', '/settings'];

/** Every major screen renders without console errors or horizontal overflow. */
for (const route of ROUTES) {
  test(`screen ${route} renders cleanly`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error' && !/ERR_FAILED|fonts\.g/.test(m.text())) errors.push(m.text());
    });
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await page.goto(route);
    await expect(page.locator('main h1')).toBeVisible();
    const [scrollWidth, clientWidth] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    expect(scrollWidth, `horizontal overflow on ${route}`).toBeLessThanOrEqual(clientWidth + 1);
    expect(errors).toEqual([]);
  });
}
