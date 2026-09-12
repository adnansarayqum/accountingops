import { expect, type Page } from '@playwright/test';
import { buildFixtureData } from '../src/testing/fixtures';
import { todayIso } from '../src/domain/dates';
import { SCHEMA_VERSION } from '../src/application/persistence/repository';

export const STORAGE_KEY = 'practiceops.data';

/**
 * Seed the app's storage with the same rich fixture dataset the unit tests
 * use, then load the app. A real practice always starts empty (no demo
 * mode), so e2e scenarios that need existing clients/jobs/history inject
 * this fixture directly into localStorage before the app boots, exactly as
 * a returning user's previously-saved data would be loaded.
 */
export async function seedFixture(page: Page, adjust?: (data: ReturnType<typeof buildFixtureData>) => void): Promise<void> {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.goto('/');
  const data = buildFixtureData(todayIso());
  adjust?.(data);
  const envelope = { version: SCHEMA_VERSION, savedAt: new Date().toISOString(), data };
  await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: STORAGE_KEY, value: envelope });
  await page.reload();
  // The dashboard's own heading is a time-of-day greeting, so the readiness
  // signal is the page itself rather than a string that changes at noon.
  await expect(page.getByTestId('dashboard')).toBeVisible();
}
