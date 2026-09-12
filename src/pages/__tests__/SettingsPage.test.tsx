import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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

describe('SettingsPage account actions (server mode)', () => {
  // SettingsPage in server mode also renders SnapshotHistoryCard and
  // MessagingStatusCard, each of which fetches its own status on mount —
  // give every test a fetch mock that answers those two calls sensibly, so
  // an unrelated card doesn't crash the page out from under the test being
  // exercised. Each test layers its own handler for the endpoint it cares
  // about on top of these defaults.
  function mockFetch(overrides: Record<string, () => Response | Promise<Response>>) {
    const routes: Record<string, () => Response | Promise<Response>> = {
      'GET /api/practice-data/history': () => new Response(JSON.stringify({ current: 0, versions: [] }), { status: 200 }),
      'GET /api/messages/status': () => new Response(JSON.stringify({ email: { provider: 'simulated', configured: true, from: null }, whatsapp: { mode: 'click_to_chat' }, sms: { provider: 'simulated', configured: false } }), { status: 200 }),
      ...overrides,
    };
    return vi.fn(async (url: string, init?: RequestInit) => {
      const handler = routes[`${init?.method ?? 'GET'} ${url}`];
      if (!handler) throw new Error(`unexpected fetch: ${init?.method ?? 'GET'} ${url}`);
      return handler();
    });
  }

  beforeEach(() => {
    configureRepository(new MemoryRepository());
    useAppStore.setState({
      data: buildFixtureData(today),
      today,
      ready: true,
      currentUserId: 'u_adnan',
      toasts: [],
      authMode: 'server',
      authUser: { id: 'u_adnan', username: 'adnan', name: 'Adnan Sarayqum', role: 'owner', mustChangePassword: false },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    useAppStore.setState({ authMode: 'local', authUser: null });
  });

  it('mentions that other sessions were signed out after a successful password change', async () => {
    vi.stubGlobal('fetch', mockFetch({ 'POST /api/auth/change-password': () => new Response(JSON.stringify({ ok: true }), { status: 200 }) }));
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    );
    // Let the history/messaging cards' own on-mount fetches settle first, so
    // their state updates don't land mid-test outside of act().
    await screen.findByTestId('messaging-status');
    await waitFor(() => expect(screen.getByTestId('snapshot-history')).toHaveTextContent('Nothing saved yet.'));
    await user.type(screen.getByLabelText('Current password'), 'OldPass1');
    await user.type(screen.getByLabelText('New password'), 'NewPass123');
    await user.type(screen.getByLabelText('Confirm new password'), 'NewPass123');
    await user.click(screen.getByRole('button', { name: 'Update password' }));

    expect(useAppStore.getState().toasts.map((t) => t.title)).toContain('Password updated');
    expect(useAppStore.getState().toasts.at(-1)?.description).toMatch(/other signed-in session.*signed out/i);
  });

  it('asks for confirmation before signing out every device, and does nothing if declined', async () => {
    const logoutEverywhereSpy = vi.fn(() => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', mockFetch({ 'POST /api/auth/logout-everywhere': logoutEverywhereSpy }));
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    );
    await screen.findByTestId('messaging-status');
    await waitFor(() => expect(screen.getByTestId('snapshot-history')).toHaveTextContent('Nothing saved yet.'));
    await user.click(screen.getByTestId('logout-everywhere'));
    expect(logoutEverywhereSpy).not.toHaveBeenCalled();
  });

  it('signs out every device and reloads once confirmed', async () => {
    const logoutEverywhereSpy = vi.fn(() => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', mockFetch({ 'POST /api/auth/logout-everywhere': logoutEverywhereSpy }));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    // jsdom's window.location.reload can't be spied on directly (its
    // descriptor isn't configurable); stub the whole location object
    // instead, restoring it via vi.unstubAllGlobals() in afterEach.
    const reloadSpy = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload: reloadSpy });
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    );
    await screen.findByTestId('messaging-status');
    await waitFor(() => expect(screen.getByTestId('snapshot-history')).toHaveTextContent('Nothing saved yet.'));
    await user.click(screen.getByTestId('logout-everywhere'));
    await waitFor(() => expect(reloadSpy).toHaveBeenCalledTimes(1));
    expect(logoutEverywhereSpy).toHaveBeenCalledTimes(1);
  });
});
