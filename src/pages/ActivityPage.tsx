import { useState } from 'react';
import { Link } from 'react-router-dom';
import { FileText, Send, UserCog, ArrowRightCircle, CheckCircle2, Landmark, PlusCircle, Pencil, Inbox, StickyNote, ClipboardList } from 'lucide-react';
import { PageHeader } from '../ui/components/PageHeader';
import { Card, CardBody } from '../ui/components/Card';
import { Tabs } from '../ui/components/Tabs';
import { Select } from '../ui/components/Form';
import { EmptyState } from '../ui/components/EmptyState';
import { useData, useDerived } from '../application/selectors';
import { formatDateTime } from '../domain/dates';
import type { ActivityKind } from '../domain/types';

const ICONS: Record<ActivityKind, React.ComponentType<{ className?: string }>> = {
  document_received: FileText,
  reminder_sent: Send,
  job_reassigned: UserCog,
  status_changed: ArrowRightCircle,
  approval_recorded: CheckCircle2,
  job_filed: Landmark,
  job_generated: PlusCircle,
  client_updated: Pencil,
  client_created: PlusCircle,
  inbox_processed: Inbox,
  onboarding_updated: ClipboardList,
  note: StickyNote,
};

export function ActivityPage() {
  const data = useData();
  const derived = useDerived();
  const [tab, setTab] = useState<'activity' | 'audit'>('activity');
  const [kind, setKind] = useState<'all' | ActivityKind>('all');
  const list = data.activities.filter((a) => (kind === 'all' ? true : a.kind === kind));

  return (
    <div className="animate-in max-w-4xl">
      <PageHeader title="Activity" description="Human-readable operational feed. The audit log is the immutable, security-grade record — the two are kept separate." />
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <Tabs
          value={tab}
          onChange={setTab}
          options={[
            { value: 'activity', label: 'Activity', count: data.activities.length },
            { value: 'audit', label: 'Audit log', count: data.auditEvents.length },
          ]}
        />
        {tab === 'activity' && (
          <Select value={kind} onChange={(e) => setKind(e.target.value as 'all' | ActivityKind)} aria-label="Filter by type" className="w-52">
            <option value="all">All events</option>
            {(Object.keys(ICONS) as ActivityKind[]).map((k) => (
              <option key={k} value={k}>
                {k.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())}
              </option>
            ))}
          </Select>
        )}
      </div>

      {tab === 'activity' && (
        <Card>
          {list.length === 0 ? (
            <EmptyState title="No activity yet" description="Actions you take will appear here." />
          ) : (
            <CardBody className="pt-2">
              <ul className="divide-y divide-slate-100">
                {list.map((a) => {
                  const Icon = ICONS[a.kind];
                  const client = a.clientId ? derived.clientById.get(a.clientId) : undefined;
                  return (
                    <li key={a.id} className="py-3 flex gap-3">
                      <span className="h-8 w-8 rounded-lg bg-slate-100 text-slate-500 flex items-center justify-center shrink-0">
                        <Icon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm text-slate-800">{a.message}</p>
                        <p className="text-xs text-slate-400 mt-0.5 flex flex-wrap gap-x-2">
                          <span>{formatDateTime(a.occurredAt)}</span>
                          {a.actorUserId && <span>· {derived.userById.get(a.actorUserId)?.name}</span>}
                          {client && (
                            <Link to={`/clients/${client.id}`} className="text-primary-700 hover:underline">
                              · {client.name}
                            </Link>
                          )}
                          {a.jobId && (
                            <Link to={`/jobs/${a.jobId}`} className="text-primary-700 hover:underline">
                              · Open job
                            </Link>
                          )}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </CardBody>
          )}
        </Card>
      )}

      {tab === 'audit' && (
        <Card>
          {data.auditEvents.length === 0 ? (
            <EmptyState title="No audit events in this session" description="Every mutation and sensitive-field reveal is recorded here with before/after values." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-xs font-medium text-slate-500 border-b border-slate-100">
                    <th className="py-2 pl-5 pr-3 font-medium">When</th>
                    <th className="py-2 px-3 font-medium">Actor</th>
                    <th className="py-2 px-3 font-medium">Action</th>
                    <th className="py-2 px-3 font-medium">Entity</th>
                    <th className="py-2 px-3 font-medium">Change</th>
                    <th className="py-2 px-3 font-medium">Ref</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono text-xs">
                  {data.auditEvents.slice(0, 200).map((e) => (
                    <tr key={e.id}>
                      <td className="py-2 pl-5 pr-3 whitespace-nowrap text-slate-600">{formatDateTime(e.occurredAt)}</td>
                      <td className="px-3 whitespace-nowrap font-sans text-slate-700">{e.actorUserId ? derived.userById.get(e.actorUserId)?.name : 'system'}</td>
                      <td className="px-3 whitespace-nowrap text-slate-900">{e.action}</td>
                      <td className="px-3 whitespace-nowrap text-slate-600">
                        {e.entityType}/{e.entityId.slice(0, 18)}
                      </td>
                      <td className="px-3 text-slate-600 max-w-xs truncate" title={JSON.stringify({ before: e.before, after: e.after })}>
                        {e.before !== undefined && <span className="text-red-600">{JSON.stringify(e.before)}</span>}
                        {e.before !== undefined && e.after !== undefined && ' → '}
                        {e.after !== undefined && <span className="text-emerald-700">{JSON.stringify(e.after)}</span>}
                      </td>
                      <td className="px-3 text-slate-400">{e.correlationId.slice(-8)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
