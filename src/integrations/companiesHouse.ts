/**
 * Companies House integration — the client side. Always talks to this
 * application's own /api/companies-house proxy, never to Companies House
 * directly (so the API key never reaches the browser).
 *
 * Falls back to a clearly-labelled synthetic dataset (source: 'sample') when
 * the proxy reports it has no API key configured, or when the network call
 * fails outright — so onboarding never breaks, and the UI can always tell
 * the difference between a live lookup and a sample one.
 */
import { mockCompanyPeople, mockCompanyProfile, mockSearchCompanies } from './companiesHouseMock';
import type { CompanyPeopleResponse, CompanyProfile, CompanySearchResponse } from './companiesHouseTypes';

const NOT_CONFIGURED_STATUSES = new Set([503]);

async function safeJson<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function searchCompanies(query: string): Promise<CompanySearchResponse> {
  const q = query.trim();
  if (q.length < 2) return { results: [], totalResults: 0, source: 'sample' };
  try {
    const res = await fetch(`/api/companies-house/search?q=${encodeURIComponent(q)}`);
    if (NOT_CONFIGURED_STATUSES.has(res.status)) return mockSearchCompanies(q);
    if (!res.ok) return mockSearchCompanies(q);
    const data = await safeJson<CompanySearchResponse>(res);
    return data ?? mockSearchCompanies(q);
  } catch {
    return mockSearchCompanies(q);
  }
}

/** Whether the server has a real Companies House API key — vs. falling back to sample data for every lookup. */
export async function getCompaniesHouseStatus(): Promise<{ configured: boolean }> {
  try {
    const res = await fetch('/api/companies-house/status');
    if (!res.ok) return { configured: false };
    const data = await safeJson<{ configured: boolean }>(res);
    return data ?? { configured: false };
  } catch {
    return { configured: false };
  }
}

/** Why a profile lookup didn't return live data — so a screen can say "not on the register" rather than a bare "no data". */
export type CompanyLookupOutcome = 'live' | 'not_configured' | 'not_found' | 'rate_limited' | 'unavailable';

export interface CompanyLookupResult {
  outcome: CompanyLookupOutcome;
  /** Present only when `outcome` is 'live' — never sample data. */
  profile: CompanyProfile | null;
}

/** A profile lookup that reports what happened instead of quietly substituting sample data. */
export async function lookupCompanyProfile(companyNumber: string): Promise<CompanyLookupResult> {
  try {
    const res = await fetch(`/api/companies-house/company/${encodeURIComponent(companyNumber)}`);
    if (NOT_CONFIGURED_STATUSES.has(res.status)) return { outcome: 'not_configured', profile: null };
    if (res.status === 404) return { outcome: 'not_found', profile: null };
    if (res.status === 429) return { outcome: 'rate_limited', profile: null };
    if (!res.ok) return { outcome: 'unavailable', profile: null };
    const data = await safeJson<CompanyProfile>(res);
    return data ? { outcome: 'live', profile: data } : { outcome: 'unavailable', profile: null };
  } catch {
    return { outcome: 'unavailable', profile: null };
  }
}

export async function getCompanyProfile(companyNumber: string): Promise<CompanyProfile | null> {
  const { profile } = await lookupCompanyProfile(companyNumber);
  return profile ?? mockCompanyProfile(companyNumber);
}

/** Active directors and individual PSCs for a company. */
export async function getCompanyPeople(companyNumber: string): Promise<CompanyPeopleResponse> {
  try {
    const res = await fetch(`/api/companies-house/company/${encodeURIComponent(companyNumber)}/people`);
    if (NOT_CONFIGURED_STATUSES.has(res.status)) return mockCompanyPeople();
    if (!res.ok) return mockCompanyPeople();
    const data = await safeJson<CompanyPeopleResponse>(res);
    return data ?? mockCompanyPeople();
  } catch {
    return mockCompanyPeople();
  }
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "31 March" style label from Companies House's { day, month } accounting reference date. */
export function formatAccountingReferenceDate(ref: CompanyProfile['accountingReferenceDate']): string | undefined {
  if (!ref) return undefined;
  const monthIndex = Number(ref.month) - 1;
  const monthName = MONTHS[monthIndex];
  if (!monthName) return undefined;
  return `${Number(ref.day)} ${monthName}`;
}
