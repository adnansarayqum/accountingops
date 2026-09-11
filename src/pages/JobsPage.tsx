import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '../ui/components/PageHeader';
import { Card } from '../ui/components/Card';
import { JobList } from '../ui/components/JobList';
import { Select } from '../ui/components/Form';
import { Tabs } from '../ui/components/Tabs';
import { useData, useDerived } from '../application/selectors';
import { JOB_STATUS_LABELS, JOB_STATUS_ORDER, SERVICES, WAITING_ON_LABELS } from '../domain/catalog';
import type { JobStatus, ServiceCode, WaitingOn } from '../domain/types';

type DueFilter = 'all' | 'overdue' | '7' | '14' | '30' | '60';

export function JobsPage() {
  const derived = useDerived();
  const data = useData();
  const [params, setParams] = useSearchParams();
  const status = (params.get('status') ?? 'open') as JobStatus | 'open' | 'all' | 'filed';
  const waiting = (params.get('waiting') ?? 'all') as WaitingOn | 'all';
  const due = (params.get('due') ?? 'all') as DueFilter;
  const owner = params.get('owner') ?? 'all';
  const service = (params.get('service') ?? 'all') as ServiceCode | 'all';

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value === 'all' || (key === 'status' && value === 'open')) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };

  const views = useMemo(
    () =>
      derived.jobViews
        .filter((v) => (status === 'open' ? v.job.status !== 'filed' : status === 'all' ? true : v.job.status === status))
        .filter((v) => (waiting === 'all' ? true : v.job.waitingOn === waiting))
        .filter((v) => (owner === 'all' ? true : owner === 'unassigned' ? !v.job.assigneeUserId : v.job.assigneeUserId === owner))
        .filter((v) => (service === 'all' ? true : v.job.serviceCode === service))
        .filter((v) => {
          if (due === 'all') return true;
          if (due === 'overdue') return v.daysUntilDue < 0 && v.job.status !== 'filed';
          return v.daysUntilDue >= 0 && v.daysUntilDue <= Number(due);
        }),
    [derived, status, waiting, owner, service, due],
  );

  const open = derived.jobViews.filter((v) => v.job.status !== 'filed');

  return (
    <div className="animate-in">
      <PageHeader title="Jobs" description={`${open.length} open jobs across ${new Set(open.map((v) => v.client.id)).size} clients. Status and "waiting on" are independent.`} />
      <div className="flex flex-col gap-3 mb-4">
        <Tabs
          value={status === 'open' || status === 'all' || status === 'filed' ? status : 'open'}
          onChange={(v) => set('status', v)}
          options={[
            { value: 'open', label: 'Open', count: open.length },
            { value: 'filed', label: 'Filed', count: derived.jobViews.length - open.length },
            { value: 'all', label: 'All' },
          ]}
        />
        <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2">
          <Select value={JOB_STATUS_ORDER.includes(status as JobStatus) ? status : 'all'} onChange={(e) => set('status', e.target.value === 'all' ? 'open' : e.target.value)} aria-label="Status" className="sm:w-52">
            <option value="all">Any status</option>
            {JOB_STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {JOB_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
          <Select value={waiting} onChange={(e) => set('waiting', e.target.value)} aria-label="Waiting on" className="sm:w-44">
            <option value="all">Waiting on anyone</option>
            {(Object.keys(WAITING_ON_LABELS) as WaitingOn[]).map((w) => (
              <option key={w} value={w}>
                {WAITING_ON_LABELS[w]}
              </option>
            ))}
          </Select>
          <Select value={due} onChange={(e) => set('due', e.target.value)} aria-label="Due" className="sm:w-40">
            <option value="all">Any deadline</option>
            <option value="overdue">Overdue</option>
            <option value="7">Due in 7 days</option>
            <option value="14">Due in 14 days</option>
            <option value="30">Due in 30 days</option>
            <option value="60">Due in 60 days</option>
          </Select>
          <Select value={service} onChange={(e) => set('service', e.target.value)} aria-label="Service" className="sm:w-44">
            <option value="all">All services</option>
            {(Object.keys(SERVICES) as ServiceCode[]).map((s) => (
              <option key={s} value={s}>
                {SERVICES[s].name}
              </option>
            ))}
          </Select>
          <Select value={owner} onChange={(e) => set('owner', e.target.value)} aria-label="Owner" className="sm:w-40">
            <option value="all">All owners</option>
            <option value="unassigned">Unassigned</option>
            {data.users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <Card>
        <JobList views={views} emptyTitle="No jobs match these filters" emptyDescription="Try widening the deadline window or clearing a filter." />
      </Card>
    </div>
  );
}
