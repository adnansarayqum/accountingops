import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
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
      'GET /api/hmrc/status': () => new Response(JSON.stringify({ configured: false }), { status: 200 }),
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
    cleanup();
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

describe('SettingsPage least privilege (server mode)', () => {
  // The server refuses these operations for the role regardless (see
  // docs/PERMISSIONS.md); the page just stops offering what would be refused.
  const ACCOUNTANT_PERMISSIONS = ['data.read', 'data.write', 'history.read', 'messages.send', 'hmrc.read'];

  function signInWith(permissions: string[] | undefined) {
    useAppStore.setState({
      authMode: 'server',
      authUser: { id: 'u_adnan', username: 'adnan', name: 'Adnan Sarayqum', role: permissions ? 'accountant' : 'owner', mustChangePassword: false, permissions },
    });
  }

  beforeEach(() => {
    configureRepository(new MemoryRepository());
    useAppStore.setState({ data: buildFixtureData(today), today, ready: true, currentUserId: 'u_adnan', toasts: [] });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/api/practice-data/history') return new Response(JSON.stringify({ current: 2, versions: [{ version: 2, savedBy: 'u_adnan', savedAt: '2026-09-11T10:00:00Z' }, { version: 1, savedBy: 'u_adnan', savedAt: '2026-09-10T10:00:00Z' }] }), { status: 200 });
        if (url === '/api/messages/status') return new Response(JSON.stringify({ email: { provider: 'simulated', configured: true, from: null }, whatsapp: { mode: 'click_to_chat' }, sms: { provider: 'simulated', configured: false } }), { status: 200 });
        // Everything else the page's cards ask for (HMRC status, briefing settings) is simply "not available".
        return new Response(JSON.stringify({ error: 'not_configured' }), { status: 503 });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    useAppStore.setState({ authMode: 'local', authUser: null });
  });

  it('an accountant is not offered restore, threshold edits, or renaming a colleague — but can still fix their own name', async () => {
    signInWith(ACCOUNTANT_PERMISSIONS);
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    );
    await screen.findByTestId('snapshot-version-2');
    expect(screen.queryByTestId('restore-version-1')).not.toBeInTheDocument();
    expect(screen.getByText('Only an owner can restore an earlier version.')).toBeVisible();

    expect(screen.queryByRole('button', { name: 'Save thresholds' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Due soon window')).toBeDisabled();

    expect(screen.queryByRole('button', { name: 'Edit name for Sarah Mitchell' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit name for Adnan Sarayqum' })).toBeVisible();
  });

  it('an owner (or any server that does not report permissions yet) sees everything, as before', async () => {
    for (const permissions of [undefined, [...ACCOUNTANT_PERMISSIONS, 'snapshot.restore', 'practice.configure', 'team.manage', 'hmrc.connect']]) {
      signInWith(permissions);
      const { unmount } = render(
        <MemoryRouter>
          <SettingsPage />
        </MemoryRouter>,
      );
      await screen.findByTestId('snapshot-version-2');
      expect(screen.getByTestId('restore-version-1')).toBeVisible();
      expect(screen.getByRole('button', { name: 'Save thresholds' })).toBeVisible();
      expect(screen.getByRole('button', { name: 'Edit name for Sarah Mitchell' })).toBeVisible();
      unmount();
    }
  });
});

describe('SettingsPage timing thresholds', () => {
  beforeEach(() => {
    configureRepository(new MemoryRepository());
    useAppStore.setState({ data: buildFixtureData(today), today, ready: true, currentUserId: 'u_adnan', toasts: [] });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/messages/status') return new Response(JSON.stringify({ email: { provider: 'simulated', configured: true, from: null }, whatsapp: { mode: 'click_to_chat' }, sms: { provider: 'simulated', configured: false } }), { status: 200 });
      if (url === '/api/hmrc/status') return new Response(JSON.stringify({ configured: false }), { status: 200 });
      throw new Error(`unexpected fetch: ${url}`);
    }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  const settleAncillaryCards = async () => {
    await screen.findByTestId('messaging-status');
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/hmrc/status'));
  };

  it('shows the built-in defaults when the practice has never customised anything', async () => {
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    );
    expect(screen.getByLabelText('Due soon window')).toHaveValue(14);
    expect(screen.getByLabelText('Identity verification look-ahead')).toHaveValue(45);
    expect(screen.getByLabelText('Stale job threshold')).toHaveValue(14);
    expect(screen.getByLabelText('Review wait threshold')).toHaveValue(7);
    expect(screen.getByLabelText('Approval wait threshold')).toHaveValue(10);
    await settleAncillaryCards();
  });

  it('shows a stored partial override merged with defaults for the rest', async () => {
    useAppStore.setState({ data: { ...useAppStore.getState().data, practice: { ...useAppStore.getState().data.practice, thresholds: { dueSoonDays: 21 } } } });
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    );
    expect(screen.getByLabelText('Due soon window')).toHaveValue(21);
    expect(screen.getByLabelText('Stale job threshold')).toHaveValue(14);
    await settleAncillaryCards();
  });

  it('saves an edited value, confirms with a toast, and it takes effect immediately', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    );
    await settleAncillaryCards();
    const dueSoon = screen.getByLabelText('Due soon window');
    await user.clear(dueSoon);
    await user.type(dueSoon, '21');
    await user.click(screen.getByRole('button', { name: 'Save thresholds' }));

    expect(useAppStore.getState().data.practice.thresholds?.dueSoonDays).toBe(21);
    expect(useAppStore.getState().toasts.at(-1)).toMatchObject({ title: 'Timing thresholds updated' });
  });

  it('rejects an out-of-range value with a field error, and saves nothing', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    );
    await settleAncillaryCards();
    const stale = screen.getByLabelText('Stale job threshold');
    await user.clear(stale);
    await user.type(stale, '0');
    await user.click(screen.getByRole('button', { name: 'Save thresholds' }));

    expect(screen.getByText('Enter a whole number from 1 to 365.')).toBeVisible();
    expect(useAppStore.getState().data.practice.thresholds).toBeUndefined();
    expect(useAppStore.getState().toasts).toEqual([]);
  });

  it('resets the form to defaults without saving until Save is pressed', async () => {
    useAppStore.setState({ data: { ...useAppStore.getState().data, practice: { ...useAppStore.getState().data.practice, thresholds: { dueSoonDays: 30 } } } });
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    );
    await settleAncillaryCards();
    expect(screen.getByLabelText('Due soon window')).toHaveValue(30);
    await user.click(screen.getByRole('button', { name: 'Reset to defaults' }));
    expect(screen.getByLabelText('Due soon window')).toHaveValue(14);
    // Not saved yet — the stored value is untouched until Save is pressed.
    expect(useAppStore.getState().data.practice.thresholds).toEqual({ dueSoonDays: 30 });

    await user.click(screen.getByRole('button', { name: 'Save thresholds' }));
    expect(useAppStore.getState().data.practice.thresholds?.dueSoonDays).toBe(14);
  });
});
