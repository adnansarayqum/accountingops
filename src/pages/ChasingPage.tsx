import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Send, BellOff, Clock } from 'lucide-react';
import { PageHeader } from '../ui/components/PageHeader';
import { Card, CardBody, CardHeader } from '../ui/components/Card';
import { Badge, DueBadge, ResponsivenessBadge, StatusBadge } from '../ui/components/Badge';
import { Button } from '../ui/components/Button';
import { EmptyState } from '../ui/components/EmptyState';
import { ReminderComposer } from '../ui/components/ReminderComposer';
import { Tabs } from '../ui/components/Tabs';
import { useData, useDerived, useToday } from '../application/selectors';
import { CHANNEL_LABELS } from '../domain/catalog';
import { formatAgo } from '../domain/dates';
import type { Job } from '../domain/types';

type View = 'due' | 'all' | 'sequences';

export function ChasingPage() {
  const derived = useDerived();
  const data = useData();
  const today = useToday();
  const [view, setView] = useState<View>('due');
  const [composerJob, setComposerJob] = useState<Job | null>(null);

  const chasing = useMemo(() => derived.jobViews.filter((v) => v.chasing.required).sort((a, b) => Number(b.chasing.overdueStep) - Number(a.chasing.overdueStep) || a.daysUntilDue - b.daysUntilDue), [derived]);
  const dueNow = chasing.filter((v) => v.chasing.overdueStep);
  const list = view === 'due' ? dueNow : chasing;
  const stopped = derived.jobViews.filter((v) => v.job.status !== 'filed' && !v.chasing.required && v.completeness.complete && v.job.status === 'ready_to_start');

  return (
    <div className="animate-in">
      <PageHeader title="Chasing" description="Reminders reference the actual outstanding items. Chasing stops automatically once everything is received." />
      <Tabs
        value={view}
        onChange={setView}
        className="mb-4"
        options={[
          { value: 'due', label: 'Reminder due now', count: dueNow.length },
          { value: 'all', label: 'All waiting on clients', count: chasing.length },
          { value: 'sequences', label: 'Sequences' },
        ]}
      />

      {view !== 'sequences' && (
        <>
          <Card>
            {list.length === 0 ? (
              <EmptyState icon={<BellOff />} title="No reminders due" description="Every client has been chased on schedule. Nothing to send right now." />
            ) : (
              <ul className="divide-y divide-slate-100" data-testid="chasing-list">
                {list.map((v) => {
                  const profile = derived.responsivenessByClient.get(v.client.id)!;
                  return (
                    <li key={v.job.id} className="px-4 sm:px-5 py-3.5 flex flex-col md:flex-row md:items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link to={`/clients/${v.client.id}`} className="font-semibold text-slate-900 hover:text-primary-700">
                            {v.client.name}
                          </Link>
                          <Link to={`/jobs/${v.job.id}`} className="text-sm text-slate-600 hover:text-primary-700">
                            {v.job.name}
                          </Link>
                          <DueBadge days={v.daysUntilDue} />
                          <StatusBadge status={v.job.status} />
                        </div>
                        <p className="text-[13px] text-slate-700 mt-1">
                          {v.chasing.kind === 'approval' ? 'Waiting for client approval.' : <>Still needed: <span className="font-medium">{v.chasing.outstanding.map((o) => o.label.toLowerCase()).join(', ')}</span>.</>}
                        </p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                          <ResponsivenessBadge band={profile.band} />
                          <span>
                            {v.chasing.remindersSent} reminder{v.chasing.remindersSent === 1 ? '' : 's'} sent{v.chasing.lastReminderAt ? ` · last ${formatAgo(v.chasing.lastReminderAt, today)}` : ''}
                          </span>
                          {v.chasing.nextStep && (
                            <span className="inline-flex items-center gap-1">
                              <Clock className="h-3 w-3" /> Next: {v.chasing.nextStep.label}
                              {v.chasing.overdueStep && <Badge tone="amber">due now</Badge>}
                            </span>
                          )}
                          <span>Prefers {CHANNEL_LABELS[v.client.preferredChannel]}</span>
                        </div>
                      </div>
                      <Button icon={<Send />} onClick={() => setComposerJob(v.job)} className="shrink-0">
                        Send reminder
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
          {stopped.length > 0 && (
            <Card className="mt-4">
              <CardHeader title="Chasing stopped automatically" description="Everything received — these jobs are ready to start." />
              <CardBody className="pt-0">
                <ul className="flex flex-wrap gap-2">
                  {stopped.map((v) => (
                    <li key={v.job.id}>
                      <Link to={`/jobs/${v.job.id}`} className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[13px] text-emerald-800 hover:bg-emerald-100">
                        {v.client.name} · {v.job.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}
        </>
      )}

      {view === 'sequences' && (
        <div className="grid gap-4 md:grid-cols-2">
          {data.reminderSequences.map((s) => (
            <Card key={s.id}>
              <CardHeader title={s.name} description="Steps run relative to the job deadline. Each message references the actual outstanding items." />
              <CardBody className="pt-0">
                <ol className="relative border-l border-slate-200 ml-2 space-y-3 py-1">
                  {s.steps.map((step) => (
                    <li key={step.label} className="pl-5 relative">
                      <span className="absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full bg-primary-500 ring-2 ring-white" />
                      <p className="text-sm font-medium text-slate-900">{step.daysBeforeDue} days before deadline</p>
                      <p className="text-xs text-slate-500">
                        {step.channels.map((c) => CHANNEL_LABELS[c]).join(' + ')} · {step.tone} tone
                      </p>
                    </li>
                  ))}
                </ol>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {composerJob && <ReminderComposer job={composerJob} open onClose={() => setComposerJob(null)} />}
    </div>
  );
}
