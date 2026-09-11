import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../ui/components/PageHeader';
import { Card, CardBody, CardHeader } from '../ui/components/Card';
import { Tabs } from '../ui/components/Tabs';
import { Badge, DueBadge, StatusBadge } from '../ui/components/Badge';
import { Avatar } from '../ui/components/Avatar';
import { Select } from '../ui/components/Form';
import { ProgressBar } from '../ui/components/ProgressBar';
import { EmptyState } from '../ui/components/EmptyState';
import { useAppStore } from '../application/store';
import { useData, useDerived } from '../application/selectors';
import type { CapacityWindow } from '../domain/rules';
import { cn } from '../ui/cn';

export function CapacityPage() {
  const derived = useDerived();
  const data = useData();
  const reassign = useAppStore((s) => s.reassignJob);
  const toast = useAppStore((s) => s.toast);
  const [window, setWindow] = useState<CapacityWindow>(30);
  const [selected, setSelected] = useState<string | 'unassigned'>(derived.capacity[30].rows[0]?.user.id ?? 'unassigned');
  const summary = derived.capacity[window];
  const selectedRow = summary.rows.find((r) => r.user.id === selected);
  const jobs = selected === 'unassigned' ? summary.unassigned : (selectedRow?.jobs ?? []);

  const bandLabel = { overloaded: 'Overloaded', balanced: 'Balanced', under: 'Under capacity' };
  const bandTone = { overloaded: 'red', balanced: 'green', under: 'blue' } as const;

  return (
    <div className="animate-in">
      <PageHeader title="Capacity" description="Remaining effort on jobs due in the window (plus work already in progress) against chargeable hours. Reassign directly — every screen updates." />
      <Tabs
        value={String(window)}
        onChange={(v) => setWindow(Number(v) as CapacityWindow)}
        className="mb-4"
        options={[
          { value: '7', label: 'Next 7 days' },
          { value: '30', label: 'Next 30 days' },
          { value: '60', label: 'Next 60 days' },
        ]}
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {summary.rows.map((r) => (
          <button key={r.user.id} type="button" onClick={() => setSelected(r.user.id)} className={cn('card text-left px-4 py-3.5 transition-colors', selected === r.user.id ? 'ring-2 ring-primary-500 border-primary-300' : 'hover:border-slate-300')} aria-pressed={selected === r.user.id}>
            <div className="flex items-center gap-2.5">
              <Avatar user={r.user} />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900 truncate">{r.user.name}</p>
                <p className="text-xs text-slate-500 capitalize">{r.user.role}</p>
              </div>
            </div>
            <div className="mt-3 flex items-baseline justify-between">
              <span className="text-xl font-bold tabular text-slate-900">
                {r.jobCount} <span className="text-xs font-medium text-slate-500">jobs</span>
              </span>
              <span className="text-[13px] tabular text-slate-700">
                {r.estimatedHours}h <span className="text-slate-400">/ {r.availableHours}h</span>
              </span>
            </div>
            <ProgressBar value={Math.min(100, r.utilisation * 100)} size="sm" className="mt-2" tone={r.band === 'overloaded' ? 'red' : r.band === 'under' ? 'blue' : 'green'} />
            <div className="mt-2">
              <Badge tone={bandTone[r.band]} dot>
                {bandLabel[r.band]}
              </Badge>
            </div>
          </button>
        ))}
        <button type="button" onClick={() => setSelected('unassigned')} className={cn('card text-left px-4 py-3.5 transition-colors border-dashed', selected === 'unassigned' ? 'ring-2 ring-primary-500 border-primary-300' : 'hover:border-slate-300')} aria-pressed={selected === 'unassigned'}>
          <div className="flex items-center gap-2.5">
            <Avatar />
            <p className="text-sm font-semibold text-slate-900">Unassigned</p>
          </div>
          <p className="mt-3 text-xl font-bold tabular text-slate-900">
            {summary.unassigned.length} <span className="text-xs font-medium text-slate-500">jobs</span>
          </p>
          <p className="mt-2 text-xs text-slate-500">{summary.unassigned.length === 0 ? 'Everything has an owner.' : 'Work nobody owns yet.'}</p>
        </button>
      </div>

      <Card className="mt-5">
        <CardHeader title={selected === 'unassigned' ? 'Unassigned work' : `${selectedRow?.user.name}'s jobs`} description={`Due in the next ${window} days. Change the owner inline to rebalance.`} />
        {jobs.length === 0 ? (
          <EmptyState title="No jobs in this window" compact />
        ) : (
          <CardBody className="pt-0">
            <ul className="divide-y divide-slate-100">
              {jobs
                .slice()
                .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
                .map((job) => {
                  const v = derived.jobViewById.get(job.id)!;
                  return (
                    <li key={job.id} className="py-2.5 flex flex-col sm:flex-row sm:items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <Link to={`/jobs/${job.id}`} className="text-sm font-medium text-slate-900 hover:text-primary-700">
                          {v.client.name} · {job.name}
                        </Link>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <StatusBadge status={job.status} />
                          <DueBadge days={v.daysUntilDue} />
                          <span className="text-xs text-slate-500 tabular">{job.estimatedHours}h</span>
                        </div>
                      </div>
                      <Select
                        value={job.assigneeUserId ?? ''}
                        onChange={(e) => {
                          reassign(job.id, e.target.value || undefined);
                          toast({ title: 'Job reassigned', description: `${job.name} → ${data.users.find((u) => u.id === e.target.value)?.name ?? 'Unassigned'}`, tone: 'success' });
                        }}
                        aria-label={`Reassign ${job.name}`}
                        className="sm:w-48"
                      >
                        <option value="">Unassigned</option>
                        {data.users.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name}
                          </option>
                        ))}
                      </Select>
                    </li>
                  );
                })}
            </ul>
          </CardBody>
        )}
      </Card>
    </div>
  );
}
