import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileSpreadsheet, Upload, AlertTriangle } from 'lucide-react';
import { PageHeader } from '../ui/components/PageHeader';
import { Card, CardBody, CardHeader } from '../ui/components/Card';
import { Button } from '../ui/components/Button';
import { Badge } from '../ui/components/Badge';
import { useAppStore } from '../application/store';
import { formatDate } from '../domain/dates';
import type { ClientRosterRow } from '../application/clientImport';

export function ImportClientsPage() {
  const navigate = useNavigate();
  const importClients = useAppStore((s) => s.importClients);
  const toast = useAppStore((s) => s.toast);
  const fileInput = useRef<HTMLInputElement>(null);
  const [parsing, setParsing] = useState(false);
  const [rows, setRows] = useState<ClientRosterRow[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const reset = () => {
    setRows([]);
    setWarnings([]);
    setFileName(null);
    if (fileInput.current) fileInput.current.value = '';
  };

  const onFile = async (file: File) => {
    setParsing(true);
    setFileName(file.name);
    try {
      const { parseClientRosterFile } = await import('../integrations/clientRosterFile');
      const parsed = await parseClientRosterFile(file);
      setRows(parsed.rows);
      setWarnings(parsed.warnings);
      if (parsed.rows.length === 0) {
        toast({ title: "Couldn't find any usable rows", description: 'Check the file has a Name and Company no column.', tone: 'error' });
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

  return (
    <div className="animate-in max-w-4xl">
      <PageHeader title="Import clients" description="Add clients in bulk from an existing roster. Parsed entirely in your browser — the file is never uploaded anywhere." />

      <Card>
        <CardHeader title="Upload a spreadsheet" icon={<FileSpreadsheet />} description="Columns: Name, Company no, UTR number, Auth code, Personal Code, Gateway, Next accounts, Due, Date for CS. Extra or missing columns are fine — only Name and Company no are required." />
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

      {rows.length > 0 && (
        <Card className="mt-4">
          <CardHeader title={`${rows.length} client${rows.length === 1 ? '' : 's'} ready to import`} description="Each one gets a placeholder contact you can fill in afterwards, plus an accounts and/or confirmation-statement job where a date was given." />
          <CardBody className="pt-0">
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-xs font-medium text-slate-500 border-b border-slate-100">
                    <th className="py-2 pr-3 font-medium">Client</th>
                    <th className="py-2 px-3 font-medium">Company no</th>
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
              <Button onClick={confirmImport} disabled={importing} data-testid="confirm-import">
                {importing ? 'Importing…' : `Import ${rows.length} client${rows.length === 1 ? '' : 's'}`}
              </Button>
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
