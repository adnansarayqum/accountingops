import { toIsoDate } from '../domain/dates';
import { normaliseCompanyNumber } from '../domain/companyNumber';
import type { ClientRosterRow } from '../application/clientImport';

export interface ParsedRoster {
  rows: ClientRosterRow[];
  /** One entry per skipped row, for display before import. */
  warnings: string[];
  /** Things that didn't stop a row importing but are worth a look: a date that couldn't be read, columns that were ignored. */
  notes: string[];
}

/** The subset of ClientRosterRow a spreadsheet cell can actually fill in — excludes fields only a Companies House lookup populates (see mergeCompanyProfile). */
type ParsableField = 'name' | 'companyNumber' | 'utr' | 'chAuthCode' | 'personalCode' | 'gatewayCredentials' | 'accountsPeriodEnd' | 'accountsDue' | 'confirmationStatementDue';

type DateField = Extract<ParsableField, 'accountsPeriodEnd' | 'accountsDue' | 'confirmationStatementDue'>;

// Header text → field, matched case-insensitively after trimming. Practices'
// own spreadsheets vary a little in wording, so a few common synonyms are
// accepted for each field.
const HEADER_ALIASES: Record<string, ParsableField | 'skip'> = {
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

const DATE_FIELD_LABELS: Record<DateField, string> = {
  accountsPeriodEnd: 'Next accounts',
  accountsDue: 'Due',
  confirmationStatementDue: 'Date for CS',
};

const DAY_MS = 86_400_000;
// SheetJS's serial dates count from 30 Dec 1899 (Excel's 1900 leap-year bug included).
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function isoFromParts(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Reads a date the way a UK spreadsheet writes one. Handles a real date
 * cell, an Excel serial number (a date cell that was never formatted as a
 * date), "31/03/2027" and its dash/dot cousins (day first — never US
 * order), two-digit years, ISO, and "31 March 2027". Returns `null` for a
 * blank cell and `'invalid'` for something that looks like a date but
 * isn't one, so the caller can say so rather than dropping it silently.
 */
export function parseSpreadsheetDate(value: unknown): string | null | 'invalid' {
  if (value == null || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? 'invalid' : toIsoDate(value);
  if (typeof value === 'number') {
    // 1954 to 2119 — outside that a number isn't plausibly a date at all.
    if (value < 20000 || value > 80000) return 'invalid';
    const d = new Date(EXCEL_EPOCH_MS + Math.round(value) * DAY_MS);
    return isoFromParts(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()) ?? 'invalid';
  }
  if (typeof value !== 'string') return 'invalid';
  const s = value.trim();
  if (!s) return null;

  const iso = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ].*)?$/.exec(s);
  if (iso) return isoFromParts(Number(iso[1]), Number(iso[2]), Number(iso[3])) ?? 'invalid';

  const dayFirst = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(s);
  if (dayFirst) {
    const year = dayFirst[3].length === 2 ? 2000 + Number(dayFirst[3]) : Number(dayFirst[3]);
    return isoFromParts(year, Number(dayFirst[2]), Number(dayFirst[1])) ?? 'invalid';
  }

  // "31 March 2027", "31 Mar 2027", "March 31, 2027" — but a bare number or
  // a slash form was handled above and must not fall through to the
  // engine's US-first parsing.
  if (/^\d+$/.test(s) || /^\d{1,2}[/.-]/.test(s)) return 'invalid';
  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? 'invalid' : toIsoDate(parsed);
}

function toText(value: unknown): string | undefined {
  if (value == null) return undefined;
  const s = String(value).trim();
  return s === '' ? undefined : s;
}

function isDateField(field: ParsableField): field is DateField {
  return field === 'accountsPeriodEnd' || field === 'accountsDue' || field === 'confirmationStatementDue';
}

/**
 * Turn spreadsheet records (as SheetJS's `sheet_to_json` returns them —
 * one plain object per row, keyed by header text) into roster rows. Pure
 * and synchronous so header-matching and date-conversion logic can be
 * tested without touching a file at all.
 */
export function mapRosterRecords(records: Record<string, unknown>[]): ParsedRoster {
  const warnings: string[] = [];
  const notes: string[] = [];
  const rows: ClientRosterRow[] = [];
  const ignoredHeaders = new Set<string>();
  let blankHeaders = 0;
  const seenNumbers = new Map<string, string>();

  for (const [index, record] of records.entries()) {
    // Spreadsheet row number as the user sees it: the header is row 1.
    const sheetRow = index + 2;
    const mapped: Partial<Pick<ClientRosterRow, ParsableField>> = {};
    const badDates: string[] = [];
    for (const [header, value] of Object.entries(record)) {
      const trimmed = header.trim();
      // SheetJS names a column with no header text "__EMPTY", "__EMPTY_1", … —
      // typically a merged or decorative header cell.
      if (trimmed === '' || /^__EMPTY/.test(trimmed)) {
        if (value != null && value !== '') blankHeaders += 1;
        continue;
      }
      const field = HEADER_ALIASES[trimmed.toLowerCase()];
      if (!field) {
        ignoredHeaders.add(trimmed);
        continue;
      }
      if (field === 'skip') continue;
      if (isDateField(field)) {
        const parsed = parseSpreadsheetDate(value);
        if (parsed === 'invalid') badDates.push(`couldn't read "${String(value)}" as a date for ${DATE_FIELD_LABELS[field]} — left blank`);
        else mapped[field] = parsed ?? undefined;
      } else if (field === 'companyNumber') {
        const text = toText(value);
        mapped.companyNumber = text ? normaliseCompanyNumber(text) : undefined;
      } else {
        mapped[field] = toText(value);
      }
    }
    const rowLabel = mapped.name ?? `row ${sheetRow} of the sheet`;
    if (!mapped.name) {
      warnings.push(`${rowLabel}: missing a name — skipped.`);
      continue;
    }
    if (!mapped.companyNumber) {
      warnings.push(`${mapped.name}: missing a company number — skipped.`);
      continue;
    }
    const earlier = seenNumbers.get(mapped.companyNumber);
    if (earlier) {
      warnings.push(`${mapped.name}: same company number (${mapped.companyNumber}) as ${earlier} earlier in the file — skipped.`);
      continue;
    }
    seenNumbers.set(mapped.companyNumber, mapped.name);
    for (const problem of badDates) notes.push(`${mapped.name}: ${problem}.`);
    rows.push(mapped as ClientRosterRow);
  }

  if (ignoredHeaders.size > 0) {
    const list = [...ignoredHeaders].map((h) => `"${h}"`).join(', ');
    notes.push(`Column${ignoredHeaders.size === 1 ? '' : 's'} ${list} not recognised and ignored.`);
  }
  if (blankHeaders > 0) notes.push(`${blankHeaders} cell${blankHeaders === 1 ? '' : 's'} under a blank or merged header ignored.`);

  return { rows, warnings, notes };
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
