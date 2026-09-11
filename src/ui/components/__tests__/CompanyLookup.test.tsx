import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CompanyLookup } from '../CompanyLookup';
import type { CompanyProfile } from '../../../integrations/companiesHouseTypes';

// Force the demo fallback deterministically, regardless of whether a real
// Companies House key happens to be configured in the environment running
// this test.
vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'not_configured' }), { status: 503 })));

describe('CompanyLookup', () => {
  it('searches, shows the demo-data badge, and hands back the picked profile', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn<(profile: CompanyProfile) => void>();
    render(<CompanyLookup onSelect={onSelect} />);

    await user.type(screen.getByTestId('company-lookup-input'), 'Harbour');

    const result = await screen.findByTestId('company-result-14829301', {}, { timeout: 2000 });
    expect(result).toHaveTextContent('HARBOUR CYCLES LTD');
    expect(screen.getByText('Demo data — not a live lookup')).toBeInTheDocument();

    await user.click(result);

    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));
    const [profile] = onSelect.mock.calls[0];
    expect(profile.companyNumber).toBe('14829301');
    expect(profile.companyName).toBe('HARBOUR CYCLES LTD');

    // The picked company now shows as a confirmed summary, not a live search box.
    expect(screen.getByTestId('company-lookup-selected')).toHaveTextContent('HARBOUR CYCLES LTD');
  });

  it('shows a no-matches message rather than an empty dropdown', async () => {
    const user = userEvent.setup();
    render(<CompanyLookup onSelect={vi.fn()} />);
    await user.type(screen.getByTestId('company-lookup-input'), 'zzzznonexistent');
    await waitFor(() => expect(screen.getByTestId('company-lookup-results')).toHaveTextContent('No matches'), { timeout: 2000 });
  });
});
