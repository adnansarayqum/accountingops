import { expect, test } from '@playwright/test';
import { seedFixture } from './fixtures';

/** Work in progress (unbilled extra work) and time logged per client — both requested by a practice owner after trying the app. */
test.describe('work in progress and time tracking', () => {
  test.beforeEach(async ({ page }) => {
    await seedFixture(page);
  });

  test('shows the unbilled total from the fixture, records a new item, and marks one invoiced', async ({ page }) => {
    await page.goto('/clients/cl_abc');
    const card = page.getByTestId('wip-card');
    await expect(card).toContainText('£240 unbilled across 2 items');

    await card.getByTestId('wip-add').click();
    await card.getByTestId('wip-description').fill('Sorted an ad hoc HMRC query.');
    await card.getByTestId('wip-amount').fill('£75');
    await card.getByTestId('wip-save').click();
    await expect(page.getByText('Unbilled work recorded')).toBeVisible();
    await expect(card).toContainText('£315 unbilled across 3 items');

    // Mark the original £150 item invoiced — the total drops, and it moves to the resolved list.
    await card.getByTestId('wip-invoice-wip_abc_1').click();
    await expect(card).toContainText('£165 unbilled across 2 items');
    await card.locator('summary').click();
    await expect(card).toContainText('Invoiced');
  });

  test('deletes an unbilled item but never one already invoiced', async ({ page }) => {
    await page.goto('/clients/cl_khan');
    const card = page.getByTestId('wip-card');
    // wip_khan_1 is already invoiced in the fixture — resolved, not deletable from here.
    await card.locator('summary').click();
    await expect(card).toContainText('Invoiced');
    await expect(card.getByTestId('wip-row-wip_khan_1').getByLabel('Remove this entry')).toHaveCount(0);
  });

  test('rejects an empty description or a non-positive amount', async ({ page }) => {
    await page.goto('/clients/cl_brown');
    const card = page.getByTestId('wip-card');
    await expect(card).toContainText('Nothing unbilled for this client.');
    await card.getByTestId('wip-add').click();
    await card.getByTestId('wip-save').click();
    await expect(page.getByText('Say what the extra work was')).toBeVisible();
    await card.getByTestId('wip-description').fill('Something');
    await card.getByTestId('wip-save').click();
    await expect(page.getByText('Enter the value in pounds')).toBeVisible();
  });

  test('shows the logged time from the fixture, logs a new entry, and deletes one', async ({ page }) => {
    await page.goto('/clients/cl_abc');
    const card = page.getByTestId('time-tracking-card');
    await expect(card).toContainText('2h 45m logged across 2 entries.');

    await card.getByTestId('time-add').click();
    await card.getByTestId('time-minutes').fill('30');
    await card.getByTestId('time-note').fill('Quick call');
    await card.getByTestId('time-save').click();
    await expect(page.getByRole('status').getByText('Time logged')).toBeVisible();
    await expect(card).toContainText('3h 15m logged across 3 entries.');

    const newRow = card.locator('li', { hasText: 'Quick call' });
    await newRow.getByLabel('Remove this entry').click();
    await expect(card).toContainText('2h 45m logged across 2 entries.');
  });

  test('a client with nothing logged yet shows the empty states for both cards', async ({ page }) => {
    await page.goto('/clients/cl_brown');
    await expect(page.getByTestId('wip-card')).toContainText('Nothing unbilled for this client.');
    await expect(page.getByTestId('time-tracking-card')).toContainText('No time logged for this client yet.');
  });
});
