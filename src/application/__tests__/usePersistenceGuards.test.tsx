import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useAppStore } from '../store';
import { useRefreshOnFocus, useUnsavedChangesWarning } from '../usePersistenceGuards';

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
}

describe('useUnsavedChangesWarning', () => {
  it('blocks unload only while a change is unsaved', () => {
    renderHook(() => useUnsavedChangesWarning());

    useAppStore.setState({ unsaved: true });
    const blocked = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(blocked);
    expect(blocked.defaultPrevented).toBe(true);

    useAppStore.setState({ unsaved: false });
    const allowed = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(allowed);
    expect(allowed.defaultPrevented).toBe(false);
  });
});

describe('useRefreshOnFocus', () => {
  const originalRefresh = useAppStore.getState().refresh;
  let refresh: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    refresh = vi.fn(async () => false);
    useAppStore.setState({ ready: true, refresh: refresh as unknown as typeof originalRefresh });
    setVisibility('visible');
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    useAppStore.setState({ refresh: originalRefresh });
  });

  it('re-reads the practice when the tab regains focus, at most once every few seconds', () => {
    renderHook(() => useRefreshOnFocus());
    act(() => window.dispatchEvent(new Event('focus')));
    expect(refresh).toHaveBeenCalledTimes(1);

    // Focus flicker (alt-tab back and forth) doesn't hammer storage.
    act(() => window.dispatchEvent(new Event('focus')));
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(refresh).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(6000);
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('ignores a visibility change to hidden', () => {
    renderHook(() => useRefreshOnFocus());
    setVisibility('hidden');
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(refresh).not.toHaveBeenCalled();
  });

  it('does nothing before the practice has loaded', () => {
    useAppStore.setState({ ready: false });
    renderHook(() => useRefreshOnFocus());
    act(() => window.dispatchEvent(new Event('focus')));
    expect(refresh).not.toHaveBeenCalled();
  });
});
