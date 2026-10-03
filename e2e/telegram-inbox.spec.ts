import { expect, test } from '@playwright/test';
import { seedFixture } from './fixtures';

/**
 * Letters that arrived from the Telegram bot, as Smart Inbox shows them.
 * Seeded straight into the stored snapshot — the polling that puts them
 * there needs a server-side bot, which the browser-only build doesn't have.
 */
test.describe('Smart Inbox — letters from Telegram', () => {
  test.beforeEach(async ({ page }) => {
    await seedFixture(page, (data) => {
      const now = new Date().toISOString();
      data.inboxItems.push(
        {
          id: 'inbox_tg_waiting',
          practiceId: data.practice.id,
          fileName: 'telegram-waiting.jpg',
          receivedAt: now,
          source: 'telegram',
          sender: 'Telegram',
          sizeKb: 240,
          telegramUploadId: 'tgu_waiting',
          status: 'pending',
          suggestion: { documentType: 'Penalty notice', confidence: 0, rationale: 'Left to sort in Smart Inbox.' },
        },
        {
          id: 'inbox_tg_filed',
          practiceId: data.practice.id,
          fileName: 'telegram-filed.jpg',
          receivedAt: now,
          source: 'telegram',
          sender: 'Telegram',
          sizeKb: 180,
          telegramUploadId: 'tgu_filed',
          status: 'confirmed',
          resolvedAt: now,
          suggestion: { clientId: 'cl_abc', documentType: 'VAT notice', confidence: 0.95, rationale: 'VAT number matches.' },
        },
      );
    });
    await page.goto('/inbox');
  });

  test('a waiting letter links to its photo and needs a client before it can be attached', async ({ page }) => {
    const card = page.getByTestId('inbox-inbox_tg_waiting');
    await expect(card).toContainText('Telegram');
    const link = card.getByTestId('view-photo-inbox_tg_waiting');
    await expect(link).toHaveAttribute('href', '/api/telegram/uploads/tgu_waiting');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(card.getByTestId('confirm-inbox_tg_waiting')).toBeDisabled();

    // Items from other sources have no photo link.
    const others = page.getByTestId('inbox-list').locator('[data-testid^="inbox-"]:not([data-testid="inbox-inbox_tg_waiting"])');
    expect(await others.count()).toBeGreaterThan(0);
    await expect(page.getByTestId('inbox-list').getByText('View photo')).toHaveCount(1);
  });

  test('choosing a client and confirming attaches it, still linked to the photo', async ({ page }) => {
    const card = page.getByTestId('inbox-inbox_tg_waiting');
    await card.getByRole('button', { name: 'Change' }).click();
    await card.locator('#cl-inbox_tg_waiting').selectOption('cl_khan');
    await card.getByTestId('confirm-inbox_tg_waiting').click();
    await expect(page.getByTestId('inbox-inbox_tg_waiting')).toHaveCount(0);

    await page.getByRole('tab', { name: /Processed/ }).click();
    await expect(page.getByTestId('view-photo-inbox_tg_waiting')).toHaveAttribute('href', '/api/telegram/uploads/tgu_waiting');
    await expect(page.getByTestId('view-photo-inbox_tg_filed')).toHaveAttribute('href', '/api/telegram/uploads/tgu_filed');
  });
});
