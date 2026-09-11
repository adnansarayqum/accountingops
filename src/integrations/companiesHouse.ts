/**
 * Companies House integration — the client side. Always talks to this
 * application's own /api/companies-house proxy, never to Companies House
 * directly (so the API key never reaches the browser).
 *
 * Falls back to a clearly-labelled synthetic dataset (source: 'demo') when
 * the proxy reports it has no API key configured, or when the network call
 * fails outright — so onboarding never breaks, and the UI can always tell
 * the difference between a live lookup and a demo one.
 */
import { mockCompanyProfile, mockSearchCompanies } from './companiesHouseMock';
import type { CompanyProfile, CompanySearchResponse } from './companiesHouseTypes';

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
  if (q.length < 2) return { results: [], totalResults: 0, source: 'demo' };
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

export async function getCompanyProfile(companyNumber: string): Promise<CompanyProfile | null> {
  try {
    const res = await fetch(`/api/companies-house/company/${encodeURIComponent(companyNumber)}`);
    if (NOT_CONFIGURED_STATUSES.has(res.status)) return mockCompanyProfile(companyNumber);
    if (!res.ok) return mockCompanyProfile(companyNumber);
    const data = await safeJson<CompanyProfile>(res);
    return data ?? mockCompanyProfile(companyNumber);
  } catch {
    return mockCompanyProfile(companyNumber);
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
