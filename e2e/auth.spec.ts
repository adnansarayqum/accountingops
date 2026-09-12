import { expect, test } from '@playwright/test';
import { resetServerState } from './dbFixtures';

/**
 * Requires DATABASE_URL (and ADNAN_TEMP_PASSWORD / FARHAN_TEMP_PASSWORD) to
 * be set for the Playwright webServer process — run separately from the
 * rest of the suite, which assumes the no-database, browser-only mode.
 *
 * Runs on the desktop project only. This file tests server-side auth
 * logic, not layout — running it on both projects would mean two
 * concurrent Playwright workers each wiping the same shared test database
 * in their own beforeEach, racing each other regardless of viewport.
 *
 * Forced serial: fullyParallel:false only guarantees test order within a
 * single worker, and `mode: 'serial'` only pins the tests within ONE
 * instance of this describe block to one worker. Neither stops Playwright
 * from scheduling a *repeated* instance of this whole file (e.g. run with
 * --repeat-each, as when stress-testing for flakes) onto a second worker
 * concurrently with the first — and two instances running at once would
 * each call resetServerState() and wipe the other's session/user rows
 * mid-flight. Verified: --repeat-each=8 with the default worker count
 * reproduces that race; --repeat-each=8 --workers=1 does not (24/24 green).
 * So a stress/flake-hunting run of this file must also pass --workers=1;
 * a normal single-pass run (no --repeat-each) never creates a second
 * instance to race against and needs no extra flag.
 */
test.describe.configure({ mode: 'serial' });

