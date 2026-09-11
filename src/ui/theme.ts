import { useEffect, useState } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'practiceops.theme';

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches;
}

function readStoredMode(): ThemeMode {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch {
    /* localStorage unavailable — fall through to default */
  }
  return 'system';
}

function resolve(mode: ThemeMode): ResolvedTheme {
  return mode === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : mode;
}

function applyResolvedTheme(resolved: ResolvedTheme): void {
  document.documentElement.classList.toggle('dark', resolved === 'dark');
}

/**
 * The initial `.dark` class is set by an inline script in index.html
 * (runs before the bundle loads, so there's no flash of the wrong theme).
 * This hook just needs to agree with that script's resolution on mount,
 * which it does by reading the same localStorage key.
 *
 * Theme state for the toggle in the header. Persists an explicit choice;
 * "system" tracks the OS preference live via a media query listener.
 */
export function useTheme(): { mode: ThemeMode; resolved: ResolvedTheme; setMode: (mode: ThemeMode) => void } {
  const [mode, setModeState] = useState<ThemeMode>(readStoredMode);
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolve(mode));

  useEffect(() => {
    const next = resolve(mode);
    setResolved(next);
    applyResolvedTheme(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      /* ignore — theme just won't persist across reloads */
    }
  }, [mode]);

  useEffect(() => {
    if (mode !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      const next = resolve('system');
      setResolved(next);
      applyResolvedTheme(next);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [mode]);

  const setMode = (next: ThemeMode) => setModeState(next);

  return { mode, resolved, setMode };
}
