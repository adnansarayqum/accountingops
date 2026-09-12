import { expect, test } from '@playwright/test';
import { seedFixture } from './fixtures';

test.describe('dashboard — due soon split by service', () => {
  test.beforeEach(async ({ page }) => {
    await seedFixture(page);
  });

  test('shows a status tile per service, leading with what is overdue or due soon', async ({ page }) => {
    const tiles = page.getByTestId('service-tiles');
    await expect(tiles).toBeVisible();
    await expect(tiles.getByRole('heading', { level: 2 })).toHaveText('By service — overdue, and due within 14 days');

    // Accounts has an overdue job in the fixture, so it sorts first and reads as overdue.
    const accounts = tiles.getByRole('link', { name: /Accounts due/ });
    await expect(accounts).toContainText('overdue');
    await expect(page.getByTestId('service-tile-grid').getByRole('link').first()).toContainText('Accounts due');

    // Corporation tax and payroll always have a tile, even when the practice
    // tracks no such work — "nothing tracked yet" is the useful answer there.
    await expect(tiles.getByRole('link', { name: /CT600 due/ })).toBeVisible();
    await expect(tiles.getByRole('link', { name: /Payroll due/ })).toContainText('open');

    // Every tile links to that service's jobs.
    await accounts.click();
    await expect(page).toHaveURL(/\/jobs\?service=annual_accounts/);
    await expect(page.getByLabel('Service')).toHaveValue('annual_accounts');
  });

  test('splits due-soon jobs into separate boxes per service instead of one combined list, and surfaces identity verification separately', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Due soon' })).toBeVisible();
    // The old combined-list card is gone.
    await expect(page.getByRole('heading', { name: 'Due in the next 14 days', exact: true })).toHaveCount(0);

    const dueSoonSection = page.locator('section', { has: page.getByRole('heading', { name: 'Due soon' }) });
    // The fixture's due-soon jobs span Self Assessment, VAT, Payroll and Accounts — each gets
    // its own card, ordered by nearest deadline — plus Identity verification, split out
    // separately since it's its own axis rather than one more reason a job might be flagged.
    const cardTitles = dueSoonSection.locator('.card h2');
    await expect(cardTitles).toHaveText(['SA', 'VAT', 'Payroll', 'Accounts', 'Identity verification'], { timeout: 10_000 });

    // Payroll has more due-soon jobs than fit in one box — a "view all" link with the true count.
    const payrollCard = dueSoonSection.locator('div.card', { has: page.getByRole('heading', { name: 'Payroll', exact: true }) });
    const viewAllPayroll = payrollCard.getByRole('link', { name: /View all \d+/ });
    await expect(viewAllPayroll).toBeVisible();
    await viewAllPayroll.click();
    await expect(page).toHaveURL(/\/jobs\?due=14&service=payroll/);
    await expect(page.getByLabel('Service')).toHaveValue('payroll');

    // Identity verification is its own box, separate from the per-service due-soon list.
    await page.goto('/');
    const identityCard = dueSoonSection.locator('div.card', { has: page.getByRole('heading', { name: 'Identity verification' }) });
    await expect(identityCard).toContainText('Greenfield Design Ltd');
    await identityCard.getByRole('link', { name: 'Manage in Readiness →' }).click();
    await expect(page).toHaveURL(/\/readiness$/);
  });
});
