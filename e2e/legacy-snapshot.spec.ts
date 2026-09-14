import { expect, test } from '@playwright/test';
import { seedFixture } from './fixtures';

/**
 * Regression: a practice's data saved before a newer collection existed
 * (wipEntries and timeEntries, in this case) genuinely won't have it —
 * that's expected, not corruption. Opening a client page assumed it was
 * always an array and crashed with "Cannot read properties of undefined
 * (reading 'filter')", caught by the app's ErrorBoundary. This drives the
 * exact same click a real, already-saved practice would make.
 */
test.describe('a snapshot saved before the newest collections existed', () => {
  test('opens a client page without crashing, and the new cards read as empty rather than missing', async ({ page }) => {
    await seedFixture(page, (data) => {
      // Simulates a real pre-existing snapshot: the type system says these
      // are always present, but an old save genuinely won't have them.
      delete (data as { wipEntries?: unknown }).wipEntries;
      delete (data as { timeEntries?: unknown }).timeEntries;
    });

    await page.goto('/clients/cl_abc');
    await expect(page.getByText('Something went wrong on this screen')).toHaveCount(0);
    await expect(page.getByTestId('wip-card')).toContainText('Nothing unbilled for this client.');
    await expect(page.getByTestId('time-tracking-card')).toContainText('No time logged for this client yet.');
  });
});
