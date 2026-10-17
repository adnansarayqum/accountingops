import { expect, test } from '@playwright/test';
import { buildFixtureData } from '../src/testing/fixtures';
import { todayIso } from '../src/domain/dates';

/**
 * Adding a document from inside the app, in a real browser: the header's
 * camera button, a photographed page (the camera input is given a file the
 * way a phone's camera would), and the same share page a share from WhatsApp
 * lands on. The server is mocked (signed-in mode needs a database the
 * preview build doesn't have); the server side is covered by
 * server/routes/__tests__/intake.test.mjs.
 */
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

test('photograph a letter from the app header: it is sent, read and shown for checking', async ({ page }) => {
  const data = buildFixtureData(todayIso());
  let batch: { files: { fileName: string; contentType: string }[]; text: string } | null = null;
  const assigns: { id: string; clientId: string | null }[] = [];
  const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.route('**/health', (r) => r.fulfill(json({ ok: true, database: true, databaseReachable: true })));
  await page.route('**/api/auth/me', (r) => r.fulfill(json({ user: { id: 'u_adnan', username: 'adnan', name: 'Adnan Sarayqum', role: 'owner', mustChangePassword: false, permissions: [] } })));
  await page.route('**/api/practice-data', (r) => (r.request().method() === 'GET' ? r.fulfill(json({ data, version: 1 })) : r.fulfill(json({ version: 2 }))));
  await page.route('**/api/intake/status', (r) => r.fulfill(json({ configured: true })));
  await page.route('**/api/intake/activity', (r) => r.fulfill(json({ activity: [] })));
  await page.route('**/api/intake/batches', async (r) => {
    batch = r.request().postDataJSON();
    await r.fulfill(
      json(
        {
          batchId: 'inb_test',
          read: true,
          documents: [{ id: 'ina_1', fileName: 'letter.jpg', uploadIds: ['inu_1'], filed: true, clientId: 'cl_abc', clientName: 'ABC Construction Ltd', candidates: [], documentType: 'Penalty notice', summary: 'HMRC late filing penalty', confidence: 0.95, rationale: 'UTR matches.' }],
        },
        201,
      ),
    );
  });
  await page.route('**/api/intake/activity/*/assign', async (r) => {
    assigns.push({ id: r.request().url().split('/activity/')[1].split('/')[0], clientId: r.request().postDataJSON().clientId });
    await r.fulfill(json({ ok: true }));
  });
  await page.route('**/api/intake/batches/*/release', (r) => r.fulfill(json({ released: 1 })));

  await page.goto('/');
  await expect(page.getByTestId('dashboard')).toBeVisible();
  await page.getByTestId('add-document-open').click();

  // Nothing can be sent until a page has been added; the camera input asks for the back camera.
  await expect(page.getByTestId('add-document-send')).toBeDisabled();
  await expect(page.getByTestId('add-document-camera-input')).toHaveAttribute('capture', 'environment');
  await page.getByTestId('add-document-camera-input').setInputFiles({ name: 'letter.jpg', mimeType: 'image/jpeg', buffer: JPEG });
  await expect(page.getByTestId('add-document-page-0')).toBeVisible();
  await page.getByTestId('add-document-send').click();

  // The same share page a share from WhatsApp lands on.
  await expect(page).toHaveURL(/\/share\?id=app_/);
  await expect(page.getByTestId('share-documents')).toBeVisible();
  await expect(page.getByTestId('share-doc-status-ina_1')).toContainText('Filing under ABC Construction Ltd');
  expect(batch).toMatchObject({ files: [{ fileName: 'letter.jpg', contentType: 'image/jpeg' }], text: '' });

  // The client can still be changed, and Done goes to Smart Inbox.
  await page.locator('#share-client-ina_1').selectOption('cl_khan');
  await expect.poll(() => assigns).toEqual([{ id: 'ina_1', clientId: 'cl_khan' }]);
  await page.getByTestId('share-done').click();
  await expect(page).toHaveURL(/\/inbox$/);
});

test('the button is not offered in the browser-only version, where nothing could read the document', async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.goto('/');
  await expect(page.getByTestId('open-search')).toBeVisible();
  await expect(page.getByTestId('add-document-open')).toHaveCount(0);
});
