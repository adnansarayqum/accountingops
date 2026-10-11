import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { READING_POLL_MS, useBankStatements } from '../useBankStatements';
import { getBankStatements } from '../../integrations/bank';
import type { BankStatement } from '../../domain/rules/bankStatements';

vi.mock('../../integrations/bank', () => ({ getBankStatements: vi.fn() }));

const get = vi.mocked(getBankStatements);
const statement = (id: string, status: BankStatement['status'], transactions: BankStatement['transactions'] = []): BankStatement => ({
  id,
  sourceUploadId: `inu_${id}`,
  uploadIds: [`inu_${id}`],
  status,
  error: null,
  bankName: 'Barclays',
  accountName: null,
  accountLast4: '5678',
  periodStart: '2026-01-01',
  periodEnd: '2026-01-31',
  openingBalance: 0,
  closingBalance: 0,
  droppedLines: 0,
  transactions,
});

describe('useBankStatements', () => {
  beforeEach(() => {
    get.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it('asks for the statements of the documents it is given, and reports what came back', async () => {
    get.mockResolvedValue({ statements: [statement('a', 'extracted')], canRead: true });
    const { result } = renderHook(() => useBankStatements(['inu_a', 'inu_b']));
    expect(result.current.loaded).toBe(false);
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(get).toHaveBeenCalledWith(['inu_a', 'inu_b']);
    expect(result.current.statements?.map((s) => s.id)).toEqual(['a']);
    expect(result.current.canRead).toBe(true);
  });

  it('answers null when there is no server', async () => {
    get.mockResolvedValue(null);
    const { result } = renderHook(() => useBankStatements(['inu_a']));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.statements).toBeNull();
    expect(result.current.canRead).toBe(false);
  });

  it('keeps asking while a statement is being read, and stops once none is', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    get.mockResolvedValueOnce({ statements: [statement('a', 'reading')], canRead: true }).mockResolvedValueOnce({ statements: [statement('a', 'reading')], canRead: true }).mockResolvedValue({ statements: [statement('a', 'extracted')], canRead: true });
    const { result } = renderHook(() => useBankStatements(['inu_a']));
    await waitFor(() => expect(result.current.statements?.[0].status).toBe('reading'));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(READING_POLL_MS);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(READING_POLL_MS);
    });
    await waitFor(() => expect(result.current.statements?.[0].status).toBe('extracted'));
    const calls = get.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(READING_POLL_MS * 3);
    });
    expect(get.mock.calls.length).toBe(calls);
  });

  it('does not poll while the tab is hidden', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    get.mockResolvedValue({ statements: [statement('a', 'reading')], canRead: true });
    const { result } = renderHook(() => useBankStatements(['inu_a']));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    const calls = get.mock.calls.length;
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(READING_POLL_MS * 2);
    });
    expect(get.mock.calls.length).toBe(calls);
    visibility.mockReturnValue('visible');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(READING_POLL_MS);
    });
    expect(get.mock.calls.length).toBeGreaterThan(calls);
    visibility.mockRestore();
  });

  it('ignores an answer for documents it is no longer asked about', async () => {
    let finishFirst: (value: { statements: BankStatement[]; canRead: boolean }) => void = () => {};
    get.mockImplementationOnce(() => new Promise((resolve) => (finishFirst = resolve)));
    get.mockResolvedValueOnce({ statements: [statement('b', 'extracted')], canRead: true });
    const { result, rerender } = renderHook(({ ids }) => useBankStatements(ids), { initialProps: { ids: ['inu_a'] } });
    rerender({ ids: ['inu_b'] });
    await waitFor(() => expect(result.current.statements?.[0].id).toBe('b'));
    await act(async () => finishFirst({ statements: [statement('a', 'extracted')], canRead: true }));
    expect(result.current.statements?.map((s) => s.id)).toEqual(['b']);
  });

  it('edits one line in place', async () => {
    const line = { id: 'btx_1', lineNo: 0, date: '2026-01-05', description: 'x', amount: 1, balance: null, category: 'Other / unsure', categorySource: 'ai' as const };
    get.mockResolvedValue({ statements: [statement('a', 'extracted', [line])], canRead: true });
    const { result } = renderHook(() => useBankStatements(['inu_a']));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    act(() => result.current.patchTransaction('btx_1', { category: 'VAT', categorySource: 'user' }));
    expect(result.current.statements?.[0].transactions[0]).toMatchObject({ category: 'VAT', categorySource: 'user' });
  });

  it('asks for nothing when there are no documents', async () => {
    get.mockResolvedValue({ statements: [], canRead: false });
    const { result } = renderHook(() => useBankStatements([]));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(get).toHaveBeenCalledWith([]);
  });
});
