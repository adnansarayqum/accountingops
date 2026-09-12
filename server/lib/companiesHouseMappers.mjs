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

function mapDateOfBirth(dob) {
  return dob ? { month: dob.month, year: dob.year } : null;
}

/**
 * Companies House publishes an officer's or PSC's identity-verification
 * details in two shapes: `identity_verified_on` when an authorised agent
 * (ACSP) verified them, or an appointment verification statement
 * (`appointment_verification_start_on`, removed again by
 * `appointment_verification_end_on`) when they verified directly. Either
 * counts as verified. Nothing at all means Companies House isn't saying —
 * the object is often absent even for people who have verified — so the
 * app must never read its absence as "not verified".
 */
function mapIdentityVerification(details) {
  if (!details || typeof details !== 'object') return null;
  const statementActive = Boolean(details.appointment_verification_start_on) && !details.appointment_verification_end_on;
  const verifiedOn = details.identity_verified_on ?? (statementActive ? details.appointment_verification_start_on : null);
  return {
    verifiedOn: verifiedOn ?? null,
    statementDueOn: details.appointment_verification_statement_due_on ?? null,
    verifiedBy: details.authorised_corporate_service_provider_name ?? null,
  };
}

/** One active director from a company's officers list. */
function mapOfficer(item) {
  return {
    name: item.name,
    role: 'director',
    appointedOn: item.appointed_on ?? null,
    dateOfBirth: mapDateOfBirth(item.date_of_birth),
    nationality: item.nationality ?? null,
    occupation: item.occupation ?? null,
    naturesOfControl: [],
    identityVerification: mapIdentityVerification(item.identity_verification_details),
  };
}

/** Active directors from a company's officers list — resigned officers and non-director appointments (secretary, corporate director) are excluded. */
export function mapOfficers(data) {
  return (data.items ?? []).filter((item) => item.officer_role === 'director' && !item.resigned_on).map(mapOfficer);
}

const NATURE_OF_CONTROL_LABELS = {
  'ownership-of-shares-25-to-50-percent': 'Owns 25-50% of shares',
  'ownership-of-shares-50-to-75-percent': 'Owns 50-75% of shares',
  'ownership-of-shares-75-to-100-percent': 'Owns 75-100% of shares',
  'voting-rights-25-to-50-percent': 'Holds 25-50% of voting rights',
  'voting-rights-50-to-75-percent': 'Holds 50-75% of voting rights',
  'voting-rights-75-to-100-percent': 'Holds 75-100% of voting rights',
  'right-to-appoint-and-remove-directors': 'Can appoint or remove directors',
  'significant-influence-or-control': 'Significant influence or control',
};

/** Companies House's kebab-case control codes (e.g. "ownership-of-shares-75-to-100-percent") to a short human label. Codes for control held via a trust or firm carry an "-as-trust"/"-as-firm" suffix, stripped before matching. */
function humanizeNatureOfControl(code) {
  const base = code.replace(/-as-(trust|firm)$/, '');
  return NATURE_OF_CONTROL_LABELS[base] ?? base.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

/** One active individual person with significant control. */
function mapPsc(item) {
  return {
    name: item.name,
    role: 'psc',
    appointedOn: item.notified_on ?? null,
    dateOfBirth: mapDateOfBirth(item.date_of_birth),
    nationality: item.nationality ?? null,
    occupation: null,
    naturesOfControl: (item.natures_of_control ?? []).map(humanizeNatureOfControl),
    identityVerification: mapIdentityVerification(item.identity_verification_details),
  };
}

/** Active individual PSCs — ceased entries and corporate/legal-person PSCs are excluded, since only a natural person maps to this app's Person record. */
export function mapPscs(data) {
  return (data.items ?? []).filter((item) => item.kind === 'individual-person-with-significant-control' && !item.ceased_on).map(mapPsc);
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
    previousNames: (data.previous_company_names ?? []).map((n) => n.name),
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
