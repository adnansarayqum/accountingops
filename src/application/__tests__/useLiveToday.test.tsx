import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useAppStore } from '../store';
import { useLiveToday } from '../useLiveToday';

describe('useLiveToday', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('moves the store on to the new day once midnight passes', () => {
    vi.setSystemTime(new Date('2026-09-11T22:59:30.000Z'));
    useAppStore.setState((state) => ({ data: { ...state.data, practice: { ...state.data.practice, timezone: 'Europe/London' } }, today: '2026-09-11' }));
    renderHook(() => useLiveToday());

    act(() => vi.advanceTimersByTime(60_000));
    expect(useAppStore.getState().today).toBe('2026-09-12');
  });

  it('leaves the store alone while the day is unchanged', () => {
    vi.setSystemTime(new Date('2026-09-11T10:00:00.000Z'));
    useAppStore.setState((state) => ({ data: { ...state.data, practice: { ...state.data.practice, timezone: 'Europe/London' } }, today: '2026-09-11' }));
    const before = useAppStore.getState();
    renderHook(() => useLiveToday());
    act(() => vi.advanceTimersByTime(5 * 60_000));
    expect(useAppStore.getState()).toBe(before);
  });

  it('catches up as soon as the tab is looked at again', () => {
    vi.setSystemTime(new Date('2026-09-11T10:00:00.000Z'));
    useAppStore.setState((state) => ({ data: { ...state.data, practice: { ...state.data.practice, timezone: 'Europe/London' } }, today: '2026-09-11' }));
    renderHook(() => useLiveToday());
    vi.setSystemTime(new Date('2026-09-13T09:00:00.000Z'));
    act(() => window.dispatchEvent(new Event('focus')));
    expect(useAppStore.getState().today).toBe('2026-09-13');
  });

  it('rolls over on the practice clock through a DST boundary', () => {
    vi.setSystemTime(new Date('2026-11-01T03:59:30.000Z'));
    useAppStore.setState((state) => ({ data: { ...state.data, practice: { ...state.data.practice, timezone: 'America/New_York' } }, today: '2026-10-31' }));
    renderHook(() => useLiveToday());

    act(() => vi.advanceTimersByTime(60_000));
    expect(useAppStore.getState().today).toBe('2026-11-01');
  });
});
