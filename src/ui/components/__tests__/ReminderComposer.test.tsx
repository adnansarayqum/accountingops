import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ReminderComposer } from '../ReminderComposer';
import { configureRepository, useAppStore } from '../../../application/store';
import { MemoryRepository } from '../../../application/persistence/memoryRepository';
import { buildFixtureData } from '../../../testing/fixtures';
import { getMessagingStatus, sendEmail } from '../../../integrations/messaging';

vi.mock('../../../integrations/messaging', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../integrations/messaging')>();
  return {
    ...actual,
    getMessagingStatus: vi.fn(async () => ({ email: { provider: 'simulated', configured: true, from: null }, whatsapp: { mode: 'click_to_chat' }, sms: { provider: 'simulated', configured: false } })),
    sendEmail: vi.fn(async () => ({ providerName: 'postmark', providerMessageId: 'pm-42', status: 'sent' as const })),
  };
});

const today = '2026-09-11';

function renderComposer(initialChannel: 'email' | 'whatsapp' | 'sms') {
  const job = useAppStore.getState().data.jobs.find((j) => j.id === 'job_abc_accounts')!;
  const onClose = vi.fn();
  render(<ReminderComposer job={job} open onClose={onClose} initialChannel={initialChannel} />);
  return onClose;
}

const lastComm = () => useAppStore.getState().data.communications[useAppStore.getState().data.communications.length - 1];

describe('ReminderComposer delivery', () => {
  beforeEach(() => {
    configureRepository(new MemoryRepository());
    useAppStore.setState({ data: buildFixtureData(today), today, ready: true, currentUserId: 'u_adnan', toasts: [] });
    vi.mocked(sendEmail).mockClear();
  });
  afterEach(() => vi.restoreAllMocks());

  it('opens WhatsApp with the drafted message and logs the reminder as handed off', async () => {
    const user = userEvent.setup();
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const onClose = renderComposer('whatsapp');
    await waitFor(() => expect(screen.getByTestId('send-reminder-confirm')).toHaveTextContent('Open WhatsApp'));
    await user.click(screen.getByTestId('send-reminder-confirm'));

    expect(open).toHaveBeenCalledTimes(1);
    const url = String(open.mock.calls[0][0]);
    expect(url).toMatch(/^https:\/\/wa\.me\/447700900123\?text=/);
    expect(decodeURIComponent(url.split('text=')[1])).toContain('loan statement');
    const comm = lastComm();
    expect(comm.channel).toBe('whatsapp');
    expect(comm.deliveryStatus).toBe('handed_off');
    expect(comm.simulated).toBe(false);
    expect(useAppStore.getState().toasts.map((t) => t.title)).toContain('WhatsApp opened');
    expect(onClose).toHaveBeenCalled();
  });

  it('keeps email simulated when no provider is configured', async () => {
    const user = userEvent.setup();
    renderComposer('email');
    await waitFor(() => expect(screen.getByTestId('reminder-delivery-note')).toHaveTextContent('simulated'));
    await user.click(screen.getByTestId('send-reminder-confirm'));
    expect(sendEmail).not.toHaveBeenCalled();
    expect(lastComm().deliveryStatus).toBe('simulated');
    expect(lastComm().simulated).toBe(true);
    expect(useAppStore.getState().toasts.map((t) => t.title)).toContain('Reminder sent');
  });

  it('sends email through the server when a provider is live, and records how it went', async () => {
    vi.mocked(getMessagingStatus).mockResolvedValueOnce({ email: { provider: 'postmark', configured: true, from: 'Practice <r@p.example>' }, whatsapp: { mode: 'click_to_chat' }, sms: { provider: 'simulated', configured: false } });
    const user = userEvent.setup();
    renderComposer('email');
    await waitFor(() => expect(screen.getByTestId('send-reminder-confirm')).toHaveTextContent('Send email'));
    await user.click(screen.getByTestId('send-reminder-confirm'));

    await waitFor(() => expect(sendEmail).toHaveBeenCalledTimes(1));
    const [input] = vi.mocked(sendEmail).mock.calls[0];
    expect(input.to).toBe('dave@abc-construction.example');
    expect(input.idempotencyKey).toMatch(/^send_/);
    await waitFor(() => expect(lastComm().deliveryStatus).toBe('sent'));
    expect(lastComm().providerName).toBe('postmark');
    expect(lastComm().providerMessageId).toBe('pm-42');
    expect(useAppStore.getState().toasts.map((t) => t.title)).toContain('Email sent');
  });

  it('logs nothing when the server refuses the email, and says why', async () => {
    vi.mocked(getMessagingStatus).mockResolvedValueOnce({ email: { provider: 'postmark', configured: true, from: 'r@p.example' }, whatsapp: { mode: 'click_to_chat' }, sms: { provider: 'simulated', configured: false } });
    vi.mocked(sendEmail).mockRejectedValueOnce(new Error('The email provider refused this message.'));
    const user = userEvent.setup();
    const before = useAppStore.getState().data.communications.length;
    const onClose = renderComposer('email');
    await waitFor(() => expect(screen.getByTestId('send-reminder-confirm')).toHaveTextContent('Send email'));
    await user.click(screen.getByTestId('send-reminder-confirm'));
    await waitFor(() => expect(useAppStore.getState().toasts.map((t) => t.title)).toContain("Couldn't send the email"));
    expect(useAppStore.getState().data.communications).toHaveLength(before);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('ReminderComposer with no contact on file', () => {
  // A client onboarded from a Companies House lookup, say, can genuinely
  // have no contact recorded yet. Regression for a real crash: opening the
  // composer for such a client threw "Cannot read properties of undefined
  // (reading 'name')" from inside a useMemo, taking the whole screen down
  // via the app's ErrorBoundary rather than showing anything useful.
  beforeEach(() => {
    configureRepository(new MemoryRepository());
    const data = buildFixtureData(today);
    data.contacts = data.contacts.filter((c) => c.clientId !== 'cl_abc');
    useAppStore.setState({ data, today, ready: true, currentUserId: 'u_adnan', toasts: [] });
  });
  afterEach(() => vi.restoreAllMocks());

  it('shows a clear message and a way to add one, instead of crashing', async () => {
    const job = useAppStore.getState().data.jobs.find((j) => j.id === 'job_abc_accounts')!;
    const onClose = vi.fn();
    render(
      <MemoryRouter>
        <ReminderComposer job={job} open onClose={onClose} />
      </MemoryRouter>,
    );

    expect(await screen.findByTestId('reminder-no-contact')).toHaveTextContent('No contact on file for ABC Construction Ltd yet.');
    expect(screen.queryByTestId('send-reminder-confirm')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Channel')).not.toBeInTheDocument();

    const link = screen.getByRole('link', { name: /Go to ABC Construction Ltd/ });
    expect(link).toHaveAttribute('href', '/clients/cl_abc');
    await userEvent.setup().click(link);
    expect(onClose).toHaveBeenCalled();
  });
});
