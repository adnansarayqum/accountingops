import { expect, test, type Page } from '@playwright/test';
import { seedFixture } from './fixtures';

/**
 * The live Companies House feed surfacing on the Clients page. The stream
 * itself is held by the server (the key must never reach the browser), so
 * these tests stub the endpoints the page reads and assert the seam: what
 * it shows, what it does when you pull a change in, and that nothing is
 * applied until you ask.
 */

const ABC_COMPANY_NUMBER = '09876543';

async function stubStream(page: Page, changes: unknown[], { configured = true } = {}) {
  await page.route('**/api/companies-house/stream/status', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ configured }) }));
  let pending = [...changes];
  await page.route('**/api/companies-house/stream/changes', (r) => {
    if (r.request().method() === 'POST') return r.fallback();
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ changes: pending, pending: pending.length, connectedAt: new Date().toISOString(), lastEventAt: null, lastError: null }) });
  });
  await page.route('**/api/companies-house/stream/changes/ack', (r) => {
    const acknowledged = pending.length;
    pending = [];
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ acknowledged }) });
  });
}

/** A live-looking profile, so "pull in" takes the real path rather than falling back to sample data. */
async function stubCompanyLookup(page: Page, postalCode: string) {
  await page.route(`**/api/companies-house/company/${ABC_COMPANY_NUMBER}`, (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        companyNumber: ABC_COMPANY_NUMBER,
        companyName: 'ABC Construction Ltd',
        companyStatus: 'active',
        registeredOfficeAddress: { addressLine1: '1 New Register Street', locality: 'Manchester', postalCode, formatted: `1 New Register Street, Manchester, ${postalCode}` },
        companyType: 'ltd',
        dateOfCreation: '2015-04-01',
        sicCodes: ['41201'],
        previousNames: [],
        accountingReferenceDate: { day: '31', month: '03' },
        nextAccountsDueOn: '2027-12-31',
        nextAccountsPeriodEndOn: '2027-03-31',
        nextConfirmationStatementDueOn: '2027-04-14',
        source: 'companies_house',
      }),
    }),
  );
  await page.route(`**/api/companies-house/company/${ABC_COMPANY_NUMBER}/people`, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ directors: [], pscs: [], source: 'companies_house' }) }));
}

const change = (companyNumber: string, fieldsChanged: string[], type: 'changed' | 'deleted' = 'changed') => ({
  companyNumber,
  type,
  fieldsChanged,
  publishedAt: '2026-09-12T10:00:00',
  seenAt: new Date().toISOString(),
});

test.describe('Companies House live feed', () => {
  test('lists what changed in plain English against the client it belongs to', async ({ page }) => {
    await seedFixture(page);
    await stubStream(page, [change(ABC_COMPANY_NUMBER, ['accounts.next_due'])]);
    await page.goto('/clients');

    const card = page.getByTestId('companies-house-changes');
    await expect(card).toBeVisible();
    const row = card.getByTestId(`ch-change-${ABC_COMPANY_NUMBER}`);
    // The company number resolves to the practice's own name for it, and the
    // dot-notation field path is translated into what an accountant acts on.
    await expect(row).toContainText('ABC Construction Ltd');
    await expect(row).toContainText('accounts deadline changed');
    await expect(row).not.toContainText('accounts.next_due');
  });

  test('applies nothing until asked, then pulls the change into the client record', async ({ page }) => {
    await seedFixture(page);
    await stubStream(page, [change(ABC_COMPANY_NUMBER, ['registered_office_address'])]);
    await stubCompanyLookup(page, 'M1 9NEW');

    // Before: the feed says the office moved, but the client record has not.
    await page.goto('/clients/cl_abc');
    await expect(page.getByText('M1 9NEW')).toHaveCount(0);

    await page.goto('/clients');
    const card = page.getByTestId('companies-house-changes');
    await card.getByTestId('pull-in-companies-house-changes').click();
    await expect(page.getByText('Pulled in the changes')).toBeVisible();
    // Cleared once handled, so the same change isn't offered twice.
    await expect(card).toHaveCount(0);

    await page.goto('/clients/cl_abc');
    await expect(page.getByText('M1 9NEW').first()).toBeVisible();
  });

  test('dismissing clears the feed without touching client data', async ({ page }) => {
    await seedFixture(page);
    await stubStream(page, [change(ABC_COMPANY_NUMBER, ['registered_office_address'])]);
    await stubCompanyLookup(page, 'NEVER 1AP');

    await page.goto('/clients');
    await page.getByTestId('companies-house-changes').getByRole('button', { name: 'Dismiss' }).click();
    await expect(page.getByTestId('companies-house-changes')).toHaveCount(0);

    // Dismiss clears the notice only — it must never write the change through.
    await page.goto('/clients/cl_abc');
    await expect(page.getByText('NEVER 1AP')).toHaveCount(0);
  });

  test('shows a company the practice no longer holds by its number rather than hiding it', async ({ page }) => {
    await seedFixture(page);
    await stubStream(page, [change('99999999', [], 'deleted')]);
    await page.goto('/clients');

    const row = page.getByTestId('companies-house-changes').getByTestId('ch-change-99999999');
    await expect(row).toContainText('99999999');
    await expect(row).toContainText('removed from the register');
  });

  test('stays hidden when the feed is not configured — which is the whole browser-only mode', async ({ page }) => {
    await seedFixture(page);
    await stubStream(page, [change(ABC_COMPANY_NUMBER, ['accounts.next_due'])], { configured: false });
    await page.goto('/clients');

    await expect(page.getByRole('heading', { name: 'Clients' })).toBeVisible();
    await expect(page.getByTestId('companies-house-changes')).toHaveCount(0);
  });
});
