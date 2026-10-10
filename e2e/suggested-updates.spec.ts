import { expect, test } from '@playwright/test';
import { seedFixture } from './fixtures';
import { formatDate } from '../src/domain/dates';
import type { DocumentFacts } from '../src/domain/types';

/**
 * Changes a shared document proposes once it is filed: applied one tap at a
 * time from Smart Inbox, never on their own. Seeded as a pending shared
 * item, as the intake poll would leave one, then confirmed in the browser.
 */
const noFacts: DocumentFacts = { deadline: null, service: null, periodEnd: null, penaltyAmount: null, appealBy: null, utr: null, vatNumber: null, email: null, phone: null, address: null, yearEnd: null };
const NEW_DEADLINE = '2030-12-31';
const proposals = (page: import('@playwright/test').Page) => page.getByTestId('suggested-updates').locator('[data-testid^="proposal-prop_"]');

test.describe('Smart Inbox — suggested updates from shared documents', () => {
  let oldDue = '';
  let jobName = '';

  test.beforeEach(async ({ page }) => {
    await seedFixture(page, (data) => {
      const job = data.jobs.find((j) => j.id === 'job_abc_ct')!;
      oldDue = job.dueDate;
      jobName = job.name;
      const shared = (id: string, documentType: string, facts: Partial<DocumentFacts>, summary: string) => ({
        id,
        practiceId: data.practice.id,
        fileName: `${id}.jpg`,
        receivedAt: new Date().toISOString(),
        source: 'share' as const,
        sender: 'Shared from phone',
        sizeKb: 200,
        intakeUploadIds: [`inu_${id}`],
        summary,
        facts: { ...noFacts, ...facts },
        status: 'pending' as const,
        suggestion: { clientId: 'cl_abc', documentType, extractedReference: 'CT/123', confidence: 0.7, rationale: 'Name matches.' },
      });
      data.inboxItems.push(
        shared('letter', 'Penalty notice', { deadline: NEW_DEADLINE, service: 'corporation_tax', periodEnd: job.periodEnd, penaltyAmount: 100 }, 'HMRC late filing penalty'),
        shared('message', 'Message from the client', { email: 'dave@new.example' }, 'Dave has a new email address'),
      );
    });
    await page.goto('/inbox');
  });

  test('a filed letter proposes a new due date and a penalty; only what is applied changes', async ({ page }) => {
    await expect(page.getByTestId('suggested-updates')).toHaveCount(0);
    await page.getByTestId('confirm-letter').click();

    const panel = page.getByTestId('suggested-updates');
    const move = proposals(page).filter({ hasText: `Move ${jobName} due date from ${formatDate(oldDue)} to 31 Dec 2030` });
    const penalty = proposals(page).filter({ hasText: 'Record a £100 penalty' });
    await expect(move).toHaveCount(1);
    await expect(penalty).toHaveCount(1);
    await expect(panel.getByTestId('suggested-for-letter').getByTestId('view-files-letter')).toBeVisible();

    await move.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByText('Updated', { exact: true })).toBeVisible();
    await penalty.getByRole('button', { name: 'Dismiss' }).click();
    await expect(page.getByTestId('suggested-updates')).toHaveCount(0);

    await page.goto('/jobs/job_abc_ct');
    await expect(page.getByText('31 Dec 2030').first()).toBeVisible();
    await page.reload();
    await expect(page.getByText('31 Dec 2030').first()).toBeVisible();
  });

  test('a client’s message proposes their new email, applied to their contact', async ({ page }) => {
    await page.getByTestId('confirm-message').click();
    const change = proposals(page).filter({ hasText: 'Change email to dave@new.example (was dave@abc-construction.example)' });
    await change.getByRole('button', { name: 'Apply' }).click();
    // The message itself is offered as a note too.
    const note = proposals(page).filter({ hasText: 'Save a note: Client said: Dave has a new email address' });
    await note.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByTestId('suggested-updates')).toHaveCount(0);

    await page.goto('/clients/cl_abc');
    await expect(page.getByText('dave@new.example').first()).toBeVisible();
  });
});
