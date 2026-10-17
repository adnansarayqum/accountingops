import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { configureRepository, useAppStore } from '../store';
import { MemoryRepository } from '../persistence/memoryRepository';
import { buildFixtureData } from '../../testing/fixtures';
import { useAutoReminderActivity } from '../useAutoReminderActivity';
import { acknowledgeAutoReminders, getAutoReminderActivity, getAutomationStatus, type AutoReminderActivity, type AutomationStatus } from '../../integrations/automation';

vi.mock('../../integrations/automation', () => ({
  getAutomationStatus: vi.fn(async () => ({}) as AutomationStatus),
  getAutoReminderActivity: vi.fn(async () => []),
  acknowledgeAutoReminders: vi.fn(async (ids: string[]) => ids.length),
}));

const today = '2026-09-11';

const row = (overrides: Partial<AutoReminderActivity> = {}): AutoReminderActivity => ({
  id: 'arm_1',
  jobId: 'job_abc_accounts',
  clientId: 'cl_abc',
  recipient: 'a@example.com',
  subject: 'Subject',
  body: 'Body',
  stage: 'Email (30 days)',
  documentsRequested: [],
  providerName: 'postmark',
  providerMessageId: 'pm-1',
  sentAt: '2026-09-11T09:30:00.000Z',
  ...overrides,
});

describe('useAutoReminderActivity', () => {
  const originalRefresh = useAppStore.getState().refresh;

  beforeEach(() => {
    vi.mocked(getAutomationStatus).mockClear().mockResolvedValue({} as AutomationStatus);
    vi.mocked(getAutoReminderActivity).mockClear().mockResolvedValue([]);
    vi.mocked(acknowledgeAutoReminders).mockClear();
    configureRepository(new MemoryRepository());
    useAppStore.setState({ data: buildFixtureData(today), today, ready: true, authMode: 'server', loadFailed: false, toasts: [], refresh: vi.fn(async () => false) });
  });

  afterEach(() => {
    useAppStore.setState({ refresh: originalRefresh });
  });

  it('records what the server sent, acknowledges it, and says so', async () => {
    vi.mocked(getAutoReminderActivity).mockResolvedValue([row(), row({ id: 'arm_2', jobId: 'job_gone' })]);
    renderHook(() => useAutoReminderActivity());

    await waitFor(() => expect(acknowledgeAutoReminders).toHaveBeenCalledWith(['arm_1', 'arm_2']));
    expect(useAppStore.getState().refresh).toHaveBeenCalled();
    expect(useAppStore.getState().data.communications.filter((c) => c.automated)).toHaveLength(1);
    expect(useAppStore.getState().toasts.at(-1)).toMatchObject({ title: 'Reminders sent automatically', description: expect.stringMatching(/^1 reminder emailed to /) });
  });

  it('never polls when there is no server (including browser-only mode)', async () => {
    vi.mocked(getAutomationStatus).mockResolvedValue(null);
    renderHook(() => useAutoReminderActivity());
    await waitFor(() => expect(getAutomationStatus).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(getAutoReminderActivity).not.toHaveBeenCalled();
  });

  it('does not ask a server it is not signed in to (browser-only mode)', async () => {
    useAppStore.setState({ authMode: 'local' });
    renderHook(() => useAutoReminderActivity());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(getAutomationStatus).not.toHaveBeenCalled();
  });

  it('acknowledges nothing and shows nothing when the queue is empty', async () => {
    renderHook(() => useAutoReminderActivity());
    await waitFor(() => expect(getAutoReminderActivity).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(acknowledgeAutoReminders).not.toHaveBeenCalled();
    expect(useAppStore.getState().toasts).toEqual([]);
  });
});
