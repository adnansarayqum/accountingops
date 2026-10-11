import { expect, test } from '@playwright/test';
import { buildFixtureData } from '../src/testing/fixtures';
import { todayIso } from '../src/domain/dates';

/**
 * Choosing which addresses may forward email in, from Settings, in a real
 * browser. The server is mocked (signed-in mode needs a database the
 * preview build doesn't have); the webhook and the store are covered by
 * server/routes/__tests__/intake.test.mjs and intakeSenders.db.test.mjs.
 */
test('Settings shows the address to forward to and saves the addresses it is accepted from', async ({ page }) => {
  const data = buildFixtureData(todayIso());
  let senders: string[] = [];
  const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.route('**/health', (r) => r.fulfill(json({ ok: true, database: true, databaseReachable: true })));
  await page.route('**/api/auth/me', (r) => r.fulfill(json({ user: { id: 'u_adnan', username: 'adnan', name: 'Adnan Sarayqum', role: 'owner', mustChangePassword: false, permissions: [] } })));
  await page.route('**/api/practice-data', (r) => (r.request().method() === 'GET' ? r.fulfill(json({ data, version: 1 })) : r.fulfill(json({ version: 2 }))));
  await page.route('**/api/intake/status', (r) => r.fulfill(json({ configured: true })));
  await page.route('**/api/intake/activity', (r) => r.fulfill(json({ activity: [] })));
  await page.route('**/api/intake/tokens', (r) => r.fulfill(json({ tokens: [] })));
  await page.route('**/api/intake/email', (r) => r.fulfill(json({ address: 'abc123@inbound.example.com', ready: true, senders, maxSenders: 5 })));
  await page.route('**/api/intake/email/senders', async (r) => {
    const body = r.request().postDataJSON() as { senders: string[] };
    if (body.senders.includes('taken@example.com')) return r.fulfill(json({ error: 'taken', email: 'taken@example.com' }, 409));
    senders = body.senders.map((s) => s.toLowerCase());
    return r.fulfill(json({ senders }));
  });

  await page.goto('/settings');
  const card = page.getByTestId('forward-email');
  await expect(card.getByTestId('forward-email-address')).toHaveText('abc123@inbound.example.com');

  await card.getByTestId('forward-email-senders').fill('taken@example.com');
  await card.getByTestId('forward-email-save').click();
  await expect(page.getByText('taken@example.com is already used by someone else.')).toBeVisible();

  await card.getByTestId('forward-email-senders').fill('Ray@Example.com, ray@work.co.uk');
  await card.getByTestId('forward-email-save').click();
  await expect(card.getByTestId('forward-email-senders')).toHaveValue('ray@example.com, ray@work.co.uk');

  await page.reload();
  await expect(page.getByTestId('forward-email').getByTestId('forward-email-senders')).toHaveValue('ray@example.com, ray@work.co.uk');
});
