import { describe, expect, it } from 'vitest';
import { mapCompanyProfile, mapSearchResponse } from '../companiesHouseMappers.mjs';

describe('mapSearchResponse', () => {
  it('maps Companies House search items to the slim shape', () => {
    const raw = {
      total_results: 2,
      items: [
        { company_number: '14829301', title: 'HARBOUR CYCLES LTD', company_status: 'active', company_type: 'ltd', date_of_creation: '2023-02-14', address_snippet: 'Bristol, BS1 4RN' },
        { company_number: '13207745', title: 'MERIDIAN CONSULTING GROUP LTD', company_status: 'active', company_type: 'ltd', date_of_creation: '2021-06-02' },
      ],
    };
    const mapped = mapSearchResponse(raw);
    expect(mapped.source).toBe('companies_house');
    expect(mapped.totalResults).toBe(2);
    expect(mapped.results).toHaveLength(2);
    expect(mapped.results[0]).toEqual({
      companyNumber: '14829301',
      title: 'HARBOUR CYCLES LTD',
      companyStatus: 'active',
      companyType: 'ltd',
      dateOfCreation: '2023-02-14',
      addressSnippet: 'Bristol, BS1 4RN',
    });
    // A missing optional field maps to null, not undefined, so the client never sees a hole.
    expect(mapped.results[1].addressSnippet).toBeNull();
  });

  it('handles an empty result set', () => {
    expect(mapSearchResponse({ items: [] })).toEqual({ results: [], totalResults: 0, source: 'companies_house' });
  });
});

describe('mapCompanyProfile', () => {
  it('maps a full company profile including address and accounting dates', () => {
    const raw = {
      company_number: '14829301',
      company_name: 'HARBOUR CYCLES LTD',
      company_status: 'active',
      type: 'ltd',
      date_of_creation: '2023-02-14',
      sic_codes: ['47650'],
      registered_office_address: { premises: '12', address_line_1: 'Quayside Road', locality: 'Bristol', postal_code: 'BS1 4RN', country: 'England' },
      accounts: {
        accounting_reference_date: { day: '28', month: '02' },
        next_accounts: { due_on: '2025-11-14', period_end_on: '2025-02-28' },
      },
      confirmation_statement: { next_due: '2025-03-14' },
    };
    const mapped = mapCompanyProfile(raw);
    expect(mapped.companyNumber).toBe('14829301');
    expect(mapped.registeredOfficeAddress.formatted).toBe('12, Quayside Road, Bristol, BS1 4RN, England');
    expect(mapped.accountingReferenceDate).toEqual({ day: '28', month: '02' });
    expect(mapped.nextAccountsDueOn).toBe('2025-11-14');
    expect(mapped.nextConfirmationStatementDueOn).toBe('2025-03-14');
    expect(mapped.source).toBe('companies_house');
  });

  it('tolerates a profile with no registered office or accounts data', () => {
    const mapped = mapCompanyProfile({ company_number: '00000001', company_name: 'BARE LTD' });
    expect(mapped.registeredOfficeAddress).toBeUndefined();
    expect(mapped.accountingReferenceDate).toBeNull();
    expect(mapped.sicCodes).toEqual([]);
  });
});
