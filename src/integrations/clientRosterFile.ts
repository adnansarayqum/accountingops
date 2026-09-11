import { toIsoDate } from '../domain/dates';
import type { ClientRosterRow } from '../application/clientImport';

export interface ParsedRoster {
  rows: ClientRosterRow[];
  /** One entry per skipped/problem row, for display before import. */
  warnings: string[];
}

// Header text → field, matched case-insensitively after trimming. Practices'
// own spreadsheets vary a little in wording, so a few common synonyms are
// accepted for each field.
const HEADER_ALIASES: Record<string, keyof ClientRosterRow | 'skip'> = {
  name: 'name',
  client: 'name',
  'client name': 'name',
  'company no': 'companyNumber',
  'company no.': 'companyNumber',
  'company number': 'companyNumber',
  gateway: 'gatewayCredentials',
  'government gateway': 'gatewayCredentials',
  'personal code': 'personalCode',
  utr: 'utr',
  'utr number': 'utr',
  'auth code': 'chAuthCode',
  'authentication code': 'chAuthCode',
  'ch auth code': 'chAuthCode',
  'next accounts': 'accountsPeriodEnd',
  'next accounts made up to': 'accountsPeriodEnd',
  due: 'accountsDue',
  'accounts due': 'accountsDue',
  'date for cs': 'confirmationStatementDue',
  'cs due': 'confirmationStatementDue',
  'confirmation statement due': 'confirmationStatementDue',
  '#': 'skip',
};

function toIso(value: unknown): string | undefined {
  if (value == null || value === '') return undefined;
  if (value instanceof Date) return toIsoDate(value);
  if (typeof value === 'string') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? undefined : toIsoDate(d);
  }
  return undefined;
}

function toText(value: unknown): string | undefined {
  if (value == null) return undefined;
  const s = String(value).trim();
  return s === '' ? undefined : s;
}

/**
 * Turn spreadsheet records (as SheetJS's `sheet_to_json` returns them —
 * one plain object per row, keyed by header text) into roster rows. Pure
 * and synchronous so header-matching and date-conversion logic can be
 * tested without touching a file at all.
 */
export function mapRosterRecords(records: Record<string, unknown>[]): ParsedRoster {
  const warnings: string[] = [];
  const rows: ClientRosterRow[] = [];

  for (const [index, record] of records.entries()) {
    const mapped: Partial<ClientRosterRow> = {};
    for (const [header, value] of Object.entries(record)) {
      const field = HEADER_ALIASES[header.trim().toLowerCase()];
      if (!field || field === 'skip') continue;
      if (field === 'accountsPeriodEnd' || field === 'accountsDue' || field === 'confirmationStatementDue') {
        mapped[field] = toIso(value);
      } else {
        mapped[field] = toText(value);
      }
    }
    const rowLabel = mapped.name ?? `row ${index + 2}`;
    if (!mapped.name) {
      warnings.push(`${rowLabel}: missing a name — skipped.`);
      continue;
    }
    if (!mapped.companyNumber) {
      warnings.push(`${mapped.name}: missing a company number — skipped.`);
      continue;
    }
    rows.push(mapped as ClientRosterRow);
  }

  return { rows, warnings };
}

/**
 * Parse an uploaded .xlsx/.xls/.csv roster into rows the client-import
 * builder understands. Runs entirely client-side (dynamic import keeps the
 * ~1MB parser out of the main bundle) — the file never leaves the browser.
 */
export async function parseClientRosterFile(file: File): Promise<ParsedRoster> {
  const XLSX = await import('xlsx');
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const records = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: undefined });
  return mapRosterRecords(records);
}
