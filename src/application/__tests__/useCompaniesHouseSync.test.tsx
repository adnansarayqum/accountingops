import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { configureRepository, useAppStore } from '../store';
import { MemoryRepository } from '../persistence/memoryRepository';
import { buildFixtureData } from '../../testing/fixtures';
import { useCompaniesHouseSync } from '../useCompaniesHouseSync';
import { getCompaniesHouseStatus, getCompanyPeople, getCompanyProfile } from '../../integrations/companiesHouse';

vi.mock('../../integrations/companiesHouse', () => ({
  getCompaniesHouseStatus: vi.fn(async () => ({ configured: true })),
  getCompanyProfile: vi.fn(async (companyNumber: string) => ({
    companyNumber,
    companyName: `Company ${companyNumber}`,
    companyStatus: 'active',
    companyType: 'ltd',
    dateOfCreation: '2015-01-01',
    sicCodes: [],
    previousNames: [],
    registeredOfficeAddress: { formatted: '1 Test Street' },
    accountingReferenceDate: null,
    nextAccountsDueOn: null,
    nextAccountsPeriodEndOn: null,
    nextConfirmationStatementDueOn: null,
    source: 'companies_house',
  })),
  getCompanyPeople: vi.fn(async () => ({ directors: [], pscs: [], source: 'companies_house' })),
}));

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
}

const today = '2026-09-11';

describe('useCompaniesHouseSync', () => {
  const original = {
    refresh: useAppStore.getState().refresh,
    refreshClientsFromCompaniesHouse: useAppStore.getState().refreshClientsFromCompaniesHouse,
  };
  let calls: string[];

  beforeEach(() => {
    calls = [];
    vi.mocked(getCompaniesHouseStatus).mockClear();
    vi.mocked(getCompanyProfile).mockClear();
    vi.mocked(getCompanyPeople).mockClear();
    configureRepository(new MemoryRepository());
    // Fixture clients have company numbers and have never been synced, so
    // every one of them is stale.
    useAppStore.setState({
      data: buildFixtureData(today),
      today,
      ready: true,
      loadFailed: false,
      unsaved: false,
      refresh: vi.fn(async () => {
        calls.push('refresh');
        return false;
      }),
      refreshClientsFromCompaniesHouse: vi.fn(() => {
        calls.push('apply');
        return { clientsUpdated: 0, peopleAdded: 0, verificationsConfirmed: 0 };
      }),
    });
  });

  afterEach(() => {
    useAppStore.setState({ refresh: original.refresh, refreshClientsFromCompaniesHouse: original.refreshClientsFromCompaniesHouse });
  });

  it('does not sync from a hidden tab, and catches up when the tab becomes visible', async () => {
    setVisibility('hidden');
    renderHook(() => useCompaniesHouseSync());
    await act(async () => {
      await Promise.resolve();
    });
    expect(getCompaniesHouseStatus).not.toHaveBeenCalled();
    expect(getCompanyProfile).not.toHaveBeenCalled();

    setVisibility('visible');
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await waitFor(() => expect(calls).toContain('apply'));
    expect(getCompanyProfile).toHaveBeenCalled();
  });

  it('re-reads the stored practice immediately before applying a batch', async () => {
    setVisibility('visible');
    renderHook(() => useCompaniesHouseSync());
    await waitFor(() => expect(calls).toContain('apply'));
    expect(calls).toEqual(['refresh', 'apply']);
  });
});
