import { describe, expect, it } from 'vitest';
import { mapCompanyProfile, mapOfficers, mapPscs, mapSearchResponse } from '../companiesHouseMappers.mjs';

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
      previous_company_names: [{ name: 'OLD HARBOUR CYCLES LTD', ceased_on: '2023-01-01', effective_from: '2020-01-01' }],
    };
    const mapped = mapCompanyProfile(raw);
    expect(mapped.companyNumber).toBe('14829301');
    expect(mapped.registeredOfficeAddress.formatted).toBe('12, Quayside Road, Bristol, BS1 4RN, England');
    expect(mapped.accountingReferenceDate).toEqual({ day: '28', month: '02' });
    expect(mapped.nextAccountsDueOn).toBe('2025-11-14');
    expect(mapped.nextConfirmationStatementDueOn).toBe('2025-03-14');
    expect(mapped.previousNames).toEqual(['OLD HARBOUR CYCLES LTD']);
    expect(mapped.source).toBe('companies_house');
  });

  it('tolerates a profile with no registered office, accounts data, or previous names', () => {
    const mapped = mapCompanyProfile({ company_number: '00000001', company_name: 'BARE LTD' });
    expect(mapped.registeredOfficeAddress).toBeUndefined();
    expect(mapped.accountingReferenceDate).toBeNull();
    expect(mapped.sicCodes).toEqual([]);
    expect(mapped.previousNames).toEqual([]);
  });
});

describe('mapOfficers', () => {
  it('keeps only active directors', () => {
    const raw = {
      items: [
        { name: 'SMITH, Jane', officer_role: 'director', appointed_on: '2020-01-01', date_of_birth: { month: 5, year: 1980 }, nationality: 'British', occupation: 'Director' },
        { name: 'JONES, John', officer_role: 'director', appointed_on: '2018-01-01', resigned_on: '2022-01-01' },
        { name: 'DOE, Jane', officer_role: 'secretary', appointed_on: '2019-01-01' },
      ],
    };
    const mapped = mapOfficers(raw);
    expect(mapped).toHaveLength(1);
    expect(mapped[0]).toEqual({
      name: 'SMITH, Jane',
      role: 'director',
      appointedOn: '2020-01-01',
      dateOfBirth: { month: 5, year: 1980 },
      nationality: 'British',
      occupation: 'Director',
      naturesOfControl: [],
      identityVerification: null,
    });
  });

  it('reads identity verification: an agent-verified date, or an appointment verification statement still in force', () => {
    const raw = {
      items: [
        { name: 'AGENT, Verified', officer_role: 'director', identity_verification_details: { identity_verified_on: '2026-02-01', authorised_corporate_service_provider_name: 'Some ACSP Ltd', anti_money_laundering_supervisory_bodies: ['ICAEW'] } },
        { name: 'DIRECT, Verified', officer_role: 'director', identity_verification_details: { appointment_verification_start_on: '2026-03-04', appointment_verification_statement_due_on: '2026-04-01' } },
        { name: 'STATEMENT, Removed', officer_role: 'director', identity_verification_details: { appointment_verification_start_on: '2026-03-04', appointment_verification_end_on: '2026-05-01' } },
        { name: 'DUE, Only', officer_role: 'director', identity_verification_details: { appointment_verification_statement_due_on: '2026-12-01' } },
        { name: 'NOTHING, Said', officer_role: 'director' },
      ],
    };
    const [agent, direct, removed, dueOnly, nothing] = mapOfficers(raw);
    expect(agent.identityVerification).toEqual({ verifiedOn: '2026-02-01', statementDueOn: null, verifiedBy: 'Some ACSP Ltd' });
    expect(direct.identityVerification).toEqual({ verifiedOn: '2026-03-04', statementDueOn: '2026-04-01', verifiedBy: null });
    expect(removed.identityVerification).toEqual({ verifiedOn: null, statementDueOn: null, verifiedBy: null });
    expect(dueOnly.identityVerification).toEqual({ verifiedOn: null, statementDueOn: '2026-12-01', verifiedBy: null });
    expect(nothing.identityVerification).toBeNull();
  });

  it('handles an empty officers list', () => {
    expect(mapOfficers({ items: [] })).toEqual([]);
    expect(mapOfficers({})).toEqual([]);
  });
});

describe('mapPscs', () => {
  it('keeps only active individual PSCs, excluding corporate/legal-person PSCs and ceased ones', () => {
    const raw = {
      items: [
        { name: 'SMITH, Jane', kind: 'individual-person-with-significant-control', notified_on: '2020-01-01', date_of_birth: { month: 5, year: 1980 }, nationality: 'British' },
        { name: 'CEASED, Person', kind: 'individual-person-with-significant-control', notified_on: '2018-01-01', ceased_on: '2021-01-01' },
        { name: 'Some Holding Co Ltd', kind: 'corporate-entity-person-with-significant-control', notified_on: '2019-01-01' },
      ],
    };
    const mapped = mapPscs(raw);
    expect(mapped).toHaveLength(1);
    expect(mapped[0]).toEqual({
      name: 'SMITH, Jane',
      role: 'psc',
      appointedOn: '2020-01-01',
      dateOfBirth: { month: 5, year: 1980 },
      nationality: 'British',
      occupation: null,
      naturesOfControl: [],
      identityVerification: null,
    });
  });

  it('reads a PSC\'s identity verification the same way as a director\'s', () => {
    const raw = {
      items: [
        { name: 'Mrs Jane Smith', kind: 'individual-person-with-significant-control', identity_verification_details: { identity_verified_on: '2026-02-01' } },
      ],
    };
    expect(mapPscs(raw)[0].identityVerification).toEqual({ verifiedOn: '2026-02-01', statementDueOn: null, verifiedBy: null });
  });

  it('handles an empty PSC list', () => {
    expect(mapPscs({ items: [] })).toEqual([]);
    expect(mapPscs({})).toEqual([]);
  });

  it('humanizes nature-of-control codes, including trust/firm suffixes and unrecognised codes', () => {
    const raw = {
      items: [
        {
          name: 'SMITH, Jane',
          kind: 'individual-person-with-significant-control',
          notified_on: '2020-01-01',
          natures_of_control: ['ownership-of-shares-75-to-100-percent', 'voting-rights-75-to-100-percent-as-trust', 'some-new-unmapped-code'],
        },
      ],
    };
    const mapped = mapPscs(raw);
    expect(mapped[0].naturesOfControl).toEqual(['Owns 75-100% of shares', 'Holds 75-100% of voting rights', 'Some new unmapped code']);
  });
});
