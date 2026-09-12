import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RefreshAllCompaniesHouseButton } from '../RefreshAllCompaniesHouseButton';
import { configureRepository, useAppStore } from '../../../application/store';
import { MemoryRepository } from '../../../application/persistence/memoryRepository';
import { buildFixtureData } from '../../../testing/fixtures';
import { getCompaniesHouseStatus, getCompanyPeople, lookupCompanyProfile } from '../../../integrations/companiesHouse';
import { refreshAllClients } from '../../../application/refreshAllClients';

vi.mock('../../../application/refreshAllClients', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../application/refreshAllClients')>();
  return { ...actual, refreshAllClients: vi.fn(actual.refreshAllClients) };
});

vi.mock('../../../integrations/companiesHouse', () => ({
  getCompaniesHouseStatus: vi.fn(async () => ({ configured: true })),
  lookupCompanyProfile: vi.fn(async (companyNumber: string) => ({
    outcome: 'live',
    profile: {
      companyNumber,
      companyName: `Company ${companyNumber}`,
      companyStatus: 'active',
      companyType: 'ltd',
      dateOfCreation: '2015-01-01',
      sicCodes: [],
      previousNames: [],
      registeredOfficeAddress: { formatted: `${companyNumber} Refreshed Street` },
      accountingReferenceDate: null,
      nextAccountsDueOn: null,
      nextAccountsPeriodEndOn: null,
      nextConfirmationStatementDueOn: null,
      source: 'companies_house',
    },
  })),
  getCompanyPeople: vi.fn(async () => ({ directors: [], pscs: [], source: 'companies_house' })),
}));

const today = '2026-09-11';
const status = vi.mocked(getCompaniesHouseStatus);
const lookup = vi.mocked(lookupCompanyProfile);
const people = vi.mocked(getCompanyPeople);

describe('RefreshAllCompaniesHouseButton', () => {
  beforeEach(() => {
    configureRepository(new MemoryRepository());
    useAppStore.setState({ data: structuredClone(buildFixtureData(today)), today, ready: true, currentUserId: 'u_adnan', toasts: [], loadFailed: false });
    status.mockResolvedValue({ configured: true });
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('is not offered without a live Companies House key', async () => {
    status.mockResolvedValue({ configured: false });
    render(<RefreshAllCompaniesHouseButton />);
    await waitFor(() => expect(status).toHaveBeenCalled());
    expect(screen.queryByTestId('refresh-all-companies-house')).toBeNull();
  });

  it('refreshes every company with a number, shows progress, saves once and sums it up', async () => {
    render(<RefreshAllCompaniesHouseButton />);
    const button = await screen.findByTestId('refresh-all-companies-house');
    expect(button).toHaveTextContent('Refresh all from Companies House');
    const withNumbers = useAppStore.getState().data.identifiers.filter((i) => i.kind === 'company_number').length;
    const activitiesBefore = useAppStore.getState().data.activities.length;

    await userEvent.setup().click(button);

    await waitFor(() => expect(useAppStore.getState().toasts.at(-1)?.title).toBe('Refreshed from Companies House'));
    expect(useAppStore.getState().toasts.at(-1)?.description).toBe(`${withNumbers} clients refreshed.`);
    expect(lookup).toHaveBeenCalledTimes(withNumbers);
    expect(people).toHaveBeenCalledTimes(withNumbers);
    const s = useAppStore.getState().data;
    expect(s.clients.find((c) => c.id === 'cl_abc')?.registeredOffice?.formatted).toBe('09876543 Refreshed Street');
    // Every client got a "refreshed" activity from one saved change, and the button is idle again.
    expect(s.activities.length - activitiesBefore).toBe(withNumbers);
    expect(button).toHaveTextContent('Refresh all from Companies House');
    expect(button).not.toBeDisabled();
  });

  it('names the clients it could not look up and still saves the rest', async () => {
    lookup.mockImplementation(async (companyNumber: string) => (companyNumber === '09876543' ? { outcome: 'not_found', profile: null } : { outcome: 'live', profile: { companyNumber, companyName: 'X', companyStatus: 'active', companyType: 'ltd', dateOfCreation: null, sicCodes: [], previousNames: [], registeredOfficeAddress: { formatted: 'ok' }, accountingReferenceDate: null, nextAccountsDueOn: null, nextAccountsPeriodEndOn: null, nextConfirmationStatementDueOn: null, source: 'companies_house' } }));
    render(<RefreshAllCompaniesHouseButton />);
    await userEvent.setup().click(await screen.findByTestId('refresh-all-companies-house'));
    await waitFor(() => expect(useAppStore.getState().toasts.at(-1)?.title).toMatch(/couldn't be looked up/));
    const toast = useAppStore.getState().toasts.at(-1)!;
    expect(toast.title).toMatch(/^\d+ clients refreshed — 1 couldn't be looked up$/);
    expect(toast.description).toContain('ABC Construction Ltd');
    expect(useAppStore.getState().data.clients.find((c) => c.id === 'cl_abc')?.companiesHouseSyncedAt).toBeUndefined();
  });

  it('counts down a rate-limit pause on the button instead of looking stuck', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let finish!: () => void;
    vi.mocked(refreshAllClients).mockImplementationOnce(async (candidates, deps) => {
      deps.onProgress?.({ done: 25, total: candidates.length, pausedUntil: Date.now() + 41_000 });
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      deps.onProgress?.({ done: candidates.length, total: candidates.length });
      return { total: candidates.length, refreshed: candidates.length, failed: [], peopleAdded: 0, verificationsConfirmed: 0 };
    });
    try {
      render(<RefreshAllCompaniesHouseButton />);
      const button = await screen.findByTestId('refresh-all-companies-house');
      await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(button);
      await waitFor(() => expect(button).toHaveTextContent(/waiting 41s for Companies House's rate limit/));
      await act(async () => {
        vi.advanceTimersByTime(3_000);
      });
      expect(button).toHaveTextContent(/waiting 38s/);
      await act(async () => {
        finish();
      });
      await waitFor(() => expect(useAppStore.getState().toasts.at(-1)?.title).toBe('Refreshed from Companies House'));
      expect(button).toHaveTextContent('Refresh all from Companies House');
    } finally {
      vi.useRealTimers();
    }
  });

  it('is disabled while practice data failed to load', async () => {
    useAppStore.setState({ loadFailed: true });
    render(<RefreshAllCompaniesHouseButton />);
    expect(await screen.findByTestId('refresh-all-companies-house')).toBeDisabled();
    act(() => useAppStore.setState({ loadFailed: false }));
  });
});
