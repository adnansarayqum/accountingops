import { Moon, Sun, SunMoon } from 'lucide-react';
import { useTheme, type ThemeMode } from '../theme';

const NEXT: Record<ThemeMode, ThemeMode> = { light: 'dark', dark: 'system', system: 'light' };
const LABEL: Record<ThemeMode, string> = { light: 'Light theme', dark: 'Dark theme', system: 'Matching system theme' };

/** Cycles light → dark → system. Icon reflects the resolved theme; the label always names the current mode. */
export function ThemeToggle() {
  const { mode, resolved, setMode } = useTheme();
  const Icon = mode === 'system' ? SunMoon : resolved === 'dark' ? Moon : Sun;
  return (
    <button
      type="button"
      onClick={() => setMode(NEXT[mode])}
      className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800"
      aria-label={`${LABEL[mode]} — click to change`}
      title={LABEL[mode]}
      data-testid="theme-toggle"
    >
      <Icon className="h-5 w-5" />
    </button>
  );
}
