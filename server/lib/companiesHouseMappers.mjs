/**
 * Pure mapping functions from the Companies House REST API's JSON shape to
 * the slim, stable shape this application actually needs. Kept separate
 * from the route handler (server/routes/companiesHouse.mjs) so the mapping
 * logic is unit-testable without a network call or an API key.
 *
 * Companies House API reference: https://developer-specs.company-information.service.gov.uk/
 */

/** One row in a company name search result. */
export function mapSearchItem(item) {
  return {
    companyNumber: item.company_number,
    title: item.title,
    companyStatus: item.company_status ?? null,
    companyType: item.company_type ?? null,
    dateOfCreation: item.date_of_creation ?? null,
    addressSnippet: item.address_snippet ?? null,
  };
}

export function mapSearchResponse(data) {
  return {
    results: (data.items ?? []).map(mapSearchItem),
    totalResults: data.total_results ?? (data.items ?? []).length,
    source: 'companies_house',
  };
}

function formatAddress(addr) {
  if (!addr) return undefined;
  const parts = [addr.premises, addr.address_line_1, addr.address_line_2, addr.locality, addr.region, addr.postal_code, addr.country].filter((p) => typeof p === 'string' && p.trim().length > 0);
  return {
    premises: addr.premises,
    addressLine1: addr.address_line_1,
    addressLine2: addr.address_line_2,
    locality: addr.locality,
    region: addr.region,
    postalCode: addr.postal_code,
    country: addr.country,
    formatted: parts.join(', '),
  };
}

/** Full company profile. */
export function mapCompanyProfile(data) {
  return {
    companyNumber: data.company_number,
    companyName: data.company_name,
    companyStatus: data.company_status ?? null,
    companyType: data.type ?? null,
    dateOfCreation: data.date_of_creation ?? null,
    sicCodes: data.sic_codes ?? [],
    registeredOfficeAddress: formatAddress(data.registered_office_address),
    accountingReferenceDate: data.accounts?.accounting_reference_date
      ? { day: data.accounts.accounting_reference_date.day, month: data.accounts.accounting_reference_date.month }
      : null,
    nextAccountsDueOn: data.accounts?.next_accounts?.due_on ?? null,
    nextAccountsPeriodEndOn: data.accounts?.next_accounts?.period_end_on ?? null,
    nextConfirmationStatementDueOn: data.confirmation_statement?.next_due ?? null,
    source: 'companies_house',
  };
}
