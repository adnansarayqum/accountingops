import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SettingsPage } from '../SettingsPage';
import { configureRepository, useAppStore } from '../../application/store';
import { MemoryRepository } from '../../application/persistence/memoryRepository';
import { buildFixtureData } from '../../testing/fixtures';

const today = '2026-09-11';

describe('SettingsPage team member rename', () => {
  beforeEach(() => {
    configureRepository(new MemoryRepository());
    useAppStore.setState({ data: buildFixtureData(today), today, ready: true, currentUserId: 'u_adnan', toasts: [] });
  });

  it('confirms a rename with a toast, like every other change', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: 'Edit name for Sarah Mitchell' }));
    const box = screen.getByTestId('team-member-u_sarah').querySelector('input')!;
    await user.clear(box);
    await user.type(box, 'Sarah Raihan Mitchell');
    await user.click(screen.getByRole('button', { name: 'Save name' }));

    expect(useAppStore.getState().toasts.map((t) => t.title)).toContain('Name updated');
    expect(useAppStore.getState().toasts.at(-1)?.description).toBe('Sarah Mitchell is now Sarah Raihan Mitchell.');
  });

  it('says nothing when the name was left as it was', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: 'Edit name for Sarah Mitchell' }));
    await user.click(screen.getByRole('button', { name: 'Save name' }));
    expect(useAppStore.getState().toasts).toEqual([]);
  });
});
