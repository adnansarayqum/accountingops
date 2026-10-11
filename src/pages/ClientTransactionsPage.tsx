import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Download, FileText, Landmark, Loader2, RefreshCw } from 'lucide-react';
import { PageHeader } from '../ui/components/PageHeader';
import { Card, CardBody, CardHeader } from '../ui/components/Card';
import { Badge } from '../ui/components/Badge';
import { Button } from '../ui/components/Button';
import { EmptyState } from '../ui/components/EmptyState';
import { Input, Select } from '../ui/components/Form';
import { useAppStore } from '../application/store';
import { useData } from '../application/selectors';
import { useBankStatements } from '../application/useBankStatements';
import { requestStatementRead, setTransactionCategory } from '../integrations/bank';
import { formatDate } from '../domain/dates';
import { accountLabel, BANK_CATEGORIES, checkStatements, formatMoney, reconcile, summariseTransactions, type BankStatement } from '../domain/rules/bankStatements';
import { EXPORT_FORMATS, exportFileName, exportLines, toCsv, type ExportFormat } from '../domain/rules/bankExport';
import { cn } from '../ui/cn';

const PAGE_SIZE = 200;

/** Hands a CSV to the browser as a download, with no server involved. */
function download(fileName: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

const readErrors = {
  not_configured: 'Reading statements needs the server’s Anthropic key, which isn’t set.',
  rate_limited: 'Too many reads just now — wait a minute and try again.',
  not_found: 'That document’s files can’t be found on the server.',
  failed: 'The read could not be started. Try again.',
} as const;

/**
 * Every transaction read off a client's bank statements: who they are with,
 * whether the statements add up and follow on, and the lines themselves with
 * a category a person can correct, ready to export for Xero or QuickBooks.
 * The lines are read by the server (see docs/INTEGRATIONS.md); this page
 * only shows, checks and exports them.
 */
export function ClientTransactionsPage() {
  const { clientId } = useParams();
  const data = useData();
  const toast = useAppStore((s) => s.toast);
  const client = data.clients.find((c) => c.id === clientId);

  const documents = useMemo(
    () => data.documents.filter((d) => d.clientId === clientId && d.documentType === 'Bank statement' && (d.intakeUploadIds?.length ?? 0) > 0).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)),
    [data.documents, clientId],
  );
  const { statements, canRead, loaded, refresh, patchTransaction } = useBankStatements(documents.map((d) => (d.intakeUploadIds as string[])[0]));

  const [account, setAccount] = useState('all');
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');
  const [shown, setShown] = useState(PAGE_SIZE);
  const [asking, setAsking] = useState<string | null>(null);

  const checks = useMemo(() => checkStatements(statements ?? []), [statements]);
  const lines = useMemo(() => exportLines(statements ?? []), [statements]);
  const accounts = useMemo(() => [...new Set(lines.map((l) => l.account))], [lines]);
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return lines.filter((l) => (account === 'all' || l.account === account) && (category === 'all' || l.category === category) && (!needle || l.description.toLowerCase().includes(needle)));
  }, [lines, account, category, search]);
  const summary = useMemo(() => summariseTransactions(filtered), [filtered]);

  if (!client) {
    return (
      <Card>
        <EmptyState title="Client not found" description="That client doesn't exist, or was removed." headingLevel="h1" />
      </Card>
    );
  }

  const statementFor = (sourceUploadId: string): BankStatement | undefined => statements?.find((s) => s.sourceUploadId === sourceUploadId);

  const read = async (uploadIds: string[], docId: string) => {
    setAsking(docId);
    try {
      const result = await requestStatementRead(uploadIds);
      if (!result.ok) {
        toast({ title: "Couldn't read that statement", description: readErrors[result.error], tone: 'error' });
        return;
      }
      await refresh();
    } finally {
      setAsking(null);
    }
  };

  const recategorise = async (transactionId: string, was: { category: string; categorySource: 'ai' | 'user' }, now: string) => {
    patchTransaction(transactionId, { category: now, categorySource: 'user' });
    if (!(await setTransactionCategory(transactionId, now))) {
      patchTransaction(transactionId, was);
      toast({ title: "Couldn't change the category", description: 'It has been put back.', tone: 'error' });
    }
  };

  const exportAs = (format: ExportFormat) => {
    download(exportFileName(client.name, format), toCsv(filtered, format));
    toast({ title: 'Exported', description: `${filtered.length} transaction${filtered.length === 1 ? '' : 's'} as ${EXPORT_FORMATS.find((f) => f.format === format)?.label}.`, tone: 'success' });
  };

  const label = (id: string) => (statements ?? []).find((s) => s.id === id);
  const periodText = (s?: Pick<BankStatement, 'periodStart' | 'periodEnd'>) => (s?.periodStart && s?.periodEnd ? `${formatDate(s.periodStart)} – ${formatDate(s.periodEnd)}` : 'an unknown period');

  return (
    <div className="animate-in" data-testid="client-transactions">
      <PageHeader
        eyebrow={
          <Link to={`/clients/${client.id}`} className="hover:underline">
            {client.name}
          </Link>
        }
        title="Bank transactions"
        description="Every line read off the bank statements this client sent. The categories are suggestions — correct any that are wrong."
      />

      {loaded && statements === null ? (
        <Card>
          <EmptyState icon={<Landmark />} title="Needs the signed-in app" description="Transactions are read and stored on the server, so they aren't available in the browser-only version." />
        </Card>
      ) : documents.length === 0 ? (
        <Card>
          <EmptyState icon={<Landmark />} title="No bank statements yet" description="When this client sends a bank statement — shared from WhatsApp or email into the app — its transactions appear here." />
        </Card>
      ) : (
        <div className="space-y-5">
          <Card data-testid="statement-list">
            <CardHeader title="Statements" description={`${documents.length} bank statement${documents.length === 1 ? '' : 's'} received.`} icon={<FileText />} />
            <CardBody className="pt-0">
              <ul className="divide-y divide-slate-100">
                {documents.map((doc) => {
                  const statement = statementFor((doc.intakeUploadIds as string[])[0]);
                  const rec = statement?.status === 'extracted' ? reconcile(statement) : null;
                  return (
                    <li key={doc.id} className="py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between" data-testid={`statement-${doc.id}`}>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-900 break-all">{doc.fileName}</p>
                        <p className="text-xs text-slate-500">
                          Received {formatDate(doc.receivedAt)}
                          {statement?.status === 'extracted' && ` · ${accountLabel(statement)} · ${periodText(statement)} · ${statement.transactions.length} transaction${statement.transactions.length === 1 ? '' : 's'}`}
                        </p>
                        {statement?.status === 'failed' && <p className="text-xs text-red-600 mt-0.5">{statement.error ?? 'It could not be read.'}</p>}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {statement?.status === 'reading' && (
                          <Badge tone="blue">
                            <Loader2 className="h-3 w-3 animate-spin" /> Reading…
                          </Badge>
                        )}
                        {rec?.status === 'ok' && <Badge tone="green">Adds up</Badge>}
                        {rec?.status === 'off' && <Badge tone="amber">Off by {formatMoney(Math.abs(rec.difference))}</Badge>}
                        {rec?.status === 'unknown' && <Badge tone="neutral">Balances not printed</Badge>}
                        {(!statement || statement.status === 'failed') && canRead && (
                          <Button size="sm" variant="secondary" icon={statement ? <RefreshCw /> : <FileText />} disabled={asking === doc.id} onClick={() => read(doc.intakeUploadIds as string[], doc.id)} data-testid={`read-${doc.id}`}>
                            {statement ? 'Try again' : 'Read transactions'}
                          </Button>
                        )}
                        {!statement && !canRead && loaded && <Badge tone="neutral">Not read — no AI key on the server</Badge>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </CardBody>
          </Card>

          {(statements ?? []).some((s) => s.status === 'extracted') && (
            <Card data-testid="statement-checks">
              <CardHeader
                title={
                  <span className="flex items-center gap-2">
                    Checks
                    {checks.allClear ? <Badge tone="green">All clear</Badge> : <Badge tone="amber">Needs a look</Badge>}
                  </span>
                }
                description="Do the statements follow on from each other, and does each one add up?"
                icon={checks.allClear ? <CheckCircle2 /> : <AlertTriangle />}
              />
              <CardBody className="pt-0 space-y-3 text-[13px] text-slate-700">
                {checks.allClear && <p>No missing months, overlaps or balance breaks, and every statement adds up.</p>}
                {checks.accounts.map((a) => (
                  <div key={a.key} data-testid={`checks-${a.key}`}>
                    <p className="font-medium text-slate-900">
                      {a.label} <span className="font-normal text-slate-500">· {a.statements} statement{a.statements === 1 ? '' : 's'}, {formatDate(a.from)} – {formatDate(a.to)}</span>
                    </p>
                    <ul className="mt-1 space-y-1 list-disc pl-5">
                      {a.gaps.map((g) => (
                        <li key={g.from} className="text-amber-800">
                          <strong>Missing:</strong> nothing covers {formatDate(g.from)} – {formatDate(g.to)}. Ask the client for that statement.
                        </li>
                      ))}
                      {a.overlaps.map((o) => (
                        <li key={`${o.first}-${o.second}`} className="text-amber-800">
                          <strong>Overlap:</strong> the statements for {periodText(label(o.first))} and {periodText(label(o.second))} overlap, so some transactions appear twice.
                        </li>
                      ))}
                      {a.breaks.map((b) => (
                        <li key={`${b.before}-${b.after}`} className="text-amber-800">
                          <strong>Balance break:</strong> the statement ending {formatDate(label(b.before)?.periodEnd ?? undefined)} closes at {formatMoney(b.closing)}, but the next opens at {formatMoney(b.opening)}. A page may be missing.
                        </li>
                      ))}
                      {a.gaps.length === 0 && a.overlaps.length === 0 && a.breaks.length === 0 && <li className="text-emerald-700 list-none -ml-5">Follows on without gaps.</li>}
                    </ul>
                  </div>
                ))}
                {checks.problems.map((p) => (
                  <p key={p.statementId} className="text-amber-800" data-testid={`problem-${p.statementId}`}>
                    <strong>{p.label}, {p.period}:</strong>{' '}
                    {p.reconciliation.status === 'off' && `the lines are ${formatMoney(Math.abs(p.reconciliation.difference))} ${p.reconciliation.difference > 0 ? 'short of' : 'over'} the closing balance — a line may be missing or misread. `}
                    {p.droppedLines > 0 && `${p.droppedLines} line${p.droppedLines === 1 ? ' was' : 's were'} left out because it couldn’t be read reliably.`}
                  </p>
                ))}
              </CardBody>
            </Card>
          )}

          {lines.length > 0 && (
            <>
              <Card data-testid="transactions">
                <CardHeader
                  title="Transactions"
                  description={`${filtered.length} of ${lines.length} shown · in ${formatMoney(summary.moneyIn)} · out ${formatMoney(summary.moneyOut)}`}
                  icon={<Landmark />}
                />
                <CardBody className="pt-0">
                  <div className="flex flex-wrap items-center gap-2 mb-3" data-testid="tx-exports">
                    <span className="text-xs font-medium text-slate-500">Export the lines shown:</span>
                    {EXPORT_FORMATS.map((f) => (
                      <Button key={f.format} size="sm" variant="secondary" icon={<Download />} onClick={() => exportAs(f.format)} disabled={filtered.length === 0} title={f.description} data-testid={`export-${f.format}`}>
                        {f.label}
                      </Button>
                    ))}
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row mb-3">
                    <Input value={search} onChange={(e) => { setSearch(e.target.value); setShown(PAGE_SIZE); }} placeholder="Search descriptions" aria-label="Search descriptions" data-testid="tx-search" className="sm:max-w-xs" />
                    <Select value={category} onChange={(e) => { setCategory(e.target.value); setShown(PAGE_SIZE); }} aria-label="Filter by category" data-testid="tx-category-filter" className="sm:max-w-xs">
                      <option value="all">All categories</option>
                      {BANK_CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </Select>
                    {accounts.length > 1 && (
                      <Select value={account} onChange={(e) => { setAccount(e.target.value); setShown(PAGE_SIZE); }} aria-label="Filter by account" data-testid="tx-account-filter" className="sm:max-w-xs">
                        <option value="all">All accounts</option>
                        {accounts.map((a) => (
                          <option key={a} value={a}>
                            {a}
                          </option>
                        ))}
                      </Select>
                    )}
                  </div>

                  {filtered.length === 0 ? (
                    <p className="text-sm text-slate-500 py-4 text-center">Nothing matches.</p>
                  ) : (
                    <ul className="divide-y divide-slate-100" data-testid="tx-list">
                      {filtered.slice(0, shown).map((t) => (
                        <li key={t.id} className="py-2.5 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1.5 sm:grid-cols-[6rem_1fr_11rem_8rem] sm:items-center" data-testid={`tx-${t.id}`}>
                          <span className="text-xs text-slate-500 tabular order-2 sm:order-none">{formatDate(t.date)}</span>
                          <span className="text-[13px] text-slate-900 break-words min-w-0 order-1 sm:order-none">{t.description}</span>
                          <Select
                            value={t.category}
                            onChange={(e) => recategorise(t.id, { category: t.category, categorySource: t.categorySource }, e.target.value)}
                            aria-label={`Category for ${t.description}`}
                            className={cn('h-8 text-xs order-3 sm:order-none', t.categorySource === 'user' && 'border-primary-300')}
                            title={t.categorySource === 'user' ? 'Set by a person' : 'Suggested'}
                            data-testid={`tx-category-${t.id}`}
                          >
                            {!(BANK_CATEGORIES as readonly string[]).includes(t.category) && <option value={t.category}>{t.category}</option>}
                            {BANK_CATEGORIES.map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                          </Select>
                          <span className={cn('text-[13px] font-medium tabular text-right order-1 sm:order-none', t.amount < 0 ? 'text-slate-900' : 'text-emerald-700')}>{formatMoney(t.amount)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {filtered.length > shown && (
                    <div className="pt-3 text-center">
                      <Button size="sm" variant="ghost" onClick={() => setShown((n) => n + PAGE_SIZE)} data-testid="tx-show-more">
                        Show more ({filtered.length - shown} left)
                      </Button>
                    </div>
                  )}
                </CardBody>
              </Card>

              <Card data-testid="tx-by-category">
                <CardHeader title="By category" description="For the lines shown above." />
                <CardBody className="pt-0">
                  <ul className="divide-y divide-slate-100 text-[13px]">
                    {summary.byCategory.map((c) => (
                      <li key={c.category} className="py-2 flex items-center justify-between gap-3">
                        <span className="min-w-0 text-slate-800">
                          {c.category} <span className="text-slate-400">· {c.count}</span>
                        </span>
                        <span className="tabular shrink-0">
                          {c.moneyIn > 0 && <span className="text-emerald-700">{formatMoney(c.moneyIn)}</span>}
                          {c.moneyIn > 0 && c.moneyOut > 0 && <span className="text-slate-300"> / </span>}
                          {c.moneyOut > 0 && <span className="text-slate-900">-{formatMoney(c.moneyOut)}</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                </CardBody>
              </Card>
            </>
          )}
        </div>
      )}
    </div>
  );
}
