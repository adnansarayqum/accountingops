import { expect, test, type Page } from '@playwright/test';
import { seedFixture } from './fixtures';

/**
 * The client portal, both sides. The server half needs a database, which
 * the e2e build runs without, so these stub the routes and assert the seam:
 * what the client sees and can do, and what the practice sees come back.
 */

const TOKEN = 'A'.repeat(43);

const uploadView = {
  practiceName: 'Farhan & Raihan',
  clientName: 'ABC Construction Ltd',
  jobName: '2025 Annual Accounts',
  periodEnd: '2025-03-31',
  dueDate: '2025-12-31',
  purpose: 'upload',
  outstanding: [
    { id: 'req_1', label: 'Loan statement' },
    { id: 'req_2', label: 'Director expenses' },
  ],
  approvalPending: false,
  message: 'Just these two and we can finish.',
  hasAttachment: false,
  expiresAt: '2026-10-12T00:00:00.000Z',
};

async function stubPublic(page: Page, view: typeof uploadView | null) {
  await page.route(`**/api/portal/p/${TOKEN}`, (r) => (view ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(view) }) : r.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not_found"}' })));
}

test.describe('client portal — the client’s side', () => {
  test('shows one job, the outstanding items, the accountant’s note, and nothing else', async ({ page }) => {
    await stubPublic(page, uploadView);
    await page.goto(`/portal/${TOKEN}`);

    await expect(page.getByRole('heading', { name: 'ABC Construction Ltd' })).toBeVisible();
    await expect(page.getByText('Just these two and we can finish.')).toBeVisible();
    await expect(page.getByTestId('portal-outstanding').getByRole('listitem')).toHaveCount(2);
    // No app chrome: this is a page for someone with no account.
    await expect(page.getByRole('navigation')).toHaveCount(0);
    await expect(page.getByTestId('open-search')).toHaveCount(0);
  });

  test('uploads a file against the item it was asked for', async ({ page }) => {
    await stubPublic(page, uploadView);
    let posted: { requestItemId?: string; fileName?: string; contentType?: string } | null = null;
    await page.route(`**/api/portal/p/${TOKEN}/upload`, async (r) => {
      posted = r.request().postDataJSON();
      await r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true, uploadId: 'up_1', fileName: 'loan.pdf' }) });
    });
    await page.goto(`/portal/${TOKEN}`);

    await page.getByTestId('portal-file-req_1').setInputFiles({ name: 'loan.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test') });
    await expect(page.getByTestId('portal-item-req_1')).toContainText('Received: loan.pdf');
    expect(posted).toMatchObject({ requestItemId: 'req_1', fileName: 'loan.pdf', contentType: 'application/pdf' });
  });

  test('explains a refused file in plain English', async ({ page }) => {
    await stubPublic(page, uploadView);
    await page.route(`**/api/portal/p/${TOKEN}/upload`, (r) => r.fulfill({ status: 400, contentType: 'application/json', body: '{"error":"unsupported_type"}' }));
    await page.goto(`/portal/${TOKEN}`);
    await page.getByTestId('portal-file-req_1').setInputFiles({ name: 'app.exe', mimeType: 'application/x-msdownload', buffer: Buffer.from('MZ') });
    await expect(page.getByTestId('portal-item-req_1')).toContainText('not accepted');
  });

  test('records an approval with the client’s name, and says it can only happen once', async ({ page }) => {
    await stubPublic(page, { ...uploadView, purpose: 'approve', outstanding: [], approvalPending: true, hasAttachment: true, message: null });
    let posted: { decision?: string; name?: string; note?: string } | null = null;
    await page.route(`**/api/portal/p/${TOKEN}/approve`, async (r) => {
      posted = r.request().postDataJSON();
      await r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"decision":"approved"}' });
    });
    await page.goto(`/portal/${TOKEN}`);

    await expect(page.getByTestId('portal-attachment')).toBeVisible();
    // A name is required — the record has to say who approved.
    await page.getByTestId('portal-approve').click();
    await expect(page.getByText('Please enter your name.')).toBeVisible();
    expect(posted).toBeNull();

    await page.getByTestId('portal-name').fill('Dave Thompson');
    await page.getByTestId('portal-note').fill('Happy with these.');
    await page.getByTestId('portal-approve').click();
    await expect(page.getByTestId('portal-decided')).toContainText('your approval has been recorded');
    expect(posted).toEqual({ decision: 'approved', name: 'Dave Thompson', note: 'Happy with these.' });
  });

  test('a dead link says so without hinting why', async ({ page }) => {
    await stubPublic(page, null);
    await page.goto(`/portal/${TOKEN}`);
    await expect(page.getByRole('heading', { name: 'This link is no longer valid' })).toBeVisible();
  });
});

