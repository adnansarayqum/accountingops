/**
 * Bank statement transactions — the browser side of server/routes/bank.mjs.
 * Every call answers null / false rather than throwing: without a server
 * (browser-only mode) there is simply nothing to show.
 */
import type { BankStatement } from '../domain/rules/bankStatements';

async function safeJson<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export interface BankStatementsResult {
  statements: BankStatement[];
  /** Whether the server can read a statement at all (it has an API key). */
  canRead: boolean;
}

/** The statements read from these documents, given each document's first upload id. Null when there is no server. */
export async function getBankStatements(sourceUploadIds: string[]): Promise<BankStatementsResult | null> {
  if (sourceUploadIds.length === 0) return { statements: [], canRead: false };
  try {
    const res = await fetch('/api/bank/statements/query', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uploadIds: sourceUploadIds }) });
    if (!res.ok) return null;
    const body = await safeJson<{ statements: BankStatement[]; canRead: boolean }>(res);
    return body ? { statements: body.statements, canRead: body.canRead } : null;
  } catch {
    return null;
  }
}

export type ReadRequest = { ok: true; status: string } | { ok: false; error: 'not_configured' | 'rate_limited' | 'not_found' | 'failed' };

/** Asks the server to read a document's transactions (every page's upload id, in order). */
export async function requestStatementRead(uploadIds: string[]): Promise<ReadRequest> {
  try {
    const res = await fetch('/api/bank/statements/read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uploadIds }) });
    if (res.ok) return { ok: true, status: (await safeJson<{ status: string }>(res))?.status ?? 'reading' };
    if (res.status === 503) return { ok: false, error: 'not_configured' };
    if (res.status === 429) return { ok: false, error: 'rate_limited' };
    if (res.status === 404) return { ok: false, error: 'not_found' };
    return { ok: false, error: 'failed' };
  } catch {
    return { ok: false, error: 'failed' };
  }
}

/** A person's correction of one line's category. */
export async function setTransactionCategory(transactionId: string, category: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/bank/transactions/${encodeURIComponent(transactionId)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ category }) });
    return res.ok;
  } catch {
    return false;
  }
}
