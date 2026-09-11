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
          directors: [{ name: 'Dave Thompson', role: 'director', appointedOn: '2012-04-01', dateOfBirth: { month: '4', year: '1978' }, nationality: 'British', occupation: 'Director', naturesOfControl: [] }],
          pscs: [
            { name: 'Newly Appointed Person', role: 'psc', appointedOn: '2026-01-01', dateOfBirth: { month: '1', year: '1990' }, nationality: 'British', occupation: null, naturesOfControl: ['Owns 25-50% of shares'] },
          ],
          source: 'companies_house',
        },
      }),
    );

    await page.goto('/clients/cl_abc');
    await expect(page.getByRole('heading', { name: 'ABC Construction Ltd' })).toBeVisible();

    await page.getByTestId('refresh-companies-house').click();
    await expect(page.getByText('Refreshed from Companies House')).toBeVisible();
    await expect(page.getByText('1 new person added.')).toBeVisible();

    await expect(page.getByText('9 Refreshed Yard, Manchester, M1 2AB')).toBeVisible();
    await expect(page.getByText('ABC BUILDERS LTD')).toBeVisible();

    // Dave Thompson is also this client's primary contact (a separate record), so scope to
    // the Directors & PSCs card: he should still appear exactly twice there (director + PSC,
    // from the fixture) — refreshing must not add a third, duplicate role for him.
    const rolesCard = page.locator('div.card', { has: page.getByRole('heading', { name: 'Directors & PSCs' }) });
    await expect(rolesCard.getByText('Dave Thompson')).toHaveCount(2);
    await expect(rolesCard.getByText('Newly Appointed Person')).toBeVisible();
    await expect(page.getByText('Owns 25-50% of shares')).toBeVisible();
  });

  test('shows a clear message when no Companies House key is configured', async ({ page }) => {
    await page.route('**/api/companies-house/status', (route) => route.fulfill({ json: { configured: false } }));

    await page.goto('/clients/cl_abc');
    await page.getByTestId('refresh-companies-house').click();
    await expect(page.getByText('No live Companies House data')).toBeVisible();
  });
});
