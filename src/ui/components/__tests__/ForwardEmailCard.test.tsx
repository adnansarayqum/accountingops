import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ForwardEmailCard } from '../ForwardEmailCard';
import { configureRepository, useAppStore } from '../../../application/store';
import { MemoryRepository } from '../../../application/persistence/memoryRepository';
import { buildFixtureData } from '../../../testing/fixtures';
import { getEmailForwarding, saveEmailSenders } from '../../../integrations/intake';

vi.mock('../../../integrations/intake', () => ({
  getEmailForwarding: vi.fn(),
  saveEmailSenders: vi.fn(),
}));

const today = '2026-09-11';
const get = vi.mocked(getEmailForwarding);
const save = vi.mocked(saveEmailSenders);
const ready = { address: 'abc123@inbound.example.com', ready: true, senders: ['ray@example.com'], maxSenders: 5 };

describe('ForwardEmailCard', () => {
  beforeEach(() => {
    configureRepository(new MemoryRepository());
    useAppStore.setState({ data: structuredClone(buildFixtureData(today)), today, ready: true, currentUserId: 'u_adnan', toasts: [], loadFailed: false });
  });
  afterEach(() => vi.clearAllMocks());

  it('renders nothing when there is no server', async () => {
    get.mockResolvedValue(null);
    const { container } = render(<ForwardEmailCard />);
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the address to forward to and the saved senders', async () => {
    get.mockResolvedValue(ready);
    render(<ForwardEmailCard />);
    expect(await screen.findByTestId('forward-email-address')).toHaveTextContent('abc123@inbound.example.com');
    expect(screen.getByTestId('forward-email-senders')).toHaveValue('ray@example.com');
    expect(screen.getByText('Ready')).toBeInTheDocument();
  });

  it('explains when the server has no inbound address yet, but still lets senders be saved', async () => {
    get.mockResolvedValue({ ...ready, address: null, ready: false });
    render(<ForwardEmailCard />);
    expect(await screen.findByTestId('forward-email-unavailable')).toHaveTextContent('INBOUND_EMAIL');
    expect(screen.getByText('Not set up')).toBeInTheDocument();
    expect(screen.queryByTestId('forward-email-address')).toBeNull();
  });

  it('saves addresses split on commas, spaces and semicolons, and shows what the server kept', async () => {
    get.mockResolvedValue({ ...ready, senders: [] });
    save.mockResolvedValue({ ok: true, senders: ['ray@example.com', 'ray@work.co.uk'] });
    const user = userEvent.setup();
    render(<ForwardEmailCard />);
    await user.type(await screen.findByTestId('forward-email-senders'), 'Ray@Example.com; ray@work.co.uk');
    await user.click(screen.getByTestId('forward-email-save'));
    expect(save).toHaveBeenCalledWith(['Ray@Example.com', 'ray@work.co.uk']);
    await waitFor(() => expect(screen.getByTestId('forward-email-senders')).toHaveValue('ray@example.com, ray@work.co.uk'));
    expect(useAppStore.getState().toasts[0]).toMatchObject({ title: 'Addresses saved', tone: 'success' });
  });

  it('says which address was refused', async () => {
    get.mockResolvedValue(ready);
    save.mockResolvedValue({ ok: false, error: 'taken', email: 'ray@example.com' });
    const user = userEvent.setup();
    render(<ForwardEmailCard />);
    await user.click(await screen.findByTestId('forward-email-save'));
    await waitFor(() => expect(useAppStore.getState().toasts[0]).toMatchObject({ title: "Couldn't save those addresses", description: 'ray@example.com is already used by someone else.', tone: 'error' }));
  });
});
