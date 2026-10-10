import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { configureRepository, useAppStore } from '../store';
import { MemoryRepository } from '../persistence/memoryRepository';
import { buildFixtureData } from '../../testing/fixtures';
import { useIntakeActivity } from '../useIntakeActivity';
import { acknowledgeIntakeActivity, getIntakeActivity, getIntakeStatus, type IntakeActivity } from '../../integrations/intake';

vi.mock('../../integrations/intake', () => ({
  getIntakeStatus: vi.fn(async () => ({ configured: true })),
  getIntakeActivity: vi.fn(async () => []),
  acknowledgeIntakeActivity: vi.fn(async (ids: string[]) => ids.length),
}));

const today = '2026-09-11';

const row = (overrides: Partial<IntakeActivity> = {}): IntakeActivity => ({
  id: 'ina_1',
  batchId: 'inb_1',
  source: 'share',
  uploadIds: ['inu_1'],
  clientId: 'cl_abc',
  filed: true,
  documentType: 'Bank statement',
  period: null,
  extractedReference: null,
  extractedDate: null,
  summary: null,
  confidence: 0.95,
  rationale: 'Name matches.',
  fileName: 'IMG_1.jpg',
  sizeKb: 120,
  createdAt: '2026-09-11T09:00:00.000Z',
  ...overrides,
});

describe('useIntakeActivity', () => {
  const originalRefresh = useAppStore.getState().refresh;

  beforeEach(() => {
    vi.mocked(getIntakeStatus).mockClear().mockResolvedValue({ configured: true });
    vi.mocked(getIntakeActivity).mockClear().mockResolvedValue([]);
    vi.mocked(acknowledgeIntakeActivity).mockClear();
    configureRepository(new MemoryRepository());
    useAppStore.setState({ data: buildFixtureData(today), today, ready: true, loadFailed: false, toasts: [], refresh: vi.fn(async () => false) });
  });

  afterEach(() => {
    useAppStore.setState({ refresh: originalRefresh });
  });

  it('files queued letters, acknowledges them, and says what happened', async () => {
    vi.mocked(getIntakeActivity).mockResolvedValue([row(), row({ id: 'ina_2', uploadIds: ['inu_2'], clientId: null, filed: false })]);
    renderHook(() => useIntakeActivity());

    await waitFor(() => expect(acknowledgeIntakeActivity).toHaveBeenCalledWith(['ina_1', 'ina_2']));
    expect(useAppStore.getState().refresh).toHaveBeenCalled();
    const items = useAppStore.getState().data.inboxItems.filter((i) => i.source === 'share');
    expect(items.map((i) => i.status).sort()).toEqual(['confirmed', 'pending']);
    expect(useAppStore.getState().toasts.at(-1)).toMatchObject({ title: 'Shared documents', description: '2 documents: 1 filed, 1 to sort in Smart Inbox.' });
  });

  it('never polls when the server has no shared intake (including browser-only mode)', async () => {
    vi.mocked(getIntakeStatus).mockResolvedValue({ configured: false });
    renderHook(() => useIntakeActivity());
    await waitFor(() => expect(getIntakeStatus).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(getIntakeActivity).not.toHaveBeenCalled();
  });

  it('acknowledges nothing and shows nothing when the queue is empty', async () => {
    renderHook(() => useIntakeActivity());
    await waitFor(() => expect(getIntakeActivity).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(acknowledgeIntakeActivity).not.toHaveBeenCalled();
    expect(useAppStore.getState().toasts).toEqual([]);
  });
});
