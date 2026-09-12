import { expect, test } from '@playwright/test';
import { seedFixture } from './fixtures';

test.describe('refresh from Companies House', () => {
  test.beforeEach(async ({ page }) => {
    await seedFixture(page);
  });

  test('pulls fresh company details and adds a new director without duplicating an existing one', async ({ page }) => {
    await page.route('**/api/companies-house/status', (route) => route.fulfill({ json: { configured: true } }));
    await page.route('**/api/companies-house/company/09876543', (route) =>
      route.fulfill({
        json: {
          companyNumber: '09876543',
          companyName: 'ABC Construction Ltd',
          companyStatus: 'active',
          companyType: 'ltd',
          dateOfCreation: '2012-04-01',
          sicCodes: ['41202'],
          previousNames: ['ABC BUILDERS LTD'],
          registeredOfficeAddress: { formatted: '9 Refreshed Yard, Manchester, M1 2AB' },
          accountingReferenceDate: { day: '31', month: '03' },
          nextAccountsDueOn: '2027-12-31',
          nextAccountsPeriodEndOn: '2027-03-31',
          nextConfirmationStatementDueOn: '2027-02-01',
          source: 'companies_house',
        },
      }),
    );
    await page.route('**/api/companies-house/company/09876543/people', (route) =>
      route.fulfill({
        json: {
          // Dave Thompson already exists as a director+PSC on this client in the fixture —
          // refreshing must not create a duplicate for him.
          // Companies House has set a date for Dave's verification statement — shown on Readiness as what the register says.
          directors: [{ name: 'Dave Thompson', role: 'director', appointedOn: '2012-04-01', dateOfBirth: { month: '4', year: '1978' }, nationality: 'British', occupation: 'Director', naturesOfControl: [], identityVerification: { verifiedOn: null, statementDueOn: '2026-09-28', verifiedBy: null } }],
          pscs: [
            // Companies House already records this person as verified — the app must pick that up rather than
            // flag them as needing verification.
            { name: 'Newly Appointed Person', role: 'psc', appointedOn: '2026-01-01', dateOfBirth: { month: '1', year: '1990' }, nationality: 'British', occupation: null, naturesOfControl: ['Owns 25-50% of shares'], identityVerification: { verifiedOn: '2026-03-04', statementDueOn: null, verifiedBy: null } },
          ],
          source: 'companies_house',
        },
      }),
    );

    await page.goto('/clients/cl_abc');
    await expect(page.getByRole('heading', { name: 'ABC Construction Ltd' })).toBeVisible();

    await page.getByTestId('refresh-companies-house').click();
    await expect(page.getByText('Refreshed from Companies House')).toBeVisible();

    // Asserted as an outcome rather than by counting what this particular click added:
    // the background sync also refreshes stale clients, so it may have already pulled
    // the same data in. Either way the result on screen must be the same.
    await expect(page.getByText('9 Refreshed Yard, Manchester, M1 2AB')).toBeVisible();
    await expect(page.getByText('ABC BUILDERS LTD')).toBeVisible();

    // Dave Thompson is also this client's primary contact (a separate record), so scope to
    // the Directors & PSCs card: he should still appear exactly twice there (director + PSC,
    // from the fixture) — refreshing must not add a third, duplicate role for him.
    const rolesCard = page.locator('div.card', { has: page.getByRole('heading', { name: 'Directors & PSCs' }) });
    await expect(rolesCard.getByText('Dave Thompson')).toHaveCount(2);
    await expect(rolesCard.getByText('Newly Appointed Person')).toBeVisible();
    await expect(page.getByText('Owns 25-50% of shares')).toBeVisible();
    // The new PSC arrived already verified, as Companies House said, and Readiness says where that came from.
    await expect(rolesCard.locator('li', { hasText: 'Newly Appointed Person' })).toContainText('verified');
    await page.goto('/readiness');
    const readinessRow = page.locator('li', { hasText: 'Newly Appointed Person' });
    await expect(readinessRow).toContainText('Confirmed by Companies House');
    await expect(readinessRow.getByRole('combobox')).toHaveValue('verified');
    // Dave is verified by hand in the fixture, so the register's due date is recorded but not shown as a warning there;
    // the link to check the register is offered for the company.
    await expect(page.getByTestId('check-on-companies-house-cl_abc')).toHaveAttribute('href', 'https://find-and-update.company-information.service.gov.uk/company/09876543/officers');
  });

  test('shows a clear message when no Companies House key is configured', async ({ page }) => {
    await page.route('**/api/companies-house/status', (route) => route.fulfill({ json: { configured: false } }));

    await page.goto('/clients/cl_abc');
    await page.getByTestId('refresh-companies-house').click();
    await expect(page.getByText('No live Companies House data')).toBeVisible();
  });

  test('refreshes every company from the Clients page in one go', async ({ page }) => {
    await page.route('**/api/companies-house/status', (route) => route.fulfill({ json: { configured: true } }));
    await page.route('**/api/companies-house/company/*/people', (route) => route.fulfill({ json: { directors: [], pscs: [], source: 'companies_house' } }));
    await page.route('**/api/companies-house/company/*', (route) => {
      const number = route.request().url().split('/').pop()!;
      return route.fulfill({
        json: {
          companyNumber: number,
          companyName: `COMPANY ${number}`,
          companyStatus: 'active',
          companyType: 'ltd',
          dateOfCreation: '2015-01-01',
          sicCodes: [],
          previousNames: [],
          registeredOfficeAddress: { formatted: `${number} Refreshed Street` },
          accountingReferenceDate: null,
          nextAccountsDueOn: null,
          nextAccountsPeriodEndOn: null,
          nextConfirmationStatementDueOn: null,
          source: 'companies_house',
        },
      });
    });

    await page.goto('/clients');
    await page.getByTestId('refresh-all-companies-house').click();
    await expect(page.getByText(/^\d+ clients refreshed\.$/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('refresh-all-companies-house')).toHaveText('Refresh all from Companies House');

    // Every company with a number was touched — spot-check one, and that it stuck across a reload.
    await page.goto('/clients/cl_abc');
    await expect(page.getByText('09876543 Refreshed Street')).toBeVisible();
    await page.reload();
    await expect(page.getByText('09876543 Refreshed Street')).toBeVisible();
  });
});
