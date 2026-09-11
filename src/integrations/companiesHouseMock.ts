/**
 * Synthetic Companies House fallback. Used automatically when
 * COMPANIES_HOUSE_API_KEY is not configured, so onboarding still works out
 * of the box without a live API key — clearly labelled `source: 'sample'`
 * so the UI never presents it as a live lookup.
 */
import type { CompanyProfile, CompanySearchResponse, CompanySearchResult } from './companiesHouseTypes';

interface MockCompany {
  companyNumber: string;
  title: string;
  companyStatus: string;
  companyType: string;
  dateOfCreation: string;
  address: { premises: string; addressLine1: string; locality: string; region?: string; postalCode: string; country: string };
  sicCodes: string[];
  accountingReferenceDate: { day: string; month: string };
}

const MOCK_COMPANIES: MockCompany[] = [
  { companyNumber: '14829301', title: 'HARBOUR CYCLES LTD', companyStatus: 'active', companyType: 'ltd', dateOfCreation: '2023-02-14', address: { premises: '12', addressLine1: 'Quayside Road', locality: 'Bristol', postalCode: 'BS1 4RN', country: 'England' }, sicCodes: ['47650'], accountingReferenceDate: { day: '28', month: '02' } },
  { companyNumber: '13207745', title: 'MERIDIAN CONSULTING GROUP LTD', companyStatus: 'active', companyType: 'ltd', dateOfCreation: '2021-06-02', address: { premises: 'Unit 4', addressLine1: '221 High Street', locality: 'Manchester', postalCode: 'M1 2WD', country: 'England' }, sicCodes: ['70229'], accountingReferenceDate: { day: '30', month: '06' } },
  { companyNumber: '09112384', title: 'BRIGHTWELL ELECTRICAL SERVICES LIMITED', companyStatus: 'active', companyType: 'ltd', dateOfCreation: '2014-09-19', address: { premises: '8 Foundry Court', addressLine1: 'Foundry Court', locality: 'Sheffield', postalCode: 'S1 2BJ', country: 'England' }, sicCodes: ['43210'], accountingReferenceDate: { day: '30', month: '09' } },
  { companyNumber: '11998821', title: 'THE LANTERN BAKEHOUSE LTD', companyStatus: 'active', companyType: 'ltd', dateOfCreation: '2019-03-11', address: { premises: '3', addressLine1: 'Market Place', locality: 'York', postalCode: 'YO1 8SG', country: 'England' }, sicCodes: ['10710'], accountingReferenceDate: { day: '31', month: '03' } },
  { companyNumber: '08654123', title: 'SILVERLINE PROPERTY MANAGEMENT LTD', companyStatus: 'active', companyType: 'ltd', dateOfCreation: '2013-07-08', address: { premises: 'Silverline House', addressLine1: '45 Bridge Street', locality: 'Leeds', postalCode: 'LS1 4DY', country: 'England' }, sicCodes: ['68320'], accountingReferenceDate: { day: '31', month: '07' } },
  { companyNumber: '12440017', title: 'ORCHARD VETERINARY PARTNERS LTD', companyStatus: 'active', companyType: 'ltd', dateOfCreation: '2020-01-27', address: { premises: 'Orchard House', addressLine1: 'Mill Lane', locality: 'Exeter', postalCode: 'EX1 1RJ', country: 'England' }, sicCodes: ['75000'], accountingReferenceDate: { day: '31', month: '01' } },
];

function toSearchResult(c: MockCompany): CompanySearchResult {
  return {
    companyNumber: c.companyNumber,
    title: c.title,
    companyStatus: c.companyStatus,
    companyType: c.companyType,
    dateOfCreation: c.dateOfCreation,
    addressSnippet: `${c.address.locality}, ${c.address.postalCode}`,
  };
}

export function mockSearchCompanies(query: string): CompanySearchResponse {
  const q = query.trim().toLowerCase();
  const results = q.length < 2 ? [] : MOCK_COMPANIES.filter((c) => c.title.toLowerCase().includes(q)).map(toSearchResult);
  return { results, totalResults: results.length, source: 'sample' };
}

export function mockCompanyProfile(companyNumber: string): CompanyProfile | null {
  const c = MOCK_COMPANIES.find((x) => x.companyNumber === companyNumber);
  if (!c) return null;
  const a = c.address;
  const formatted = [a.premises, a.addressLine1, a.locality, a.region, a.postalCode, a.country].filter(Boolean).join(', ');
  return {
    companyNumber: c.companyNumber,
    companyName: c.title,
    companyStatus: c.companyStatus,
    companyType: c.companyType,
    dateOfCreation: c.dateOfCreation,
    sicCodes: c.sicCodes,
    registeredOfficeAddress: { premises: a.premises, addressLine1: a.addressLine1, locality: a.locality, region: a.region, postalCode: a.postalCode, country: a.country, formatted },
    accountingReferenceDate: c.accountingReferenceDate,
    nextAccountsDueOn: null,
    nextAccountsPeriodEndOn: null,
    nextConfirmationStatementDueOn: null,
    source: 'sample',
  };
}
