import { useCallback, useEffect, useRef, useState } from 'react';
import { getBankStatements } from '../integrations/bank';
import type { BankStatement } from '../domain/rules/bankStatements';

/** How often to look again while a statement is still being read. */
export const READING_POLL_MS = 4000;

export interface BankStatementsState {
  /** Null until the first answer; also null for good when there is no server. */
  statements: BankStatement[] | null;
  canRead: boolean;
  /** True once there has been an answer, even an empty one. */
  loaded: boolean;
  refresh: () => Promise<void>;
  /** Edits one line in place, without another round trip. */
  patchTransaction: (transactionId: string, patch: { category: string; categorySource: 'ai' | 'user' }) => void;
}

/**
 * A client's bank statements, found through their documents (sourceUploadIds
 * are the first upload ids). While any is still being read, asks again every
 * few seconds, and stops the moment none is — or the tab is hidden.
 */
export function useBankStatements(sourceUploadIds: string[]): BankStatementsState {
  const key = sourceUploadIds.join('|');
  const [statements, setStatements] = useState<BankStatement[] | null>(null);
  const [canRead, setCanRead] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const keyRef = useRef(key);
  keyRef.current = key;

  const refresh = useCallback(async () => {
    const asked = keyRef.current;
    const result = await getBankStatements(asked ? asked.split('|') : []);
    // A different client's page may have been opened while this was in flight.
    if (asked !== keyRef.current) return;
    setStatements(result?.statements ?? null);
    setCanRead(result?.canRead ?? false);
    setLoaded(true);
  }, []);

  useEffect(() => {
    setLoaded(false);
    void refresh();
  }, [key, refresh]);

  const reading = statements?.some((s) => s.status === 'reading') ?? false;
  useEffect(() => {
    if (!reading) return undefined;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, READING_POLL_MS);
    return () => clearInterval(timer);
  }, [reading, refresh]);

  const patchTransaction = useCallback((transactionId: string, patch: { category: string; categorySource: 'ai' | 'user' }) => {
    setStatements((current) => current?.map((s) => ({ ...s, transactions: s.transactions.map((t) => (t.id === transactionId ? { ...t, ...patch } : t)) })) ?? current);
  }, []);

  return { statements, canRead, loaded, refresh, patchTransaction };
}