test.describe('client portal — the practice’s side', () => {
  test('creates a link, shows the URL once, and hides itself when the portal is not available', async ({ page }) => {
    await seedFixture(page);
    // Browser-only build: the portal reports itself off, so the card is absent.
    await page.goto('/jobs/job_abc_accounts');
    await expect(page.getByRole('heading', { name: '2025 Annual Accounts' })).toBeVisible();
    await expect(page.getByTestId('client-link-card')).toHaveCount(0);

    // Now with a server that has the portal.
    await page.route('**/api/portal/status', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"configured":true,"maxFileBytes":10485760}' }));
    const links: unknown[] = [];
    await page.route('**/api/portal/links?jobId=*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ links }) }));
    await page.route('**/api/portal/links', async (r) => {
      const body = r.request().postDataJSON();
      links.unshift({ id: 'pl_1', purpose: body.purpose, message: body.message ?? null, createdAt: new Date().toISOString(), expiresAt: '2026-10-12T00:00:00.000Z', usedAt: null, revokedAt: null, lastOpenedAt: null, state: 'live' });
      await r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: 'pl_1', url: `http://localhost:4173/portal/${TOKEN}` }) });
    });
    await page.route('**/api/portal/activity', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"activity":[]}' }));

    await page.goto('/jobs/job_abc_accounts');
    const card = page.getByTestId('client-link-card');
    await expect(card).toBeVisible();
    await card.getByTestId('link-message').fill('Just the loan statement please.');
    await card.getByTestId('create-upload-link').click();

    await expect(card.getByTestId('fresh-link-url')).toHaveValue(`http://localhost:4173/portal/${TOKEN}`);
    await expect(card.getByTestId('link-list')).toContainText('live');
  });

  test('pulls a client’s upload into the job through the ordinary receive action', async ({ page }) => {
    await seedFixture(page);
    // Request items get generated ids, so read the one for the loan statement off the page first.
    await page.goto('/jobs/job_abc_accounts');
    const loanRow = page.locator('[data-testid="document-checklist"] li', { hasText: 'Loan statement' });
    const receiveId = await loanRow.getByTestId(/^receive-/).getAttribute('data-testid');
    const requestItemId = receiveId!.replace('receive-', '');

    await page.route('**/api/portal/status', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"configured":true,"maxFileBytes":10485760}' }));
    await page.route('**/api/portal/links?jobId=*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"links":[]}' }));
    let pending = [
      { id: 'pa_1', linkId: 'pl_1', clientId: 'cl_abc', jobId: 'job_abc_accounts', kind: 'upload', requestItemId, uploadId: 'up_1', fileName: 'loan-statement.pdf', sizeKb: 88, decision: null, actorName: null, note: null, createdAt: new Date().toISOString() },
    ];
    await page.route('**/api/portal/activity', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ activity: pending }) }));
    await page.route('**/api/portal/activity/ack', async (r) => {
      pending = [];
      await r.fulfill({ status: 200, contentType: 'application/json', body: '{"applied":1}' });
    });

    await page.reload();
    await expect(page.getByText('From your clients')).toBeVisible({ timeout: 15_000 });
    await expect(loanRow).toHaveAttribute('data-status', 'received');
    await expect(loanRow).toContainText('Received');
  });
});
