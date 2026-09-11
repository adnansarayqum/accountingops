import { describe, expect, it } from 'vitest';
import { mockCompanyProfile, mockSearchCompanies } from '../companiesHouseMock';

describe('mockSearchCompanies', () => {
  it('matches case-insensitively on company name', () => {
    const res = mockSearchCompanies('harbour');
    expect(res.source).toBe('demo');
    expect(res.results).toHaveLength(1);
    expect(res.results[0].title).toBe('HARBOUR CYCLES LTD');
  });

  it('returns nothing for a query below the minimum length', () => {
    expect(mockSearchCompanies('h').results).toEqual([]);
  });

  it('returns nothing for a name with no match', () => {
    expect(mockSearchCompanies('nonexistent company xyz').results).toEqual([]);
  });
});

describe('mockCompanyProfile', () => {
  it('returns a full profile for a known company number', () => {
    const profile = mockCompanyProfile('14829301');
    expect(profile).not.toBeNull();
    expect(profile?.companyName).toBe('HARBOUR CYCLES LTD');
    expect(profile?.source).toBe('demo');
    expect(profile?.registeredOfficeAddress?.formatted).toContain('Bristol');
    expect(profile?.accountingReferenceDate).toEqual({ day: '28', month: '02' });
  });

  it('returns null for an unknown company number', () => {
    expect(mockCompanyProfile('99999999')).toBeNull();
  });
});
