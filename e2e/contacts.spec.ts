import { expect, test } from '@playwright/test';
import { seedFixture } from './fixtures';

test.describe('client contact details', () => {
  test.beforeEach(async ({ page }) => {
    await seedFixture(page);
  });

  test('fills in a contact’s email and phone, and they persist', async ({ page }) => {
    await page.goto('/clients/cl_abc');
    const contacts = page.locator('div.card', { has: page.getByRole('heading', { name: 'Contacts' }) });
    await expect(contacts).toBeVisible();

    await contacts.getByRole('button', { name: 'Edit Dave Thompson' }).click();
    await page.getByTestId('contact-email').fill('dave.thompson@abcconstruction.example');
    await page.getByTestId('contact-phone').fill('07700 900321');
    await page.getByTestId('contact-save').click();

    await expect(contacts.getByText('dave.thompson@abcconstruction.example')).toBeVisible();
    await expect(contacts.getByText('07700 900321')).toBeVisible();

    // Persisted, not just component state. The email now shows in both the header
    // strip and the Contacts card, so scope the check to the card.
    await page.reload();
    await expect(contacts.getByText('dave.thompson@abcconstruction.example')).toBeVisible();
  });

  test('adds a second contact and makes it the main one', async ({ page }) => {
    await page.goto('/clients/cl_abc');
    const contacts = page.locator('div.card', { has: page.getByRole('heading', { name: 'Contacts' }) });

    await page.getByTestId('contact-add').click();
    await page.getByTestId('contact-name').fill('Bianca Reyes');
    await page.getByTestId('contact-role').fill('Bookkeeper');
    await page.getByTestId('contact-email').fill('bianca@abcconstruction.example');
    await page.getByTestId('contact-save').click();

    await expect(contacts.getByText('Bianca Reyes')).toBeVisible();
    await expect(contacts.getByText('Bookkeeper')).toBeVisible();

    await contacts.getByRole('button', { name: 'Make Bianca Reyes the main contact' }).click();
    const biancaRow = page.locator('li', { hasText: 'Bianca Reyes' });
    await expect(biancaRow.getByText('Main contact')).toBeVisible();
  });

  test('an imported client with no contact details says so', async ({ page }) => {
    // A client whose contact has no email or phone can't be chased — the card says as much.
    await page.goto('/clients/cl_abc');
    const contacts = page.locator('div.card', { has: page.getByRole('heading', { name: 'Contacts' }) });
    await page.getByTestId('contact-add').click();
    await page.getByTestId('contact-name').fill('No Details Person');
    await page.getByTestId('contact-save').click();

    const row = page.locator('li', { hasText: 'No Details Person' });
    await expect(row.getByText('No email or phone yet')).toBeVisible();
    await expect(contacts).toBeVisible();
  });
});
