import { expect, test } from '@playwright/test';
import { seedFixture, STORAGE_KEY } from './fixtures';

/**
 * The same rich scenario the fixture dataset tells, end to end, seeded
 * directly into storage rather than via any in-app feature (a real
 * practice has no built-in "load sample data" button — see
 * docs/TEST_SCENARIOS.md for the scenario this walks through).
 * Runs against the production build. Fonts are blocked so it is fast and
 * deterministic offline.
 */
test.describe('primary scenario journey', () => {
  test.beforeEach(async ({ page }) => {
    await page.context().route(/wa\.me/, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>wa.me stub</title>' }));
    await seedFixture(page);
  });

  test('dashboard → attention → client → job → reminder → inbox → ready → dashboard', async ({ page }) => {
    // Scene 1: dashboard shows what needs attention
    await expect(page.getByRole('heading', { name: 'Needs attention' })).toBeVisible();
    const attentionBefore = await page.getByTestId('attention-row').count();
    expect(attentionBefore).toBeGreaterThan(0);

    // Scene 2: Needs Attention explains ABC Construction
    await page.goto('/attention');
    const abcCard = page.getByTestId('attention-card').filter({ hasText: 'ABC Construction Ltd' }).first();
    await expect(abcCard).toBeVisible();
    await expect(abcCard).toContainText('loan statement and director expenses');
    await expect(abcCard).toContainText('Send WhatsApp reminder');

    // Scene 3: client record with masked identifiers
    await abcCard.getByRole('link', { name: 'ABC Construction Ltd' }).click();
    await expect(page.getByRole('heading', { name: 'ABC Construction Ltd' })).toBeVisible();
    await expect(page.getByText('•••••67890')).toBeVisible();
    await expect(page.getByText('1234567890')).toHaveCount(0);
    await page.getByRole('button', { name: 'Reveal value' }).first().click();
    await expect(page.getByText('12345 67890')).toBeVisible();

    // Scene 4: open the accounts job and see completion
    await page.getByRole('link', { name: '2025 Annual Accounts' }).first().click();
    await expect(page.getByRole('heading', { name: '2025 Annual Accounts' })).toBeVisible();
    await expect(page.getByTestId('completion-percent')).toHaveText('67%');
    await expect(page.getByTestId('document-checklist')).toContainText('Loan statement');
    await expect(page.getByTestId('document-checklist')).toContainText('Director expenses');

    // Scene 5: send a WhatsApp reminder — appears in the timeline
    const commsBefore = await page.getByTestId('job-comms').locator('li').count();
    await page.getByTestId('job-send-reminder').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('radio', { name: /WhatsApp/ })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByLabel('Message')).toContainText('loan statement and director expenses');
    // WhatsApp is handed to the accountant's own WhatsApp: Send opens wa.me
    // with the message filled in, and the reminder is logged as handed off.
    const popupPromise = page.context().waitForEvent('page');
    await page.getByTestId('send-reminder-confirm').click();
    const popup = await popupPromise;
    expect(popup.url()).toMatch(/^https:\/\/wa\.me\/447700900123\?text=/);
    await popup.close();
    await expect(page.getByText('WhatsApp opened', { exact: true })).toBeVisible();
    await expect(page.getByTestId('job-comms').locator('li')).toHaveCount(commsBefore + 1);
    await expect(page.getByTestId('job-comms').locator('li').first()).toContainText('WhatsApp');

    // Scene 6: Smart Inbox — confirm the loan statement
    await page.goto('/inbox');
    const item = page.getByTestId('inbox-inb_abc_loan');
    await expect(item).toContainText('ABC-Lloyds-Loan-Statement.pdf');
    await expect(item).toContainText('97%');
    await page.getByTestId('confirm-inb_abc_loan').click();
    await expect(page.getByText('Document attached', { exact: true })).toBeVisible();
    await expect(item).toHaveCount(0);

    // Scene 7: back on the job, completion increased and the item is received
    await page.goto('/jobs/job_abc_accounts');
    await expect(page.getByTestId('completion-percent')).toHaveText('83%');
    await expect(page.getByTestId('document-checklist').locator('li[data-status="received"]')).toHaveCount(5);

    // Scene 8: complete the final item — chasing stops, job becomes ready
    await page.getByRole('button', { name: 'Mark received' }).first().click();
    await expect(page.getByTestId('completion-percent')).toHaveText('100%');
    await expect(page.getByText('No chasing needed', { exact: true })).toBeVisible();
    await expect(page.getByText('Ready to start').first()).toBeVisible();
    await expect(page.getByTestId('job-send-reminder')).toHaveCount(0);
    await expect(page.getByTestId('job-primary-action')).toHaveText(/Start work/);

    // Scene 9: dashboard reflects the change — ABC no longer in attention
    await page.goto('/');
    await expect(page.getByTestId('attention-card').filter({ hasText: 'ABC Construction Ltd' })).toHaveCount(0);
    await expect(page.getByText('All documents received for ABC Construction Ltd')).toBeVisible();

    // Scene 10: ask the practice
    await page.goto('/ask?q=' + encodeURIComponent('Which clients still need chasing this month?'));
    await expect(page.getByTestId('ask-result')).toContainText('Waiting on');
    await expect(page.getByTestId('ask-result')).not.toContainText('ABC Construction Ltd — 2025 Annual Accounts');
  });

  test('filing a recurring job generates the next one once', async ({ page }) => {
    await page.goto('/jobs/job_khan_vat');
    await page.getByTestId('job-primary-action').click();
    await expect(page.getByText('Job marked as filed', { exact: true })).toBeVisible();
    await expect(page.getByText('Simulated submission — nothing was sent to HMRC')).toBeVisible();
    await page.goto('/clients/cl_khan');
    await expect(page.getByRole('link', { name: 'VAT Return 2026 Q4' }).filter({ visible: true }).first()).toBeVisible();
    // Exactly one next-period job exists for the obligation, even after a reload.
    const generated = await page.evaluate((key) => {
      const env = JSON.parse(localStorage.getItem(key) ?? '{}');
      return env.data.jobs.filter((j: { obligationId?: string; periodKey: string }) => j.obligationId === 'ob_khan_vat' && j.periodKey === '2026-Q4').length;
    }, STORAGE_KEY);
    expect(generated).toBe(1);
  });

  test('client search finds a client by company number without exposing it', async ({ page }) => {
    await page.goto('/clients');
    await page.getByTestId('client-search').fill('09876543');
    await expect(page.locator('a[href="/clients/cl_abc"]').filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByText('matched company number').filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByText('09876543')).toHaveCount(0);
  });

  test('command palette opens with keyboard shortcut', async ({ page }) => {
    await page.keyboard.press('Control+k');
    await page.getByTestId('command-input').fill('Khan');
    await expect(page.getByRole('option').filter({ hasText: 'Khan Consulting Ltd' }).first()).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Khan Consulting Ltd' })).toBeVisible();
  });
});
