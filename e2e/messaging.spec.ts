import { expect, test } from '@playwright/test';
import { seedFixture } from './fixtures';

/** Reminders leave the app the way Settings → Messaging says they do. */
test.describe('messaging', () => {
  test.beforeEach(async ({ page }) => {
    await page.context().route(/wa\.me/, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>wa.me stub</title>' }));
    await seedFixture(page);
  });

  test('Settings says what each channel does; email is simulated on this build', async ({ page }) => {
    await page.goto('/settings');
    const card = page.getByTestId('messaging-status');
    await expect(card).toContainText('Email');
    await expect(card).toContainText('simulated');
    await expect(card).toContainText('opens your WhatsApp');
  });

  test('an email reminder is simulated and labelled so on the client record', async ({ page }) => {
    await page.goto('/jobs/job_abc_accounts');
    await page.getByTestId('job-send-reminder').click();
    await page.getByRole('radio', { name: /Email/ }).click();
    await expect(page.getByTestId('reminder-delivery-note')).toContainText('simulated');
    await expect(page.getByTestId('send-reminder-confirm')).toHaveText('Send Email');
    await page.getByTestId('send-reminder-confirm').click();
    await expect(page.getByText('Reminder sent', { exact: true })).toBeVisible();
    await page.goto('/clients/cl_abc');
    await page.getByRole('tab', { name: /Communications/ }).click();
    await expect(page.getByText('simulated').first()).toBeVisible();
  });

  test('when a live email provider is configured, the reminder goes through the server and is recorded as sent', async ({ page }) => {
    await page.route('**/api/messages/status', (route) => route.fulfill({ json: { email: { provider: 'postmark', configured: true, from: 'Farhan & Raihan <reminders@practice.example>' }, whatsapp: { mode: 'click_to_chat' }, sms: { provider: 'simulated', configured: false } } }));
    let sent: Record<string, unknown> | null = null;
    await page.route('**/api/messages/send', (route) => {
      sent = route.request().postDataJSON() as Record<string, unknown>;
      void route.fulfill({ json: { ok: true, providerName: 'postmark', providerMessageId: 'pm-e2e-1', status: 'sent' } });
    });
    await page.goto('/jobs/job_abc_accounts');
    await page.getByTestId('job-send-reminder').click();
    await page.getByRole('radio', { name: /Email/ }).click();
    await expect(page.getByTestId('send-reminder-confirm')).toHaveText('Send email');
    await expect(page.getByTestId('reminder-delivery-note')).toContainText('reminders@practice.example');
    await page.getByTestId('send-reminder-confirm').click();
    await expect(page.getByText('Email sent', { exact: true })).toBeVisible();
    expect(sent).toMatchObject({ channel: 'email', to: 'dave@abc-construction.example' });
    expect(String((sent as Record<string, unknown> | null)?.idempotencyKey)).toMatch(/^send_/);
    await page.goto('/clients/cl_abc');
    await page.getByRole('tab', { name: /Communications/ }).click();
    await expect(page.getByText('sent via postmark').first()).toBeVisible();
  });
});
