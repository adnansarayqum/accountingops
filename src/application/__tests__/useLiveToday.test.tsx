import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useAppStore } from '../store';
import { useLiveToday } from '../useLiveToday';

describe('useLiveToday', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('moves the store on to the new day once midnight passes', () => {
    vi.setSystemTime(new Date(2026, 8, 11, 23, 59, 30));
    useAppStore.setState({ today: '2026-09-11' });
    renderHook(() => useLiveToday());

    act(() => vi.advanceTimersByTime(60_000));
    expect(useAppStore.getState().today).toBe('2026-09-12');
  });

  it('leaves the store alone while the day is unchanged', () => {
    vi.setSystemTime(new Date(2026, 8, 11, 10, 0, 0));
    useAppStore.setState({ today: '2026-09-11' });
    const before = useAppStore.getState();
    renderHook(() => useLiveToday());
    act(() => vi.advanceTimersByTime(5 * 60_000));
    expect(useAppStore.getState()).toBe(before);
  });

  it('catches up as soon as the tab is looked at again', () => {
    vi.setSystemTime(new Date(2026, 8, 11, 10, 0, 0));
    useAppStore.setState({ today: '2026-09-11' });
    renderHook(() => useLiveToday());
    vi.setSystemTime(new Date(2026, 8, 13, 9, 0, 0));
    act(() => window.dispatchEvent(new Event('focus')));
    expect(useAppStore.getState().today).toBe('2026-09-13');
  });
});
