import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { CommandPalette } from '../CommandPalette';
import { useAppStore } from '../../../application/store';
import { buildFixtureData } from '../../../testing/fixtures';

const today = '2026-09-11';

function LocationProbe() {
  return <output data-testid="location">{useLocation().pathname}</output>;
}

function renderPalette(onClose = vi.fn()) {
  render(
    <MemoryRouter>
      <CommandPalette open onClose={onClose} />
      <LocationProbe />
    </MemoryRouter>,
  );
  return onClose;
}

describe('CommandPalette', () => {
  beforeEach(() => {
    useAppStore.setState({ data: buildFixtureData(today), today, ready: true });
  });

  it('runs the first match for what was typed on Enter, even when a stationary mouse sits over the list', async () => {
    const user = userEvent.setup();
    const onClose = renderPalette();
    const input = screen.getByTestId('command-input');
    await user.type(input, 'abc');
    const options = screen.getAllByRole('option');
    expect(options[0]).toHaveAttribute('aria-selected', 'true');

    // Rows re-rendering under a cursor that hasn't moved fire mouseenter —
    // that must not move the highlight.
    fireEvent.mouseEnter(options[options.length - 1].querySelector('button')!);
    expect(options[0]).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{Enter}');
    expect(screen.getByTestId('location')).toHaveTextContent('/clients/cl_abc');
    expect(onClose).toHaveBeenCalled();
  });

  it('follows real pointer movement, and starts again from the top on every keystroke', async () => {
    const user = userEvent.setup();
    renderPalette();
    await user.type(screen.getByTestId('command-input'), 'a');
    const options = screen.getAllByRole('option');
    fireEvent.mouseMove(options[2].querySelector('button')!);
    expect(options[2]).toHaveAttribute('aria-selected', 'true');
    expect(options[0]).toHaveAttribute('aria-selected', 'false');

    await user.type(screen.getByTestId('command-input'), 'b');
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('closes on Escape, as the hint promises', async () => {
    const user = userEvent.setup();
    const onClose = renderPalette();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps Tab inside the palette', async () => {
    const user = userEvent.setup();
    renderPalette();
    const input = screen.getByTestId('command-input');
    await user.type(input, 'abc');
    const buttons = screen.getAllByRole('option').map((o) => o.querySelector('button')!);
    buttons[buttons.length - 1].focus();
    await user.tab();
    expect(document.activeElement).toBe(input);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(buttons[buttons.length - 1]);
  });
});
