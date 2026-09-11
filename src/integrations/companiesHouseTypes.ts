/** Shapes returned by the /api/companies-house/* proxy. Mirrors server/lib/companiesHouseMappers.mjs. */

export interface CompanySearchResult {
  companyNumber: string;
  title: string;
  companyStatus: string | null;
  companyType: string | null;
  dateOfCreation: string | null;
  addressSnippet: string | null;
}

export interface CompanySearchResponse {
  results: CompanySearchResult[];
  totalResults: number;
  source: 'companies_house' | 'demo';
}

export interface CompanyProfileAddress {
  premises?: string;
  addressLine1?: string;
  addressLine2?: string;
  locality?: string;
  region?: string;
  postalCode?: string;
  country?: string;
  formatted: string;
}

export interface CompanyProfile {
  companyNumber: string;
  companyName: string;
  companyStatus: string | null;
  companyType: string | null;
  dateOfCreation: string | null;
  sicCodes: string[];
  registeredOfficeAddress?: CompanyProfileAddress;
  accountingReferenceDate: { day: string; month: string } | null;
  nextAccountsDueOn: string | null;
  nextAccountsPeriodEndOn: string | null;
  nextConfirmationStatementDueOn: string | null;
  source: 'companies_house' | 'demo';
}
