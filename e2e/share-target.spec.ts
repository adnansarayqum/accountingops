import { expect, test, type Page } from '@playwright/test';
import { buildFixtureData } from '../src/testing/fixtures';
import { todayIso } from '../src/domain/dates';

/**
 * Sharing into the installed app, end to end in a real browser: the real
 * service worker (public/sw.js) catches a multipart POST to /share-target —
 * exactly what Android sends when "F&R Ops" is picked in WhatsApp's share
 * sheet — parks the files and opens /share, which sends them on and lets
 * the client be corrected. The server side is mocked (signed-in mode needs
 * a database the preview build doesn't have); its real behaviour is covered
 * by server/routes/__tests__/intake.test.mjs.
 */

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n');

interface Captured {
  batch: { files: { fileName: string; contentType: string; contentBase64: string }[]; text: string } | null;
  assigns: { id: string; clientId: string | null }[];
  released: string[];
}

async function signedInWithIntake(page: Page): Promise<Captured> {
  const captured: Captured = { batch: null, assigns: [], released: [] };
  const data = buildFixtureData(todayIso());
  const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.route('**/health', (r) => r.fulfill(json({ ok: true, database: true, databaseReachable: true })));
  await page.route('**/api/auth/me', (r) => r.fulfill(json({ user: { id: 'u_adnan', username: 'adnan', name: 'Adnan Sarayqum', role: 'owner', mustChangePassword: false } })));
  await page.route('**/api/practice-data', (r) => (r.request().method() === 'GET' ? r.fulfill(json({ data, version: 1 })) : r.fulfill(json({ version: 2 }))));
  await page.route('**/api/intake/status', (r) => r.fulfill(json({ configured: true })));
  await page.route('**/api/intake/activity', (r) => r.fulfill(json({ activity: [] })));
  await page.route('**/api/intake/batches', async (r) => {
    captured.batch = r.request().postDataJSON();
    await r.fulfill(
      json(
        {
          batchId: 'inb_test',
          read: true,
          documents: [
            { id: 'ina_1', fileName: 'statement-p1.jpg (+1 more page)', uploadIds: ['inu_1', 'inu_2'], filed: true, clientId: 'cl_abc', clientName: 'ABC Ltd', candidates: [], documentType: 'Bank statement', summary: 'Barclays statement, March', confidence: 0.95, rationale: 'Account name matches.' },
            { id: 'ina_2', fileName: 'Shared text.txt', uploadIds: ['inu_3'], filed: false, clientId: 'cl_khan', clientName: 'Khan Consulting', candidates: [{ id: 'cl_khan', name: 'Khan Consulting' }], documentType: 'Message from the client', summary: 'New address for the director', confidence: 0.5, rationale: 'Name partly matches.' },
          ],
        },
        201,
      ),
    );
  });
  await page.route('**/api/intake/activity/*/assign', async (r) => {
    const id = r.request().url().split('/activity/')[1].split('/')[0];
    captured.assigns.push({ id, clientId: r.request().postDataJSON().clientId });
    await r.fulfill(json({ ok: true }));
  });
  await page.route('**/api/intake/batches/*/release', async (r) => {
    captured.released.push(r.request().url().split('/batches/')[1].split('/')[0]);
    await r.fulfill(json({ released: 2 }));
  });
  return captured;
}

/** Waits until public/sw.js is installed and controlling the page — what an installed app has from its first launch. */
async function waitForServiceWorker(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
  });
}

