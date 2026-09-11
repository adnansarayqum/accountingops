import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, X, FileText, Inbox, Mail, ScanLine, Globe, Pencil } from 'lucide-react';
import { PageHeader } from '../ui/components/PageHeader';
import { Card, CardBody } from '../ui/components/Card';
import { Badge } from '../ui/components/Badge';
import { Button } from '../ui/components/Button';
import { EmptyState } from '../ui/components/EmptyState';
import { Select, Input, Field } from '../ui/components/Form';
import { ProgressBar } from '../ui/components/ProgressBar';
import { Tabs } from '../ui/components/Tabs';
import { useAppStore } from '../application/store';
import { useData, useDerived, useToday } from '../application/selectors';
import { formatAgo, formatDate, formatDateTime } from '../domain/dates';
import type { InboxItem } from '../domain/types';
import { cn } from '../ui/cn';

export function InboxPage() {
  const data = useData();
  const derived = useDerived();
  const today = useToday();
  const confirm = useAppStore((s) => s.confirmInboxItem);
  const dismiss = useAppStore((s) => s.dismissInboxItem);
  const update = useAppStore((s) => s.updateInboxSuggestion);
  const toast = useAppStore((s) => s.toast);
  const [tab, setTab] = useState<'pending' | 'processed'>('pending');
  const [editing, setEditing] = useState<string | null>(null);

  const pending = data.inboxItems.filter((i) => i.status === 'pending');
  const processed = data.inboxItems.filter((i) => i.status !== 'pending').sort((a, b) => (b.resolvedAt ?? '').localeCompare(a.resolvedAt ?? ''));
  const SourceIcon = { email: Mail, portal: Globe, scan: ScanLine };

  const onConfirm = (item: InboxItem) => {
    try {
      const client = derived.clientById.get(item.suggestion.clientId ?? '');
      const job = data.jobs.find((j) => j.id === item.suggestion.jobId);
      confirm(item.id);
      toast({ title: 'Document attached', description: `${item.suggestion.documentType} attached to ${client?.name}${job ? ` — ${job.name}. Checklist and completion updated.` : '.'}`, tone: 'success' });
    } catch (err) {
      toast({ title: "Couldn't attach the document", description: (err as Error).message, tone: 'error' });
    }
  };

  return (
    <div className="animate-in">
      <PageHeader title="Smart Inbox" description="Incoming documents are matched to a client and job. The system suggests; you confirm. Nothing is attached without a human decision." />
      <Tabs
        value={tab}
        onChange={setTab}
        className="mb-4"
        options={[
          { value: 'pending', label: 'To review', count: pending.length },
          { value: 'processed', label: 'Processed', count: processed.length },
        ]}
      />

      {tab === 'pending' &&
        (pending.length === 0 ? (
          <Card>
            <EmptyState icon={<Inbox />} title="Inbox cleared" description="New documents requiring review will appear here." />
          </Card>
        ) : (
          <div className="space-y-3" data-testid="inbox-list">
            {pending.map((item) => {
              const client = derived.clientById.get(item.suggestion.clientId ?? '');
              const job = data.jobs.find((j) => j.id === item.suggestion.jobId);
              const confidence = Math.round(item.suggestion.confidence * 100);
              const Icon = SourceIcon[item.source];
              const clientJobs = derived.jobViews.filter((v) => v.client.id === item.suggestion.clientId && v.job.status !== 'filed');
              const isEditing = editing === item.id;
              const outstanding = job ? data.requestItems.filter((r) => r.jobId === job.id && r.status !== 'received') : [];
              return (
                <Card key={item.id} className="animate-in" data-testid={`inbox-${item.id}`}>
                  <CardBody className="pt-4">
                    <div className="flex flex-col lg:flex-row gap-4">
                      <div className="flex gap-3 min-w-0 lg:w-80 shrink-0">
                        <span className="h-10 w-10 rounded-lg bg-slate-100 text-slate-500 flex items-center justify-center shrink-0">
                          <FileText className="h-5 w-5" />
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-900 break-all">{item.fileName}</p>
                          <p className="text-xs text-slate-500 mt-0.5 inline-flex items-center gap-1">
                            <Icon className="h-3 w-3" /> {item.source === 'scan' ? 'Scanned post' : item.sender} · {formatAgo(item.receivedAt, today)} · {item.sizeKb >= 1024 ? `${(item.sizeKb / 1024).toFixed(1)} MB` : `${item.sizeKb} KB`}
                          </p>
                          <div className="mt-2">
                            <div className="flex items-center justify-between text-xs mb-1">
                              <span className="text-slate-500">Confidence</span>
                              <span className={cn('font-semibold tabular', confidence >= 90 ? 'text-emerald-600' : confidence >= 75 ? 'text-amber-600' : 'text-red-600')}>{confidence}%</span>
                            </div>
                            <ProgressBar value={confidence} size="sm" tone={confidence >= 90 ? 'green' : confidence >= 75 ? 'amber' : 'red'} />
                          </div>
                        </div>
                      </div>

                      <div className="flex-1 min-w-0">
                        {isEditing ? (
                          <div className="grid gap-3 sm:grid-cols-3">
                            <Field label="Client" htmlFor={`cl-${item.id}`}>
                              <Select id={`cl-${item.id}`} value={item.suggestion.clientId ?? ''} onChange={(e) => update(item.id, { clientId: e.target.value })}>
                                <option value="">Choose…</option>
                                {data.clients.map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {c.name}
                                  </option>
                                ))}
                              </Select>
                            </Field>
                            <Field label="Job" htmlFor={`job-${item.id}`}>
                              <Select id={`job-${item.id}`} value={item.suggestion.jobId ?? ''} onChange={(e) => update(item.id, { jobId: e.target.value })}>
                                <option value="">Client record only</option>
                                {clientJobs.map((v) => (
                                  <option key={v.job.id} value={v.job.id}>
                                    {v.job.name}
                                  </option>
                                ))}
                              </Select>
                            </Field>
                            <Field label="Document type" htmlFor={`dt-${item.id}`}>
                              <Input id={`dt-${item.id}`} value={item.suggestion.documentType} onChange={(e) => update(item.id, { documentType: e.target.value })} list={`dt-options-${item.id}`} />
                              <datalist id={`dt-options-${item.id}`}>
                                {outstanding.map((o) => (
                                  <option key={o.id} value={o.label} />
                                ))}
                              </datalist>
                            </Field>
                          </div>
                        ) : (
                          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2 text-[13px]">
                            <Suggestion label="Suggested client" value={client ? <Link to={`/clients/${client.id}`} className="font-medium text-slate-900 hover:text-primary-700">{client.name}</Link> : <span className="text-red-600">Unknown</span>} />
                            <Suggestion label="Job" value={job ? <Link to={`/jobs/${job.id}`} className="font-medium text-slate-900 hover:text-primary-700">{job.name}</Link> : 'Client record only'} />
                            <Suggestion label="Document" value={<span className="font-medium text-slate-900">{item.suggestion.documentType}</span>} />
                            <Suggestion label="Period" value={item.suggestion.period ?? '—'} />
                            {item.suggestion.extractedReference && <Suggestion label="Extracted reference" value={item.suggestion.extractedReference} />}
                            {item.suggestion.extractedDate && <Suggestion label="Document date" value={formatDate(item.suggestion.extractedDate)} />}
                          </dl>
                        )}
                        <p className="mt-2 text-xs text-slate-500 italic">{item.suggestion.rationale}</p>
                        {job && outstanding.some((o) => o.documentType.toLowerCase() === item.suggestion.documentType.toLowerCase()) && (
                          <Badge tone="green" className="mt-2 max-w-full !whitespace-normal text-left">
                            Matches an outstanding request on this job — checklist will update
                          </Badge>
                        )}
                      </div>

                      <div className="flex lg:flex-col gap-2 shrink-0 lg:w-40">
                        <Button variant="success" icon={<Check />} onClick={() => onConfirm(item)} disabled={!item.suggestion.clientId} className="flex-1" data-testid={`confirm-${item.id}`}>
                          Confirm
                        </Button>
                        <Button variant="secondary" icon={<Pencil />} onClick={() => setEditing(isEditing ? null : item.id)} className="flex-1">
                          {isEditing ? 'Done' : 'Change'}
                        </Button>
                        <Button variant="ghost" icon={<X />} onClick={() => { dismiss(item.id); toast({ title: 'Dismissed', description: `${item.fileName} will not be attached.`, tone: 'info' }); }} className="flex-1">
                          Dismiss
                        </Button>
                      </div>
                    </div>
                  </CardBody>
                </Card>
              );
            })}
          </div>
        ))}

      {tab === 'processed' && (
        <Card>
          {processed.length === 0 ? (
            <EmptyState title="Nothing processed yet" compact />
          ) : (
            <ul className="divide-y divide-slate-100">
              {processed.map((item) => {
                const client = derived.clientById.get(item.suggestion.clientId ?? '');
                return (
                  <li key={item.id} className="px-5 py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900 truncate">{item.fileName}</p>
                      <p className="text-xs text-slate-500">
                        {item.suggestion.documentType} · {client?.name ?? '—'} · {item.resolvedAt ? formatDateTime(item.resolvedAt) : ''}
                      </p>
                    </div>
                    <Badge tone={item.status === 'confirmed' ? 'green' : 'neutral'}>{item.status === 'confirmed' ? 'Attached' : 'Dismissed'}</Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}

function Suggestion({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-0.5 text-slate-800">{value}</dd>
    </div>
  );
}
