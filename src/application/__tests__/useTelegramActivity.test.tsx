import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { configureRepository, useAppStore } from '../store';
import { MemoryRepository } from '../persistence/memoryRepository';
import { buildFixtureData } from '../../testing/fixtures';
import { useTelegramActivity } from '../useTelegramActivity';
import { acknowledgeTelegramActivity, getTelegramActivity, getTelegramStatus, type TelegramActivity } from '../../integrations/telegram';

vi.mock('../../integrations/telegram', () => ({
  getTelegramStatus: vi.fn(async () => ({ configured: true })),
  getTelegramActivity: vi.fn(async () => []),
  acknowledgeTelegramActivity: vi.fn(async (ids: string[]) => ids.length),
}));

const today = '2026-09-11';

const row = (overrides: Partial<TelegramActivity> = {}): TelegramActivity => ({
  id: 'tga_1',
  uploadId: 'tgu_1',
  clientId: 'cl_abc',
  documentType: 'VAT notice',
  period: null,
  extractedReference: null,
  extractedDate: null,
  confidence: 0.95,
  rationale: 'VAT number matches.',
  fileName: 'telegram-1.jpg',
  sizeKb: 120,
  createdAt: '2026-09-11T09:00:00.000Z',
  ...overrides,
});

describe('useTelegramActivity', () => {
  const originalRefresh = useAppStore.getState().refresh;

  beforeEach(() => {
    vi.mocked(getTelegramStatus).mockClear().mockResolvedValue({ configured: true });
    vi.mocked(getTelegramActivity).mockClear().mockResolvedValue([]);
    vi.mocked(acknowledgeTelegramActivity).mockClear();
    configureRepository(new MemoryRepository());
    useAppStore.setState({ data: buildFixtureData(today), today, ready: true, loadFailed: false, toasts: [], refresh: vi.fn(async () => false) });
  });

  afterEach(() => {
    useAppStore.setState({ refresh: originalRefresh });
  });

  it('files queued letters, acknowledges them, and says what happened', async () => {
    vi.mocked(getTelegramActivity).mockResolvedValue([row(), row({ id: 'tga_2', uploadId: 'tgu_2', clientId: null })]);
    renderHook(() => useTelegramActivity());

    await waitFor(() => expect(acknowledgeTelegramActivity).toHaveBeenCalledWith(['tga_1', 'tga_2']));
    expect(useAppStore.getState().refresh).toHaveBeenCalled();
    const items = useAppStore.getState().data.inboxItems.filter((i) => i.source === 'telegram');
    expect(items.map((i) => i.status).sort()).toEqual(['confirmed', 'pending']);
    expect(useAppStore.getState().toasts.at(-1)).toMatchObject({ title: 'From Telegram', description: '2 letters: 1 filed, 1 to sort in Smart Inbox.' });
  });

  it('never polls when the server has no Telegram bot (including browser-only mode)', async () => {
    vi.mocked(getTelegramStatus).mockResolvedValue({ configured: false });
    renderHook(() => useTelegramActivity());
    await waitFor(() => expect(getTelegramStatus).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(getTelegramActivity).not.toHaveBeenCalled();
  });

  it('acknowledges nothing and shows nothing when the queue is empty', async () => {
    renderHook(() => useTelegramActivity());
    await waitFor(() => expect(getTelegramActivity).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(acknowledgeTelegramActivity).not.toHaveBeenCalled();
    expect(useAppStore.getState().toasts).toEqual([]);
  });
});
