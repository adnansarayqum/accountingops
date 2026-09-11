import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeToggle } from '../ThemeToggle';

function setSystemPrefersDark(dark: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({ matches: dark, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
}

describe('ThemeToggle', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
    setSystemPrefersDark(false);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('cycles light -> dark -> system on repeated clicks, updating the document class each time', async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);
    const button = screen.getByTestId('theme-toggle');

    // Starts on "system", resolved to light (OS prefers light).
    expect(button).toHaveAccessibleName(/matching system theme/i);
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    await user.click(button); // system -> light
    expect(button).toHaveAccessibleName(/light theme/i);
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    await user.click(button); // light -> dark
    expect(button).toHaveAccessibleName(/dark theme/i);
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    await user.click(button); // dark -> system (still resolves light, OS unchanged)
    expect(button).toHaveAccessibleName(/matching system theme/i);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});
