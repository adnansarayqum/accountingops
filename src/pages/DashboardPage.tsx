import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowRight, CalendarClock, CheckCircle2, Clock, FileCheck, Inbox, ShieldAlert, Sparkles, UserX } from 'lucide-react';
import { PageHeader } from '../ui/components/PageHeader';
import { KpiCard, Stat } from '../ui/components/Kpi';
import { Card, CardBody, CardHeader } from '../ui/components/Card';
import { AttentionCard } from '../ui/components/AttentionCard';
import { EmptyState } from '../ui/components/EmptyState';
import { Badge, DueBadge } from '../ui/components/Badge';
import { Input } from '../ui/components/Form';
import { Button } from '../ui/components/Button';
import { useData, useDerived, useToday } from '../application/selectors';
import { groupDueSoonByService } from '../application/dashboardGroups';
import { EXAMPLE_QUESTIONS } from '../application/assistant/router';
import { formatAgo, formatDate, weekdayName } from '../domain/dates';

export function DashboardPage() {
  const derived = useDerived();
  const data = useData();
  const today = useToday();
  const navigate = useNavigate();
  const [question, setQuestion] = useState('');
  const m = derived.metrics;
  const topAttention = derived.attention.slice(0, 4);
  const readyToFile = derived.jobViews.filter((v) => v.job.status === 'ready_to_file');
  const dueSoonViews = derived.jobViews.filter((v) => v.job.status !== 'filed' && v.daysUntilDue >= 0 && v.daysUntilDue <= 14);
  const dueSoonGroups = groupDueSoonByService(dueSoonViews);
  // Identity verification is its own axis, not one more reason a job might be flagged — split
  // out here rather than left to compete with (and sometimes lose to) a job's other attention rules.
  const identityDue = derived.attention.filter((a) => a.ruleCode === 'identity_incomplete');
  const waitingClients = new Set(derived.jobViews.filter((v) => v.job.status !== 'filed' && v.job.waitingOn === 'client').map((v) => v.client.id)).size;

  return (
    <div className="animate-in">
      <PageHeader eyebrow={`${weekdayName(today)}, ${formatDate(today)}`} title="Practice Today" description="Everything requiring attention across your practice." />

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 [&>*:nth-child(5)]:col-span-2 md:[&>*:nth-child(5)]:col-span-1">
        <KpiCard label="Due in 30 days" value={m.dueIn30} hint="Open jobs with a statutory deadline in the next 30 days." to="/jobs?due=30" icon={<CalendarClock />} tone="blue" />
        <KpiCard label="Overdue" value={m.overdue} hint="Open jobs past their deadline." to="/jobs?due=overdue" icon={<AlertTriangle />} tone={m.overdue > 0 ? 'red' : 'neutral'} />
        <KpiCard label="Waiting on client" value={m.waitingOnClient} hint={`${waitingClients} client${waitingClients === 1 ? '' : 's'} are holding up work.`} to="/chasing" icon={<UserX />} tone={m.waitingOnClient > 0 ? 'amber' : 'neutral'} />
        <KpiCard label="Ready to file" value={m.readyToFile} hint="Approved and waiting to be submitted." to="/jobs?status=ready_to_file" icon={<FileCheck />} tone={m.readyToFile > 0 ? 'green' : 'neutral'} />
        <KpiCard label="On time" value={m.onTimePercent === null ? '—' : `${m.onTimePercent}%`} hint={`${m.completedOnTime} of ${m.completedOnTime + m.completedLate} filed jobs were on time.`} icon={<CheckCircle2 />} tone={m.onTimePercent !== null && m.onTimePercent < 80 ? 'amber' : 'green'} />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-3">
        <div className="xl:col-span-2 space-y-5 min-w-0">
          <section aria-labelledby="needs-attention">
            <div className="flex items-end justify-between mb-2.5">
              <div>
                <h2 id="needs-attention" className="text-base font-semibold text-slate-900">
                  Needs attention
                </h2>
                <p className="text-[13px] text-slate-500">{derived.attention.length === 0 ? 'Nothing is at risk right now.' : `${m.highRisk} at immediate risk · ${derived.attention.length - m.highRisk} to watch`}</p>
              </div>
              <Link to="/attention" className="text-[13px] font-medium text-primary-700 hover:underline inline-flex items-center gap-1">
                View all <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
            {topAttention.length === 0 ? (
              <Card>
                <EmptyState icon={<CheckCircle2 />} title="Everything is under control" description="There are no jobs requiring immediate action." compact />
              </Card>
            ) : (
              <div className="space-y-3">
                {topAttention.map((a) => {
                  const view = derived.jobViewById.get(a.jobId);
                  return view ? <AttentionCard key={a.id} item={a} view={view} compact /> : null;
                })}
              </div>
            )}
          </section>

          <section aria-labelledby="due-soon">
            <div className="flex items-end justify-between mb-2.5">
              <div>
                <h2 id="due-soon" className="text-base font-semibold text-slate-900">
                  Due soon
                </h2>
                <p className="text-[13px] text-slate-500">
                  {dueSoonViews.length === 0 ? 'Nothing due in the next two weeks.' : `${dueSoonViews.length} open job${dueSoonViews.length === 1 ? '' : 's'} due in the next 14 days, split by what they are.`}
                </p>
              </div>
              <Link to="/jobs?due=14" className="text-[13px] font-medium text-primary-700 hover:underline inline-flex items-center gap-1">
                View all <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
            {dueSoonGroups.length === 0 && identityDue.length === 0 ? (
              <Card>
                <EmptyState icon={<Clock />} title="Nothing due soon" description="No open jobs are due in the next two weeks." compact />
              </Card>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {dueSoonGroups.map((group) => (
                  <Card key={group.serviceCode}>
                    <CardHeader title={group.label} description={`${group.views.length} due`} />
                    <CardBody className="pt-0">
                      <ul className="divide-y divide-slate-100">
                        {group.views.slice(0, 4).map((v) => (
                          <li key={v.job.id}>
                            <Link to={`/jobs/${v.job.id}`} className="py-2 flex items-center justify-between gap-2 hover:text-primary-700">
                              <span className="text-[13px] font-medium text-slate-800 truncate">{v.client.name}</span>
                              <DueBadge days={v.daysUntilDue} />
                            </Link>
                          </li>
                        ))}
                      </ul>
                      {group.views.length > 4 && (
                        <Link to={`/jobs?due=14&service=${group.serviceCode}`} className="mt-2 inline-block text-xs font-medium text-primary-700 hover:underline">
                          View all {group.views.length} →
                        </Link>
                      )}
                    </CardBody>
                  </Card>
                ))}
                {identityDue.length > 0 && (
                  <Card>
                    <CardHeader title="Identity verification" icon={<ShieldAlert />} description={`${identityDue.length} confirmation statement${identityDue.length === 1 ? '' : 's'} at risk`} />
                    <CardBody className="pt-0">
                      <ul className="divide-y divide-slate-100">
                        {identityDue.slice(0, 4).map((a) => {
                          const view = derived.jobViewById.get(a.jobId);
                          return view ? (
                            <li key={a.id}>
                              <Link to={`/jobs/${a.jobId}`} className="py-2 flex items-center justify-between gap-2 hover:text-primary-700">
                                <span className="text-[13px] font-medium text-slate-800 truncate">{view.client.name}</span>
                                <DueBadge days={a.daysUntilDue} />
                              </Link>
                            </li>
                          ) : null;
                        })}
                      </ul>
                      <Link to="/readiness" className="mt-2 inline-block text-xs font-medium text-primary-700 hover:underline">
                        Manage in Readiness →
                      </Link>
                    </CardBody>
                  </Card>
                )}
              </div>
            )}
          </section>

          <Card>
            <CardHeader title="Operational efficiency" description="How smoothly the practice is running — no vanity metrics." />
            <CardBody>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-5">
                <Stat label="Completed on time" value={m.onTimePercent === null ? '—' : `${m.completedOnTime}/${m.completedOnTime + m.completedLate}`} hint="Filed jobs submitted before their deadline." />
                <Stat label="Client-blocked jobs" value={m.clientBlocked} hint="Open jobs where the next move is the client's." />
                <Stat label="Average client wait" value={m.averageClientWaitDays === null ? '—' : `${m.averageClientWaitDays} days`} hint="Mean time jobs have been waiting on clients." />
                <Stat label="Reminders this month" value={m.remindersThisMonth} hint="Automated and manual reminders sent this calendar month." />
                <Stat label="Ready before deadline" value={m.readyBeforeDeadline} hint="Jobs ready to file with time to spare." />
                <Stat label="Jobs with no next action" value={m.jobsWithNoNextAction} hint="Open jobs where nobody knows what happens next. Should be zero." />
              </div>
            </CardBody>
          </Card>
        </div>

        <div className="space-y-5 min-w-0">
          <Card>
            <CardHeader title="Ask the practice" icon={<Sparkles />} description="Answers come from your practice data, not guesswork." />
            <CardBody>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (question.trim()) navigate(`/ask?q=${encodeURIComponent(question.trim())}`);
                }}
                className="flex gap-2"
              >
                <Input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Which clients still need chasing this month?" aria-label="Ask a question" />
                <Button type="submit">Ask</Button>
              </form>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {EXAMPLE_QUESTIONS.slice(0, 4).map((q) => (
                  <button key={q} type="button" onClick={() => navigate(`/ask?q=${encodeURIComponent(q)}`)} className="rounded-full border border-slate-200 bg-surface px-2.5 py-1 text-xs text-slate-600 hover:border-primary-300 hover:text-primary-700">
                    {q}
                  </button>
                ))}
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Smart Inbox" icon={<Inbox />} description={derived.pendingInbox === 0 ? 'Inbox cleared.' : `${derived.pendingInbox} document${derived.pendingInbox === 1 ? '' : 's'} waiting for review`} action={<Link to="/inbox" className="text-[13px] font-medium text-primary-700 hover:underline">Open</Link>} />
            <CardBody className="pt-0">
              <ul className="divide-y divide-slate-100">
                {data.inboxItems.filter((i) => i.status === 'pending').slice(0, 3).map((i) => (
                  <li key={i.id} className="py-2 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium text-slate-800 truncate">{i.fileName}</p>
                      <p className="text-xs text-slate-500 truncate">{derived.clientById.get(i.suggestion.clientId ?? '')?.name ?? 'Unknown client'} · {i.suggestion.documentType}</p>
                    </div>
                    <Badge tone={i.suggestion.confidence >= 0.9 ? 'green' : 'amber'}>{Math.round(i.suggestion.confidence * 100)}%</Badge>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Ready to file" icon={<FileCheck />} description={readyToFile.length === 0 ? 'Nothing is waiting to be filed right now.' : `${readyToFile.length} approved and ready`} />
            {readyToFile.length > 0 && (
              <CardBody className="pt-0">
                <ul className="divide-y divide-slate-100">
                  {readyToFile.slice(0, 4).map((v) => (
                    <li key={v.job.id}>
                      <Link to={`/jobs/${v.job.id}`} className="py-2 flex items-center justify-between gap-2 hover:text-primary-700">
                        <span className="text-[13px] font-medium text-slate-800 truncate">{v.client.name} · {v.job.name}</span>
                        <DueBadge days={v.daysUntilDue} />
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardBody>
            )}
          </Card>

          <Card>
            <CardHeader title="Recent activity" action={<Link to="/activity" className="text-[13px] font-medium text-primary-700 hover:underline">All</Link>} />
            <CardBody className="pt-0">
              <ul className="space-y-2.5">
                {data.activities.slice(0, 5).map((a) => (
                  <li key={a.id} className="text-[13px] text-slate-700 leading-snug">
                    {a.message}
                    <span className="block text-[11px] text-slate-400">{formatAgo(a.occurredAt, today)}</span>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
