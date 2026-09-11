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
  source: 'companies_house' | 'sample';
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
  /** Names this company has previously traded under, most recent first. */
  previousNames: string[];
  registeredOfficeAddress?: CompanyProfileAddress;
  accountingReferenceDate: { day: string; month: string } | null;
  nextAccountsDueOn: string | null;
  nextAccountsPeriodEndOn: string | null;
  nextConfirmationStatementDueOn: string | null;
  source: 'companies_house' | 'sample';
}

export interface CompanyPersonDateOfBirth {
  month: string;
  year: string;
}

/** One active director or individual PSC, from /company/:number/people. */
export interface CompanyPerson {
  name: string;
  role: 'director' | 'psc';
  appointedOn: string | null;
  /** Companies House exposes only month/year of birth publicly, never the day. */
  dateOfBirth: CompanyPersonDateOfBirth | null;
  nationality: string | null;
  occupation: string | null;
  /** How control is held — only ever populated for a PSC, always empty for a director. */
  naturesOfControl: string[];
}

export interface CompanyPeopleResponse {
  directors: CompanyPerson[];
  pscs: CompanyPerson[];
  source: 'companies_house' | 'sample';
}
