import { expect, test } from '@playwright/test';
import { buildFixtureData } from '../src/testing/fixtures';
import { todayIso } from '../src/domain/dates';

/**
 * Making and removing an iPhone upload key from Settings, in a real
 * browser. The server is mocked (signed-in mode needs a database the
 * preview build doesn't have); the key store itself is covered by
 * server/routes/__tests__/intake.test.mjs and intakeTokens.db.test.mjs.
 */
test('Settings makes an upload key once, lists it without the secret, and removes it', async ({ page }) => {
  const data = buildFixtureData(todayIso());
  const keys: { id: string; label: string; createdAt: string; lastUsedAt: string | null }[] = [];
  const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.route('**/health', (r) => r.fulfill(json({ ok: true, database: true, databaseReachable: true })));
  await page.route('**/api/auth/me', (r) => r.fulfill(json({ user: { id: 'u_adnan', username: 'adnan', name: 'Adnan Sarayqum', role: 'owner', mustChangePassword: false, permissions: [] } })));
  await page.route('**/api/practice-data', (r) => (r.request().method() === 'GET' ? r.fulfill(json({ data, version: 1 })) : r.fulfill(json({ version: 2 }))));
  await page.route('**/api/intake/status', (r) => r.fulfill(json({ configured: true })));
  await page.route('**/api/intake/activity', (r) => r.fulfill(json({ activity: [] })));
  await page.route('**/api/intake/tokens', async (r) => {
    if (r.request().method() === 'GET') return r.fulfill(json({ tokens: keys }));
    const { label } = r.request().postDataJSON() as { label: string };
    const made = { id: `ink_${keys.length + 1}`, label: label || 'iPhone', createdAt: new Date().toISOString(), lastUsedAt: null };
    keys.unshift(made);
    return r.fulfill(json({ ...made, token: 'frk_e2e_secret_key' }, 201));
  });
  await page.route('**/api/intake/tokens/*', async (r) => {
    keys.length = 0;
    await r.fulfill(json({ ok: true }));
  });

  await page.goto('/settings');
  const card = page.getByTestId('upload-keys');
  await expect(card).toBeVisible();

  await card.getByTestId('upload-key-label').fill('Ray’s iPhone');
  await card.getByTestId('upload-key-make').click();
  await expect(card.getByTestId('upload-key-token')).toHaveText('frk_e2e_secret_key');
  await expect(card.getByTestId('upload-key-list')).toContainText('Ray’s iPhone');
  await expect(card.getByTestId('upload-key-list')).not.toContainText('frk_e2e_secret_key');
  await expect(card.getByTestId('upload-key-url')).toContainText('/api/intake/batches');

  await card.getByRole('button', { name: 'Remove Ray’s iPhone' }).click();
  await expect(card.getByTestId('upload-key-list')).toHaveCount(0);
});
