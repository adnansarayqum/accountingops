import { expect, test } from '@playwright/test';
import { seedFixture } from './fixtures';

test.describe('dashboard — key deadlines and attention triage', () => {
  test.beforeEach(async ({ page }) => {
    await seedFixture(page);
  });

  test('shows a status tile per service, leading with what is overdue or due soon', async ({ page }) => {
    const tiles = page.getByTestId('service-tiles');
    await expect(tiles).toBeVisible();
    await expect(tiles.getByRole('heading', { level: 2 })).toContainText('Key deadlines');
    await expect(tiles.getByRole('heading', { level: 2 })).toContainText('due within 14 days');

    // Accounts has an overdue job in the fixture, so it sorts first and reads as overdue.
    const grid = page.getByTestId('service-tile-grid');
    const accounts = grid.getByRole('link', { name: /Accounts/ });
    await expect(accounts).toContainText('overdue');
    await expect(grid.getByRole('link').first()).toContainText('Accounts');

    // Corporation tax and payroll always have a tile, even when the practice
    // tracks no such work — "nothing tracked yet" is the useful answer there.
    await expect(grid.getByRole('link', { name: /CT600/ })).toBeVisible();
    await expect(grid.getByRole('link', { name: /Payroll/ })).toContainText('open');

    // Every tile links to that service's jobs.
    await accounts.click();
    await expect(page).toHaveURL(/\/jobs\?service=annual_accounts/);
    await expect(page.getByLabel('Service')).toHaveValue('annual_accounts');
  });

  test('triages the top attention items in a table, with the real recommended action per row', async ({ page }) => {
    const table = page.getByTestId('attention-table');
    await expect(table).toBeVisible();
    // Five columns on a desktop; below `lg` the table collapses to stacked rows
    // and drops the header, since five columns only truncate at tablet width.
    const wide = (page.viewportSize()?.width ?? 0) >= 1024;
    if (wide) await expect(table.getByRole('columnheader')).toHaveText(['Client', 'Job', 'Due date', 'Status', 'Action', 'More']);
    else await expect(table.getByRole('columnheader')).toHaveCount(0);

    // Worst first: the fixture's overdue accounts job leads, and reads as overdue.
    const first = page.getByTestId('attention-row').first();
    await expect(first).toContainText('Overdue by');
    await expect(first).toHaveAttribute('data-severity', 'red');

    // The action is the rule's own recommendation, not a generic "Complete" —
    // a job waiting on records gets a reminder, one waiting on approval gets chased.
    const actions = await page.getByTestId('attention-action').allTextContents();
    expect(actions.length).toBeGreaterThan(0);
    expect(new Set(actions).size).toBeGreaterThan(1);

    // The client record is reachable from the row either way: on a desktop through
    // the overflow menu, on a phone (where that column is dropped) through the name.
    if (wide) {
      await first.getByRole('button', { name: /More actions/ }).click();
      await first.getByRole('menuitem', { name: 'Open client' }).click();
    } else {
      await expect(first.getByRole('button', { name: /More actions/ })).toHaveCount(0);
      await first.getByRole('link').first().click();
    }
    await expect(page).toHaveURL(/\/clients\/cl_/);
  });

  test('splits the right rail by axis: workload and identity verification separately', async ({ page }) => {
    // The donut's centre is the total its own legend adds up to.
    const workload = page.getByTestId('client-workload');
    const open = Number((await workload.locator('p.tabular').first().textContent()) ?? '0');
    const legend = await workload.locator('li span:last-child').allTextContents();
    expect(legend.reduce((sum, n) => sum + Number(n), 0)).toBe(open);

    // Identity verification is its own box, not one more reason a job is flagged.
    const identity = page.getByTestId('identity-verification');
    await expect(identity).toContainText('Greenfield Design Ltd');
    await identity.getByRole('link', { name: 'Manage' }).click();
    await expect(page).toHaveURL(/\/readiness$/);
  });

  test('puts a pound figure on late filing, and carries it into the attention reasons', async ({ page }) => {
    // The fixture's overdue accounts job is a few days late: £150 now, £375 after a month.
    const card = page.getByTestId('penalty-exposure');
    await expect(card).toContainText('£150');
    await expect(card).toContainText('already incurred');
    await card.getByTestId(/^penalty-job_/).first().click();
    await expect(page).toHaveURL(/\/jobs\/job_/);
    await expect(page.getByText(/Late filing penalty now £150\. Rises by £375 in \d+ days\./)).toBeVisible();
  });

  test('every quick action goes to a route that exists', async ({ page }) => {
    const takeAction = page.locator('div.card', { has: page.getByRole('heading', { name: 'Quick actions' }) });
    for (const [name, url] of [
      ['Send client reminders', /\/chasing$/],
      ['Review upcoming deadlines', /\/jobs\?due=14/],
      ['Review uploaded documents', /\/inbox$/],
      ['Ask the practice', /\/ask$/],
    ] as const) {
      await page.goto('/');
      await takeAction.getByRole('link', { name }).click();
      await expect(page).toHaveURL(url);
      // A route that doesn't exist still matches the URL — the 404 page is what proves it resolved.
      await expect(page.getByText("That page doesn't exist")).toHaveCount(0);
    }
  });
});
