import { expect, test } from '@playwright/test';
import { seedFixture } from './fixtures';

/**
 * Documents shared into the app, as Smart Inbox shows them. Seeded straight
 * into the stored snapshot — the polling that puts them there needs the
 * server's shared intake, which the browser-only build doesn't have.
 */
test.describe('Smart Inbox — documents shared from the phone', () => {
  test.beforeEach(async ({ page }) => {
    await seedFixture(page, (data) => {
      data.inboxItems.push({
        id: 'inbox_share_1',
        practiceId: data.practice.id,
        fileName: 'IMG_0001.jpg (+1 more page)',
        receivedAt: new Date().toISOString(),
        source: 'share',
        sender: 'Shared from phone',
        sizeKb: 640,
        intakeUploadIds: ['inu_a', 'inu_b'],
        summary: 'Barclays business statement, January 2026',
        status: 'pending',
        suggestion: { clientId: 'cl_abc', documentType: 'Bank statement', confidence: 0.6, rationale: 'Account name partly matches.' },
      });
    });
    await page.goto('/inbox');
  });

  test('shows what the AI read, who shared it, and a link to every page', async ({ page }) => {
    const card = page.getByTestId('inbox-inbox_share_1');
    await expect(card.getByTestId('inbox-summary-inbox_share_1')).toHaveText('Barclays business statement, January 2026');
    await expect(card).toContainText('Shared from phone');
    const links = card.getByTestId('view-files-inbox_share_1').getByRole('link');
    await expect(links).toHaveText(['Page 1', 'Page 2']);
    await expect(links.nth(0)).toHaveAttribute('href', '/api/intake/uploads/inu_a');
    await expect(links.nth(1)).toHaveAttribute('href', '/api/intake/uploads/inu_b');
    await expect(links.nth(0)).toHaveAttribute('target', '_blank');
  });

  test('confirming the suggested client attaches it, still linked to its pages', async ({ page }) => {
    await page.getByTestId('confirm-inbox_share_1').click();
    await expect(page.getByTestId('inbox-inbox_share_1')).toHaveCount(0);
    await page.getByRole('tab', { name: /Processed/ }).click();
    await expect(page.getByTestId('view-files-inbox_share_1').getByRole('link')).toHaveCount(2);
  });
});
