import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DuplicatePeopleCard } from '../DuplicatePeopleCard';
import { configureRepository, useAppStore } from '../../../application/store';
import { MemoryRepository } from '../../../application/persistence/memoryRepository';
import { buildFixtureData } from '../../../testing/fixtures';

const today = '2026-09-11';

function seed(withDuplicate: boolean) {
  const data = structuredClone(buildFixtureData(today));
  if (withDuplicate) {
    data.people.push({ id: 'p_dave_dup', practiceId: data.practice.id, fullName: 'THOMPSON, Dave' });
    data.personRoles.push({ id: 'pr_dup_1', practiceId: data.practice.id, personId: 'p_dave_dup', clientId: 'cl_abc', kind: 'director', identityVerification: 'not_started', personalCodeCaptured: false, evidenceStatus: 'none' });
  }
  useAppStore.setState({ data, today, ready: true, currentUserId: 'u_adnan', toasts: [], authMode: 'local', authUser: null });
}

describe('DuplicatePeopleCard', () => {
  beforeEach(() => {
    configureRepository(new MemoryRepository());
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('says so when there is nothing to merge, and offers no button', () => {
    seed(false);
    render(<DuplicatePeopleCard />);
    expect(screen.getByText('No duplicate people found.')).toBeInTheDocument();
    expect(screen.queryByTestId('merge-duplicate-people')).toBeNull();
  });

  it('lists each group with what a merge would keep, remove, and which clients it touches', () => {
    seed(true);
    render(<DuplicatePeopleCard />);
    const group = screen.getByTestId('duplicate-group-p_dave');
    expect(group).toHaveTextContent('Dave Thompson');
    expect(group).toHaveTextContent('recorded 2 times');
    expect(group).toHaveTextContent('Keeps “Dave Thompson”; merges “THOMPSON, Dave” · ABC Construction Ltd');
    expect(screen.getByTestId('merge-duplicate-people')).toHaveTextContent('Merge 1 duplicate');
  });

  it('asks first, and leaves everything alone when declined', async () => {
    seed(true);
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<DuplicatePeopleCard />);
    await userEvent.setup().click(screen.getByTestId('merge-duplicate-people'));
    expect(useAppStore.getState().data.people.some((p) => p.id === 'p_dave_dup')).toBe(true);
    expect(useAppStore.getState().toasts).toEqual([]);
  });

  it('merges on confirmation, confirms with a toast, and the card empties', async () => {
    seed(true);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<DuplicatePeopleCard />);
    await userEvent.setup().click(screen.getByTestId('merge-duplicate-people'));
    expect(useAppStore.getState().data.people.some((p) => p.id === 'p_dave_dup')).toBe(false);
    expect(useAppStore.getState().toasts.at(-1)).toMatchObject({ title: 'Duplicates merged', description: '1 record merged, 1 combined.' });
    expect(screen.getByText('No duplicate people found.')).toBeInTheDocument();
  });

  it('mentions Version history in the confirmation only in the shared mode', async () => {
    seed(true);
    useAppStore.setState({ authMode: 'server' });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<DuplicatePeopleCard />);
    await userEvent.setup().click(screen.getByTestId('merge-duplicate-people'));
    expect(confirmSpy.mock.calls[0][0]).toMatch(/Version history/);
  });
});
