import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UploadKeysCard } from '../UploadKeysCard';
import { configureRepository, useAppStore } from '../../../application/store';
import { MemoryRepository } from '../../../application/persistence/memoryRepository';
import { buildFixtureData } from '../../../testing/fixtures';
import { createUploadKey, listUploadKeys, revokeUploadKey } from '../../../integrations/intake';

vi.mock('../../../integrations/intake', () => ({
  listUploadKeys: vi.fn(),
  createUploadKey: vi.fn(),
  revokeUploadKey: vi.fn(),
}));

const today = '2026-09-11';
const list = vi.mocked(listUploadKeys);
const create = vi.mocked(createUploadKey);
const revoke = vi.mocked(revokeUploadKey);

describe('UploadKeysCard', () => {
  beforeEach(() => {
    configureRepository(new MemoryRepository());
    useAppStore.setState({ data: structuredClone(buildFixtureData(today)), today, ready: true, currentUserId: 'u_adnan', toasts: [], loadFailed: false });
  });
  afterEach(() => vi.clearAllMocks());

  it('renders nothing when there is no server to send to', async () => {
    list.mockResolvedValue(null);
    const { container } = render(<UploadKeysCard />);
    await waitFor(() => expect(list).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('makes a key, shows its secret once, and lists it without the secret', async () => {
    list.mockResolvedValue([]);
    create.mockResolvedValue({ ok: true, token: 'frk_secret_value', key: { id: 'ink_1', label: 'Ray’s iPhone', createdAt: '2026-09-11T10:00:00.000Z', lastUsedAt: null } });
    const user = userEvent.setup();
    render(<UploadKeysCard />);
    await user.type(await screen.findByTestId('upload-key-label'), 'Ray’s iPhone');
    await user.click(screen.getByTestId('upload-key-make'));

    expect(create).toHaveBeenCalledWith('Ray’s iPhone');
    expect(await screen.findByTestId('upload-key-token')).toHaveTextContent('frk_secret_value');
    const listed = screen.getByTestId('upload-key-list');
    expect(within(listed).getByText('Ray’s iPhone')).toBeInTheDocument();
    expect(within(listed).getByText('Not used yet')).toBeInTheDocument();
    expect(listed).not.toHaveTextContent('frk_secret_value');
    expect(screen.getByTestId('upload-key-url')).toHaveTextContent('/api/intake/batches');
  });

  it('says so when five keys are already in use', async () => {
    list.mockResolvedValue([]);
    create.mockResolvedValue({ ok: false, error: 'too_many' });
    const user = userEvent.setup();
    render(<UploadKeysCard />);
    await user.click(await screen.findByTestId('upload-key-make'));
    await waitFor(() => expect(useAppStore.getState().toasts[0]).toMatchObject({ title: 'That is five keys already', tone: 'error' }));
    expect(screen.queryByTestId('upload-key-fresh')).toBeNull();
  });

  it('removes a key from the list once the server has revoked it, and keeps it if not', async () => {
    list.mockResolvedValue([{ id: 'ink_1', label: 'Old phone', createdAt: '2026-09-01T10:00:00.000Z', lastUsedAt: '2026-09-10T10:00:00.000Z' }]);
    revoke.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const user = userEvent.setup();
    render(<UploadKeysCard />);
    await user.click(await screen.findByRole('button', { name: 'Remove Old phone' }));
    expect(screen.getByText('Old phone')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove Old phone' }));
    await waitFor(() => expect(screen.queryByText('Old phone')).toBeNull());
    expect(revoke).toHaveBeenCalledWith('ink_1');
  });
});
