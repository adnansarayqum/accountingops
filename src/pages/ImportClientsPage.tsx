import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileSpreadsheet, Upload, AlertTriangle, Building2, Info } from 'lucide-react';
import { PageHeader } from '../ui/components/PageHeader';
import { Card, CardBody, CardHeader } from '../ui/components/Card';
import { Button } from '../ui/components/Button';
import { Badge } from '../ui/components/Badge';
import { useAppStore } from '../application/store';
import { formatDate } from '../domain/dates';
import { mergeCompanyPeople, mergeCompanyProfile, type ClientRosterRow } from '../application/clientImport';
import { mapWithConcurrency } from '../application/companiesHouseSync';
import { getCompaniesHouseStatus, getCompanyPeople, lookupCompanyProfile, type CompanyLookupOutcome } from '../integrations/companiesHouse';

type EnrichStatus = 'pending' | CompanyLookupOutcome;

// Why a row has no live data, in the words a person would use.
const NO_LIVE_DATA_REASON: Record<Exclude<CompanyLookupOutcome, 'live'>, string | null> = {
  not_configured: null,
  not_found: 'not on the register — check the number',
  rate_limited: 'Companies House is rate limiting, try again in a few minutes',
  unavailable: 'lookup failed',
};

export function ImportClientsPage() {
  const navigate = useNavigate();
  const importClients = useAppStore((s) => s.importClients);
  const toast = useAppStore((s) => s.toast);
  const fileInput = useRef<HTMLInputElement>(null);
  // Each enrichment run gets a number; a run that finds it is no longer the
  // current one (a second file was chosen, or Cancel was pressed) drops its
  // results instead of writing stale rows over the new file's.
  const enrichRun = useRef(0);
  const [parsing, setParsing] = useState(false);
  const [rows, setRows] = useState<ClientRosterRow[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [chConfigured, setChConfigured] = useState<boolean | null>(null);
  const [enriching, setEnriching] = useState(false);
  const [enrichProgress, setEnrichProgress] = useState(0);
  const [enrichStatus, setEnrichStatus] = useState<EnrichStatus[]>([]);

  const reset = () => {
    enrichRun.current += 1;
    setRows([]);
    setWarnings([]);
    setNotes([]);
    setFileName(null);
    setEnrichStatus([]);
    setChConfigured(null);
    setEnriching(false);
    if (fileInput.current) fileInput.current.value = '';
  };

  const enrichFromCompaniesHouse = async (parsedRows: ClientRosterRow[]) => {
    const run = ++enrichRun.current;
    const stillCurrent = () => run === enrichRun.current;
    setEnriching(true);
    setEnrichProgress(0);
    setEnrichStatus(parsedRows.map(() => 'pending'));
    const status = await getCompaniesHouseStatus();
    if (!stillCurrent()) return;
    setChConfigured(status.configured);
    if (!status.configured) {
      // Nothing to look up against — every per-row call would just 503.
      setEnrichStatus(parsedRows.map(() => 'not_configured'));
      setEnriching(false);
      return;
    }

    let done = 0;
    const enriched = await mapWithConcurrency(parsedRows, 4, async (row, i) => {
      const [lookup, people] = await Promise.all([lookupCompanyProfile(row.companyNumber), getCompanyPeople(row.companyNumber)]);
      if (!stillCurrent()) return row;
      done += 1;
      setEnrichProgress(done);
      setEnrichStatus((prev) => {
        const next = [...prev];
        next[i] = lookup.outcome;
        return next;
      });
      // Only genuinely live data is merged. The sample fallback the other
      // lookups use for demos must never be recorded as though it came from
      // the register — it would carry a sync timestamp and suppress the real
      // lookup later.
      let next = lookup.profile ? mergeCompanyProfile(row, lookup.profile) : row;
      if (people.source === 'companies_house' && (people.directors.length > 0 || people.pscs.length > 0)) next = mergeCompanyPeople(next, people);
      return next;
    });
    if (!stillCurrent()) return;

    setRows(enriched);
    setEnriching(false);
  };

  const onFile = async (file: File) => {
    setParsing(true);
    setFileName(file.name);
    try {
      const { parseClientRosterFile } = await import('../integrations/clientRosterFile');
      const parsed = await parseClientRosterFile(file);
      setRows(parsed.rows);
      setWarnings(parsed.warnings);
      setNotes(parsed.notes);
      if (parsed.rows.length === 0) {
        enrichRun.current += 1;
        setEnrichStatus([]);
        setEnriching(false);
        toast({ title: "Couldn't find any usable rows", description: 'Check the file has a Name and Company no column.', tone: 'error' });
      } else {
        void enrichFromCompaniesHouse(parsed.rows);
      }
    } catch (err) {
      toast({ title: "Couldn't read that file", description: (err as Error).message, tone: 'error' });
      reset();
    } finally {
      setParsing(false);
    }
  };

  const confirmImport = () => {
    setImporting(true);
    try {
      const { created, skipped } = importClients(rows);
      toast({
        title: created > 0 ? `${created} client${created === 1 ? '' : 's'} imported` : 'Nothing imported',
        description: skipped.length > 0 ? `${skipped.length} skipped — already on file.` : 'Placeholder contacts were added; fill in details from each client page.',
        tone: created > 0 ? 'success' : 'info',
      });
      navigate('/clients');
    } catch (err) {
      toast({ title: "Import didn't complete", description: (err as Error).message, tone: 'error' });
    } finally {
      setImporting(false);
    }
  };

  const noLiveDataLabel = (status: EnrichStatus) => {
    const reason = status === 'pending' || status === 'live' ? null : NO_LIVE_DATA_REASON[status];
    return reason ? `No live data · ${reason}` : 'No live data';
  };

  return (
    <div className="animate-in max-w-4xl">
      <PageHeader title="Import clients" description="Add clients in bulk from an existing roster, enriched from Companies House. Parsed entirely in your browser — the file is never uploaded anywhere." />

      <Card>
        <CardHeader
          title="Upload a spreadsheet"
          icon={<FileSpreadsheet />}
          description="Columns: Name, Company no, UTR number, Auth code, Personal Code, Gateway, Next accounts, Due, Date for CS. Extra or missing columns are fine — only Name and Company no are required. Dates can be typed the UK way (31/03/2027)."
        />
        <CardBody className="pt-0">
          <input
            ref={fileInput}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onFile(file);
            }}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="secondary" icon={<Upload />} onClick={() => fileInput.current?.click()} disabled={parsing}>
              {parsing ? 'Reading…' : 'Choose file'}
            </Button>
            {fileName && <span className="text-sm text-slate-600">{fileName}</span>}
          </div>
        </CardBody>
      </Card>

      {chConfigured === false && (
        <Card className="mt-4 border-amber-200">
          <CardHeader title="No live Companies House data" icon={<Building2 />} />
          <CardBody className="pt-0 text-[13px] text-slate-700 space-y-1.5">
            <p>No Companies House API key is configured, so registered address, incorporation date, SIC codes and live filing dates couldn't be filled in — clients below only have what the spreadsheet itself gave. You can still import them and refresh from Companies House later.</p>
            <p>
              To turn this on, whoever looks after the deployment registers a free key at <span className="font-mono">developer.company-information.service.gov.uk</span> and sets it as <span className="font-mono">COMPANIES_HOUSE_API_KEY</span>. See{' '}
              <span className="font-mono">docs/INTEGRATIONS.md</span> for the full steps.
            </p>
          </CardBody>
        </Card>
      )}

      {warnings.length > 0 && (
        <Card className="mt-4 border-amber-200">
          <CardHeader title={`${warnings.length} row${warnings.length === 1 ? '' : 's'} skipped`} icon={<AlertTriangle />} />
          <CardBody className="pt-0">
            <ul className="text-[13px] text-slate-600 space-y-1">
              {warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      {notes.length > 0 && (
        <Card className="mt-4" data-testid="import-notes">
          <CardHeader title={`${notes.length} thing${notes.length === 1 ? '' : 's'} to check`} icon={<Info />} description="These rows still import — worth a look before you confirm." />
          <CardBody className="pt-0">
            <ul className="text-[13px] text-slate-600 space-y-1">
              {notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      {rows.length > 0 && (
        <Card className="mt-4">
          <CardHeader
            title={`${rows.length} client${rows.length === 1 ? '' : 's'} ready to import`}
            description={
              enriching
                ? `Looking up Companies House… ${enrichProgress} / ${rows.length}`
                : 'Each one gets a placeholder contact you can fill in afterwards, an accounts and/or confirmation-statement job where a date was given, and any active directors/PSCs Companies House returned.'
            }
          />
          <CardBody className="pt-0">
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-xs font-medium text-slate-500 border-b border-slate-100">
                    <th className="py-2 pr-3 font-medium">Client</th>
                    <th className="py-2 px-3 font-medium">Company no</th>
                    <th className="py-2 px-3 font-medium">Companies House</th>
                    <th className="py-2 px-3 font-medium">Directors &amp; PSCs</th>
                    <th className="py-2 px-3 font-medium">Identifiers</th>
                    <th className="py-2 px-3 font-medium">Accounts due</th>
                    <th className="py-2 px-3 font-medium">CS due</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((r, i) => (
                    <tr key={i}>
                      <td className="py-2 pr-3 font-medium text-slate-900">{r.name}</td>
                      <td className="py-2 px-3 font-mono text-slate-700">{r.companyNumber}</td>
                      <td className="py-2 px-3">
                        {enrichStatus[i] === 'pending' && <span className="text-xs text-slate-400">Looking up…</span>}
                        {enrichStatus[i] === 'live' && (
                          <Badge tone="green" dot>
                            Live{r.companiesHouseStatus ? ` · ${r.companiesHouseStatus}` : ''}
                          </Badge>
                        )}
                        {enrichStatus[i] && enrichStatus[i] !== 'pending' && enrichStatus[i] !== 'live' && (
                          <Badge tone={enrichStatus[i] === 'not_configured' ? 'neutral' : 'amber'}>{noLiveDataLabel(enrichStatus[i])}</Badge>
                        )}
                      </td>
                      <td className="py-2 px-3 text-slate-700">
                        {(r.directors?.length ?? 0) === 0 && (r.pscs?.length ?? 0) === 0
                          ? '—'
                          : [r.directors?.length ? `${r.directors.length} director${r.directors.length === 1 ? '' : 's'}` : null, r.pscs?.length ? `${r.pscs.length} PSC${r.pscs.length === 1 ? '' : 's'}` : null]
                              .filter(Boolean)
                              .join(', ')}
                      </td>
                      <td className="py-2 px-3">
                        <div className="flex flex-wrap gap-1">
                          {r.utr && <Badge tone="neutral">UTR</Badge>}
                          {r.chAuthCode && <Badge tone="neutral">Auth code</Badge>}
                          {r.personalCode && <Badge tone="neutral">Personal code</Badge>}
                          {r.gatewayCredentials && <Badge tone="neutral">Gateway</Badge>}
                        </div>
                      </td>
                      <td className="py-2 px-3 text-slate-700">{r.accountsDue ? formatDate(r.accountsDue) : '—'}</td>
                      <td className="py-2 px-3 text-slate-700">{r.confirmationStatementDue ? formatDate(r.confirmationStatementDue) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              <Button variant="secondary" onClick={reset} disabled={importing}>
                Cancel
              </Button>
              <Button onClick={confirmImport} disabled={importing || enriching} data-testid="confirm-import">
                {importing ? 'Importing…' : enriching ? 'Waiting for Companies House…' : `Import ${rows.length} client${rows.length === 1 ? '' : 's'}`}
              </Button>
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
