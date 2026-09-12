/**
 * Companies House streaming changes — the client side. Reads what the
 * server-side listener has seen (see server/lib/companiesHouseStream*.mjs);
 * it never opens a stream itself, because the streaming key must not reach
 * the browser and a long-lived connection belongs in one process, not in
 * every open tab.
 *
 * Everything here degrades to "off": in the browser-only mode there is no
 * server to ask, and without a streaming key the server says so. Callers
 * get an empty result rather than an error either way.
 */

export interface CompaniesHouseChange {
  companyNumber: string;
  type: 'changed' | 'deleted';
  fieldsChanged: string[];
  publishedAt: string | null;
  seenAt: string;
}

export interface CompaniesHouseChanges {
  changes: CompaniesHouseChange[];
  pending: number;
  connectedAt: string | null;
  lastEventAt: string | null;
  lastError: string | null;
}

const EMPTY: CompaniesHouseChanges = { changes: [], pending: 0, connectedAt: null, lastEventAt: null, lastError: null };

async function safeJson<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Whether the server has both a streaming key and somewhere to record what it sees. */
export async function getStreamStatus(): Promise<{ configured: boolean }> {
  try {
    const res = await fetch('/api/companies-house/stream/status');
    if (!res.ok) return { configured: false };
    return (await safeJson<{ configured: boolean }>(res)) ?? { configured: false };
  } catch {
    return { configured: false };
  }
}

export async function getStreamChanges(): Promise<CompaniesHouseChanges> {
  try {
    const res = await fetch('/api/companies-house/stream/changes');
    if (!res.ok) return EMPTY;
    return (await safeJson<CompaniesHouseChanges>(res)) ?? EMPTY;
  } catch {
    return EMPTY;
  }
}

/** Marks changes handled. No company numbers means "all of them". */
export async function acknowledgeStreamChanges(companyNumbers?: string[]): Promise<number> {
  try {
    const res = await fetch('/api/companies-house/stream/changes/ack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyNumbers: companyNumbers ?? [] }),
    });
    if (!res.ok) return 0;
    return (await safeJson<{ acknowledged: number }>(res))?.acknowledged ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Plain-English summary of what moved on a client's register entry. The
 * stream gives dot-notation paths ("accounts.next_due"); nobody wants to
 * read those, and "accounts due date" is the thing an accountant acts on.
 */
const FIELD_LABELS: { prefix: string; label: string; family: string; generic?: boolean }[] = [
  { prefix: 'accounts.next_due', label: 'accounts deadline', family: 'accounts' },
  { prefix: 'accounts.next_made_up_to', label: 'accounts period end', family: 'accounts' },
  { prefix: 'accounts', label: 'accounts dates', family: 'accounts', generic: true },
  { prefix: 'confirmation_statement.next_due', label: 'confirmation statement deadline', family: 'confirmation_statement' },
  { prefix: 'confirmation_statement', label: 'confirmation statement dates', family: 'confirmation_statement', generic: true },
  { prefix: 'annual_return', label: 'annual return', family: 'annual_return' },
  { prefix: 'company_name', label: 'company name', family: 'name' },
  { prefix: 'previous_company_names', label: 'previous names', family: 'name' },
  { prefix: 'company_status', label: 'company status', family: 'status' },
  { prefix: 'date_of_cessation', label: 'cessation date', family: 'status' },
  { prefix: 'registered_office_address', label: 'registered office', family: 'address' },
  { prefix: 'sic_codes', label: 'SIC codes', family: 'sic' },
  { prefix: 'type', label: 'company type', family: 'type' },
];

export function describeChange(change: CompaniesHouseChange): string {
  if (change.type === 'deleted') return 'removed from the register';

  const matched = new Map<string, { label: string; family: string; generic: boolean }>();
  for (const field of change.fieldsChanged) {
    const match = FIELD_LABELS.find((f) => field === f.prefix || field.startsWith(`${f.prefix}.`));
    if (match) matched.set(match.label, { label: match.label, family: match.family, generic: Boolean(match.generic) });
  }

  // A family's catch-all is there for a field we have no specific wording
  // for; once a specific one in that family has matched it only adds noise
  // ("accounts deadline and accounts dates changed" says one thing twice).
  const specificFamilies = new Set([...matched.values()].filter((m) => !m.generic).map((m) => m.family));
  const labels = [...matched.values()].filter((m) => !m.generic || !specificFamilies.has(m.family)).map((m) => m.label);

  if (labels.length === 0) return 'record updated';
  if (labels.length === 1) return `${labels[0]} changed`;
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]} changed`;
}
