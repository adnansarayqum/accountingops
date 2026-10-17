import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AutoRemindersCard } from '../AutoRemindersCard';
import { configureRepository, useAppStore } from '../../../application/store';
import { MemoryRepository } from '../../../application/persistence/memoryRepository';
import { buildFixtureData } from '../../../testing/fixtures';
import { getAutomationStatus, previewAutomation, runAutomationNow, type AutomationStatus } from '../../../integrations/automation';

vi.mock('../../../integrations/automation', () => ({
  getAutomationStatus: vi.fn(),
  previewAutomation: vi.fn(),
  runAutomationNow: vi.fn(),
}));

const today = '2026-09-11';
const status: AutomationStatus = {
  status: 'preview',
  problem: null,
  enabled: false,
  workingHours: true,
  hours: { from: 8, to: 18, timezone: 'Europe/London' },
  due: [],
  waiting: 0,
  needsYou: [],
  emailReady: true,
  emailProblem: null,
  unknown: 0,
};
const planned = { jobId: 'job_1', clientName: 'Brown Property Ltd', jobName: 'Accounts', dueDate: '2026-10-14', stage: 'Email (30 days)', to: 'a@example.com', contactName: 'Alex Brown', subject: 'Documents still needed', body: 'Hi Alex,\n\nStill waiting.', sender: 'Ray' };

describe('AutoRemindersCard', () => {
  beforeEach(() => {
    configureRepository(new MemoryRepository());
    useAppStore.setState({ data: structuredClone(buildFixtureData(today)), today, ready: true, currentUserId: 'u_adnan', authUser: null, toasts: [], loadFailed: false });
    vi.mocked(getAutomationStatus).mockResolvedValue(status);
  });
  afterEach(() => vi.clearAllMocks());

  it('renders nothing when there is no server', async () => {
    vi.mocked(getAutomationStatus).mockResolvedValue(null);
    const { container } = render(<AutoRemindersCard />);
    await waitFor(() => expect(getAutomationStatus).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('starts off, says what it will and will not do, and switches on and off', async () => {
    const user = userEvent.setup();
    render(<AutoRemindersCard />);
    const toggle = await screen.findByTestId('auto-reminders-toggle');
    expect(screen.getByText('Off')).toBeInTheDocument();
    expect(screen.getByText(/Phone, WhatsApp and text steps are never sent for you/)).toBeInTheDocument();
    expect(screen.queryByTestId('auto-reminders-run')).toBeNull();

    await user.click(toggle);
    expect(useAppStore.getState().data.practice.automation).toEqual({ autoReminders: true });
    expect(await screen.findByText('On')).toBeInTheDocument();
    expect(screen.getByTestId('auto-reminders-run')).toBeInTheDocument();

    await user.click(screen.getByTestId('auto-reminders-toggle'));
    expect(useAppStore.getState().data.practice.automation).toEqual({ autoReminders: false });
  });

  it('cannot be changed by someone without permission', async () => {
    useAppStore.setState({ authUser: { id: 'u_x', username: 'x', name: 'X', role: 'staff', permissions: [] } as never });
    render(<AutoRemindersCard />);
    expect(await screen.findByTestId('auto-reminders-toggle')).toBeDisabled();
    expect(screen.getByText(/Only an owner or manager can change this/)).toBeInTheDocument();
  });

  it('previews the exact emails and what is left for a person, sending nothing', async () => {
    const user = userEvent.setup();
    vi.mocked(previewAutomation).mockResolvedValue({ ...status, due: [planned], needsYou: [{ jobId: 'job_2', clientName: 'Smith', jobName: 'VAT', stage: 'Phone call', reason: 'This step is a WhatsApp or text message, which you send yourself.' }] });
    render(<AutoRemindersCard />);
    await user.click(await screen.findByTestId('auto-reminders-preview'));
    const result = await screen.findByTestId('auto-reminders-preview-result');
    expect(result).toHaveTextContent('1 email due (only sent once this is switched on)');
    expect(result).toHaveTextContent('Brown Property Ltd — Accounts');
    expect(result).toHaveTextContent('Alex Brown (a@example.com)');
    expect(result).toHaveTextContent('Smith — VAT: This step is a WhatsApp or text message');
    expect(runAutomationNow).not.toHaveBeenCalled();
  });

  it('warns when no real email provider is connected, and cannot send then', async () => {
    useAppStore.getState().updateAutomationSettings({ autoReminders: true });
    vi.mocked(getAutomationStatus).mockResolvedValue({ ...status, enabled: true, emailReady: false, emailProblem: 'No real email provider is connected' });
    render(<AutoRemindersCard />);
    expect(await screen.findByTestId('auto-reminders-no-email')).toHaveTextContent('nothing can be sent yet');
    expect(screen.getByTestId('auto-reminders-run')).toBeDisabled();
  });

  it('sends what is due now on request, and reports it', async () => {
    const user = userEvent.setup();
    useAppStore.getState().updateAutomationSettings({ autoReminders: true });
    vi.mocked(runAutomationNow).mockResolvedValue({ ...status, status: 'done', enabled: true, sent: [{ clientName: 'Brown Property Ltd', jobName: 'Accounts', stage: 'Email (30 days)' }], failed: 0, unknownOutcome: 0 });
    render(<AutoRemindersCard />);
    await user.click(await screen.findByTestId('auto-reminders-run'));
    await waitFor(() => expect(runAutomationNow).toHaveBeenCalledWith({ ignoreHours: false }));
    expect(useAppStore.getState().toasts.at(-1)).toMatchObject({ title: '1 reminder sent', tone: 'success' });
  });

  it('says plainly when some reminders may or may not have gone', async () => {
    vi.mocked(getAutomationStatus).mockResolvedValue({ ...status, unknown: 2 });
    render(<AutoRemindersCard />);
    expect(await screen.findByTestId('auto-reminders-unknown')).toHaveTextContent('2 reminders may or may not have gone');
  });
});
