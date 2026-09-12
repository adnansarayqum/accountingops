import { expect, test } from '@playwright/test';
import { seedFixture } from './fixtures';

/** AML reviews and the VAT threshold watch: recorded on the client, surfaced on Readiness. */
test.describe('AML review and VAT threshold watch', () => {
  test.beforeEach(async ({ page }) => {
    await seedFixture(page);
  });

  test('a client with no rating is listed as never reviewed until a review is recorded', async ({ page }) => {
    await page.goto('/readiness');
    await page.getByRole('tab', { name: /AML & VAT threshold/ }).click();
    const row = page.getByTestId('aml-row-cl_abc');
    await expect(row).toContainText('Never reviewed');

    await page.goto('/clients/cl_abc');
    const card = page.getByTestId('aml-review-card');
    await expect(card).toContainText('Never reviewed');
    await card.getByTestId('aml-open').click();
    await card.getByTestId('aml-rating').selectOption('high');
    await card.getByTestId('aml-note').fill('Cash-heavy trade.');
    await card.getByTestId('aml-record').click();

    await expect(page.getByText('AML review recorded')).toBeVisible();
    await expect(card).toContainText('High risk');
    await expect(card).toContainText('Current');
    await expect(card).toContainText('“Cash-heavy trade.”');

    // Off the Readiness list now — and still off it after a reload.
    await page.reload();
    await page.goto('/readiness');
    await page.getByRole('tab', { name: /AML & VAT threshold/ }).click();
    await expect(page.getByTestId('aml-row-cl_abc')).toHaveCount(0);
  });

  test('recording turnover near the threshold flags the client on Readiness with the headroom in pounds', async ({ page }) => {
    // Sarah Malik is a sole trader with no VAT number in the fixture, so the watch applies.
    await page.goto('/clients/cl_malik');
    const card = page.getByTestId('turnover-card');
    await expect(card).toContainText('No turnover on file');
    await card.getByTestId('turnover-input').fill('£82,500');
    await card.getByTestId('turnover-save').click();
    await expect(page.getByText('Turnover recorded')).toBeVisible();
    await expect(card).toContainText('Approaching threshold');
    await expect(card).toContainText('£7,500 below the £90,000 threshold');

    await page.goto('/readiness');
    await page.getByRole('tab', { name: /AML & VAT threshold/ }).click();
    const row = page.getByTestId('vat-row-cl_malik');
    await expect(row).toContainText('£82,500');
    await expect(row).toContainText('£7,500 to go');
  });

  test('a VAT-registered client is not watched at all', async ({ page }) => {
    // ABC has a VAT number in the fixture.
    await page.goto('/clients/cl_abc');
    await expect(page.getByTestId('turnover-card')).toHaveCount(0);
  });
});