/** Does what Android does when the app is chosen in a share sheet: a multipart form POST to the manifest's share_target action. */
async function shareInto(page: Page, text: string) {
  await page.evaluate((sharedText) => {
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = '/share-target';
    form.enctype = 'multipart/form-data';
    form.innerHTML = '<input type="file" name="files" multiple /><input name="text" />';
    (form.querySelector('input[name="text"]') as HTMLInputElement).value = sharedText;
    form.id = 'fake-share-sheet';
    document.body.appendChild(form);
  }, text);
  await page.setInputFiles('#fake-share-sheet input[type="file"]', [
    { name: 'statement-p1.jpg', mimeType: 'image/jpeg', buffer: JPEG },
    { name: 'statement-p2.pdf', mimeType: 'application/pdf', buffer: PDF },
    { name: 'voice-note.opus', mimeType: 'audio/ogg', buffer: Buffer.from('OggS') },
  ]);
  await page.evaluate(() => (document.getElementById('fake-share-sheet') as HTMLFormElement).submit());
}

test.describe('sharing into the installed app', () => {
  test('the manifest offers the app as a share target, with icons that install', async ({ request }) => {
    const manifest = await (await request.get('/manifest.webmanifest')).json();
    expect(manifest).toMatchObject({ display: 'standalone', start_url: '/', share_target: { action: '/share-target', method: 'POST', enctype: 'multipart/form-data' } });
    for (const icon of manifest.icons) expect((await request.get(icon.src)).status()).toBe(200);
  });

  test('a share from another app lands on the share screen, is sent on, and can be corrected before it is filed', async ({ page }) => {
    const captured = await signedInWithIntake(page);
    await page.goto('/');
    await expect(page.getByTestId('dashboard')).toBeVisible();
    await waitForServiceWorker(page);

    await shareInto(page, 'Hi, my new address is 1 High Street');
    await expect(page).toHaveURL(/\/share\?id=/);
    await expect(page.getByTestId('share-documents')).toBeVisible();

    // What reached the server: the two readable files byte for byte, the text, and not the voice note.
    expect(captured.batch!.files.map((f) => [f.fileName, f.contentType])).toEqual([
      ['statement-p1.jpg', 'image/jpeg'],
      ['statement-p2.pdf', 'application/pdf'],
    ]);
    expect(Buffer.from(captured.batch!.files[0].contentBase64, 'base64').equals(JPEG)).toBe(true);
    expect(Buffer.from(captured.batch!.files[1].contentBase64, 'base64').equals(PDF)).toBe(true);
    expect(captured.batch!.text).toBe('Hi, my new address is 1 High Street');
    await expect(page.getByText('Left out (not a photo, PDF or text): voice-note.opus')).toBeVisible();

    await expect(page.getByTestId('share-doc-status-ina_1')).toHaveText('Filing under ABC Ltd.');
    await expect(page.getByTestId('share-doc-status-ina_2')).toHaveText('Best guess: Khan Consulting — confirm or change it.');

    await page.locator('#share-client-ina_2').selectOption('cl_khan');
    await expect(page.getByTestId('share-doc-status-ina_2')).toHaveText('Filing under Khan Consulting Ltd.');
    expect(captured.assigns).toEqual([{ id: 'ina_2', clientId: 'cl_khan' }]);

    await page.getByTestId('share-done').click();
    await expect(page).toHaveURL(/\/inbox$/);
    expect(captured.released).toEqual(['inb_test']);

    // Nothing is left parked once the server has it.
    const parked = await page.evaluate(async () => (await (await caches.open('shared-into-app')).keys()).length);
    expect(parked).toBe(0);
  });

  test('Settings explains how to install the app on Android and iPhone', async ({ page }) => {
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await page.goto('/settings');
    const card = page.getByTestId('install-app');
    await expect(card).toContainText('Install app');
    await expect(card).toContainText('Add to Home Screen');
  });

  test('opening the share screen with nothing shared explains how to share in', async ({ page }) => {
    await signedInWithIntake(page);
    await page.goto('/share');
    await expect(page.getByText('Nothing to send')).toBeVisible();
  });

  test('in the browser-only version, the share screen says sharing needs the online version', async ({ page }) => {
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await page.goto('/share?id=whatever');
    await expect(page.getByText('Sharing needs the online version')).toBeVisible();
  });
});
