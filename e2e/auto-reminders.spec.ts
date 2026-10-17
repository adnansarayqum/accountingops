import { expect, test } from '@playwright/test';
import { buildFixtureData } from '../src/testing/fixtures';
import { todayIso } from '../src/domain/dates';

/**
 * Automatic client reminders in a real browser: Settings shows the switch
 * (off), a preview of the exact emails before anything is trusted, and a
 * reminder the server sent while nobody was looking being recorded on the
 * client's timeline, flagged Automatic. The server is mocked; its logic is
 * covered by server/lib/__tests__/automation*.test.mjs.
 */
test('switch on, preview the emails, and see a server-sent reminder on the client timeline', async ({ page }) => {
  const data = buildFixtureData(todayIso());
  const job = data.jobs.find((j) => j.status === 'waiting_for_records' && j.waitingOn === 'client')!;
  const client = data.clients.find((c) => c.id === job.clientId)!;
  const acks: string[][] = [];
  let saved: { practice?: { automation?: { autoReminders?: boolean } } } | null = null;
  const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
  const status = { status: 'preview', problem: null, enabled: false, workingHours: true, hours: { from: 8, to: 18, timezone: 'Europe/London' }, due: [{ jobId: job.id, clientName: client.name, jobName: job.name, dueDate: job.dueDate, stage: 'Email (30 days)', to: 'client@example.com', contactName: 'Pat Client', subject: 'Documents still needed', body: 'Hi Pat,\n\nWe are still waiting.', sender: 'Ray' }], waiting: 0, needsYou: [], emailReady: true, emailProblem: null, unknown: 0 };
  let activity = [{ id: 'arm_e2e', jobId: job.id, clientId: client.id, recipient: 'client@example.com', subject: 'Documents still needed', body: 'Hi Pat,\n\nWe are still waiting.', stage: 'Email (30 days)', documentsRequested: [], providerName: 'postmark', providerMessageId: 'pm-1', sentAt: new Date().toISOString() }];

  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.route('**/health', (r) => r.fulfill(json({ ok: true, database: true, databaseReachable: true })));
  await page.route('**/api/auth/me', (r) => r.fulfill(json({ user: { id: 'u_adnan', username: 'adnan', name: 'Adnan Sarayqum', role: 'owner', mustChangePassword: false, permissions: ['practice.configure'] } })));
  await page.route('**/api/practice-data', async (r) => {
    if (r.request().method() === 'GET') return r.fulfill(json({ data: saved ? { ...data, practice: { ...data.practice, ...saved.practice } } : data, version: 1 }));
    saved = r.request().postDataJSON()?.data ?? r.request().postDataJSON();
    return r.fulfill(json({ version: 2 }));
  });
  await page.route('**/api/intake/status', (r) => r.fulfill(json({ configured: false })));
  await page.route('**/api/automation/status', (r) => r.fulfill(json(status)));
  await page.route('**/api/automation/preview', (r) => r.fulfill(json(status)));
  await page.route('**/api/automation/activity', (r) => r.fulfill(json({ activity })));
  await page.route('**/api/automation/activity/ack', async (r) => {
    acks.push(r.request().postDataJSON().ids);
    activity = [];
    await r.fulfill(json({ applied: 1 }));
  });

  // The reminder the server sent is recorded the moment the app opens.
  await page.goto(`/clients/${client.id}`);
  await expect.poll(() => acks).toEqual([['arm_e2e']]);
  await page.getByRole('tab', { name: /^Communications/ }).click();
  const timeline = page.getByTestId('comms-timeline');
  await expect(timeline.getByText('Automatic', { exact: true })).toBeVisible();
  await expect(timeline.getByText('sent automatically via postmark')).toBeVisible();

  await page.goto('/settings');
  const card = page.getByTestId('auto-reminders');
  await expect(card).toContainText('Off');
  await card.getByTestId('auto-reminders-preview').click();
  await expect(page.getByTestId('auto-reminders-preview-result')).toContainText('Pat Client (client@example.com)');

  await card.getByTestId('auto-reminders-toggle').click();
  await expect(card).toContainText('On');
});