test.describe('server-backed login', () => {
  test.skip(!process.env.DATABASE_URL, 'requires DATABASE_URL for this run');

  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'runs once, not per-viewport — see file comment');
    await resetServerState();
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  });

  test('signs in with a temporary password, is forced to change it, then uses the app', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Farhan & Raihan' })).toBeVisible();
    await page.getByTestId('login-username').fill('adnan');
    await page.getByTestId('login-password').fill(process.env.ADNAN_TEMP_PASSWORD!);
    await page.getByTestId('login-submit').click();

    await expect(page.getByRole('heading', { name: 'Set a new password' })).toBeVisible();
    await page.getByTestId('change-password-current').fill(process.env.ADNAN_TEMP_PASSWORD!);
    await page.getByTestId('change-password-new').fill('BrandNewPass1');
    await page.getByTestId('change-password-confirm').fill('BrandNewPass1');
    await page.getByTestId('change-password-submit').click();

    // A first login goes through several sequential requests (change
    // password, then load practice data — 404 the first time — then save a
    // freshly built empty practice) before the app is ready; give it more
    // room than the default 5s under test-environment load.
    await expect(page.getByRole('heading', { name: 'Practice Today' })).toBeVisible({ timeout: 15_000 });

    // The session survives a reload — no need to sign in again.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Practice Today' })).toBeVisible();

    // Settings shows the real signed-in account, not the local-mode "act as" switcher.
    await page.goto('/settings');
    await expect(page.getByText('Adnan Sarayqum (adnan)')).toBeVisible();

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByTestId('login-username')).toBeVisible();
  });

  test('rejects an incorrect password without signing in', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('login-username').fill('adnan');
    await page.getByTestId('login-password').fill('totally-wrong-password');
    await page.getByTestId('login-submit').click();
    await expect(page.getByText('Incorrect username or password.')).toBeVisible();
    await expect(page.getByTestId('login-username')).toBeVisible();
  });

  test('a client created by one account is visible to another — shared, not per-browser, data', async ({ browser }) => {
    const farhanContext = await browser.newContext();
    const farhanPage = await farhanContext.newPage();
    await farhanPage.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await farhanPage.goto('/');
    await farhanPage.getByTestId('login-username').fill('farhan');
    await farhanPage.getByTestId('login-password').fill(process.env.FARHAN_TEMP_PASSWORD!);
    await farhanPage.getByTestId('login-submit').click();
    await farhanPage.getByTestId('change-password-current').fill(process.env.FARHAN_TEMP_PASSWORD!);
    await farhanPage.getByTestId('change-password-new').fill('AnotherPass1');
    await farhanPage.getByTestId('change-password-confirm').fill('AnotherPass1');
    await farhanPage.getByTestId('change-password-submit').click();
    await expect(farhanPage.getByRole('heading', { name: 'Practice Today' })).toBeVisible({ timeout: 15_000 });

    await farhanPage.goto('/clients/new');
    await farhanPage.getByLabel('Client / company name').fill('Shared Data Test Ltd');
    await farhanPage.getByLabel('Main contact').fill('Test Contact');
    await farhanPage.getByRole('button', { name: 'Create client' }).click();
    await expect(farhanPage.getByRole('heading', { name: 'Shared Data Test Ltd' })).toBeVisible();
    await farhanContext.close();

    // A separate browser context — a different device — signs in as Adnan
    // and sees the client Farhan just created.
    const adnanContext = await browser.newContext();
    const adnanPage = await adnanContext.newPage();
    await adnanPage.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await adnanPage.goto('/');
    await adnanPage.getByTestId('login-username').fill('adnan');
    await adnanPage.getByTestId('login-password').fill(process.env.ADNAN_TEMP_PASSWORD!);
    await adnanPage.getByTestId('login-submit').click();
    await adnanPage.getByTestId('change-password-current').fill(process.env.ADNAN_TEMP_PASSWORD!);
    await adnanPage.getByTestId('change-password-new').fill('BrandNewPass1');
    await adnanPage.getByTestId('change-password-confirm').fill('BrandNewPass1');
    await adnanPage.getByTestId('change-password-submit').click();
    await adnanPage.goto('/clients');
    await expect(adnanPage.getByRole('link', { name: 'Shared Data Test Ltd' }).first()).toBeVisible();
    await adnanContext.close();
  });

  test('two people editing at once both keep their change, and any version can be brought back', async ({ browser }) => {
    const signIn = async (username: string, temp: string, next: string) => {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
      await page.goto('/');
      await page.getByTestId('login-username').fill(username);
      await page.getByTestId('login-password').fill(temp);
      await page.getByTestId('login-submit').click();
      await page.getByTestId('change-password-current').fill(temp);
      await page.getByTestId('change-password-new').fill(next);
      await page.getByTestId('change-password-confirm').fill(next);
      await page.getByTestId('change-password-submit').click();
      await expect(page.getByRole('heading', { name: 'Practice Today' })).toBeVisible({ timeout: 15_000 });
      return { context, page };
    };
    const createClient = async (page: import('@playwright/test').Page, name: string) => {
      await page.goto('/clients/new');
      await page.getByLabel('Client / company name').fill(name);
      await page.getByLabel('Main contact').fill('Someone');
      await page.getByRole('button', { name: 'Create client' }).click();
      await expect(page.getByRole('heading', { name })).toBeVisible();
    };

    // Both load the same (empty) practice.
    const farhan = await signIn('farhan', process.env.FARHAN_TEMP_PASSWORD!, 'AnotherPass1');
    const adnan = await signIn('adnan', process.env.ADNAN_TEMP_PASSWORD!, 'BrandNewPass1');

    // Farhan saves first. Adnan's tab is now stale, but saves anyway — the
    // server refuses it, the app rebuilds Adnan's change on Farhan's version,
    // and neither client is lost.
    await createClient(farhan.page, 'Farhan Was First Ltd');
    await createClient(adnan.page, 'Adnan Was Second Ltd');
    await adnan.page.goto('/clients');
    await expect(adnan.page.getByRole('link', { name: 'Farhan Was First Ltd' }).first()).toBeVisible();
    await expect(adnan.page.getByRole('link', { name: 'Adnan Was Second Ltd' }).first()).toBeVisible();
    await farhan.page.goto('/clients');
    await expect(farhan.page.getByRole('link', { name: 'Adnan Was Second Ltd' }).first()).toBeVisible({ timeout: 10_000 });

    // Every save is a version; going back to the one before Adnan's client undoes it — as a new version.
    await adnan.page.goto('/settings');
    const history = adnan.page.getByTestId('snapshot-history');
    const currentRow = history.locator('li', { hasText: 'current' });
    await expect(currentRow).toBeVisible();
    const current = Number(/Version (\d+)/.exec(await currentRow.innerText())![1]);
    expect(current).toBeGreaterThanOrEqual(2); // Farhan's save, then Adnan's replayed one
    adnan.page.once('dialog', (d) => void d.accept());
    await adnan.page.getByTestId(`restore-version-${current - 1}`).click();
    await expect(adnan.page.getByText(`Restored version ${current - 1}`)).toBeVisible();
    await expect(history.locator('li', { hasText: 'current' })).toContainText(`Version ${current + 1}`);
    await adnan.page.goto('/clients');
    await expect(adnan.page.getByRole('link', { name: 'Farhan Was First Ltd' }).first()).toBeVisible();
    await expect(adnan.page.getByRole('link', { name: 'Adnan Was Second Ltd' })).toHaveCount(0);

    await farhan.context.close();
    await adnan.context.close();
  });
});
