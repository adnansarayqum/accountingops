import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight, BellRing, Building2, CalendarClock, CheckCircle2, FileCheck, FileSpreadsheet, Receipt, ShieldAlert, Sparkles, Upload, UserX, Users } from 'lucide-react';
import { KpiCard, ServiceTile, Stat, type KpiTone } from '../ui/components/Kpi';
import { Card, CardBody, CardHeader } from '../ui/components/Card';
import { AttentionTable, CountBadge } from '../ui/components/AttentionTable';
import { DonutChart } from '../ui/components/DonutChart';
import { EmptyState } from '../ui/components/EmptyState';
import { DueBadge } from '../ui/components/Badge';
import { useAppStore } from '../application/store';
import { useData, useDerived, useToday } from '../application/selectors';
import { CORE_TILE_SERVICES, serviceStatuses, workloadSlices, type ServiceStatus } from '../application/dashboardGroups';
import type { ServiceCode } from '../domain/types';
import { formatAgo, formatDate, weekdayName } from '../domain/dates';

/** The line under a service tile: what's overdue, what's due soon, and how much is open in total. */
function serviceTileHint(status: ServiceStatus, dueSoonDays: number): string {
  // A core service with nothing on file is worth saying plainly — it means
  // nobody is tracking that work, not that there's none to do.
  if (status.open === 0) return 'nothing tracked yet';
  if (status.overdue > 0) return `${status.overdue} overdue · ${status.open} open`;
  if (status.dueSoon > 0) return `due within ${dueSoonDays} days · ${status.open} open`;
  if (status.nextDueInDays === null) return `${status.open} open`;
  return `next in ${status.nextDueInDays} day${status.nextDueInDays === 1 ? '' : 's'} · ${status.open} open`;
}

const SERVICE_ICONS: Partial<Record<ServiceCode, typeof Building2>> = {
  annual_accounts: Building2,
  corporation_tax: Receipt,
  vat: FileSpreadsheet,
  payroll: Users,
  confirmation_statement: FileCheck,
  self_assessment: FileSpreadsheet,
};

function greeting(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/**
 * Practice Today. The order down the page is the order the work matters in:
 * the headline numbers, the statutory deadlines behind them, then what needs
 * a decision now, then how the practice is running. Everything above
 * "Operational efficiency" is meant to fit a 1440×900 screen without
 * scrolling, which is why the attention list is a table rather than cards.
 */
export function DashboardPage() {
  const derived = useDerived();
  const data = useData();
  const today = useToday();
  const currentUserId = useAppStore((s) => s.currentUserId);
  const me = data.users.find((u) => u.id === currentUserId);

  const m = derived.metrics;
  const topAttention = derived.attention.slice(0, 5);
  const readyToFile = derived.jobViews.filter((v) => v.job.status === 'ready_to_file');
  const dueSoonDays = derived.thresholds.dueSoonDays;
  // The six core services always get a tile, so "nothing tracked yet" stays visible.
  // Any other service earns one only when it has something overdue or due soon —
  // a second row of zeroes would push the attention list below the fold for no gain.
  const byService = serviceStatuses(derived.jobViews, dueSoonDays, CORE_TILE_SERVICES).filter((s) => CORE_TILE_SERVICES.includes(s.serviceCode) || s.overdue > 0 || s.dueSoon > 0);
  const slices = workloadSlices(derived.jobViews, dueSoonDays);
  // Identity verification is its own axis, not one more reason a job might be flagged — split
  // out here rather than left to compete with (and sometimes lose to) a job's other attention rules.
  const identityDue = derived.attention.filter((a) => a.ruleCode === 'identity_incomplete');
  const waitingClients = new Set(derived.jobViews.filter((v) => v.job.status !== 'filed' && v.job.waitingOn === 'client').map((v) => v.client.id)).size;
  const upcoming = derived.jobViews.filter((v) => v.job.status !== 'filed' && v.daysUntilDue >= 0).slice(0, 5);
  const openJobs = derived.jobViews.filter((v) => v.job.status !== 'filed').length;

  return (
    <div className="animate-in" data-testid="dashboard">
      {/* Greeting */}
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight text-slate-900 leading-tight">
            {greeting(new Date().getHours())}, {me?.name.split(' ')[0] ?? 'there'} <span aria-hidden="true">👋</span>
          </h1>
          <p className="text-[13px] text-slate-500 mt-0.5">Here's what needs your attention today.</p>
        </div>
        <p className="text-[13px] font-medium text-slate-500 tabular">
          {weekdayName(today)}, {formatDate(today, { year: true })}
        </p>
      </div>

      {/* 1 — headline numbers */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-2.5">
        <KpiCard label="Due in 30 days" value={m.dueIn30} hint="Open jobs with a statutory deadline in the next 30 days." to="/jobs?due=30" icon={<CalendarClock />} tone="blue" />
        <KpiCard label="Overdue" value={m.overdue} hint={m.overdue === 0 ? 'Nothing has passed its deadline.' : 'Open jobs past their deadline.'} to="/jobs?due=overdue" icon={<AlertTriangle />} tone={m.overdue > 0 ? 'red' : 'neutral'} emphasis={m.overdue > 0} />
        <KpiCard
          label="Waiting on client"
          value={m.waitingOnClient}
          hint={`${waitingClients} client${waitingClients === 1 ? '' : 's'} are holding up work.`}
          to="/chasing"
          icon={<UserX />}
          tone={m.waitingOnClient > 0 ? 'amber' : 'neutral'}
          // The biggest blocker earns the deeper tint — but not while something is overdue,
          // which outranks it.
          emphasis={m.overdue === 0 && m.waitingOnClient > 0}
        />
        <KpiCard label="Ready to file" value={m.readyToFile} hint="Approved and waiting to be submitted." to="/jobs?status=ready_to_file" icon={<FileCheck />} tone={m.readyToFile > 0 ? 'green' : 'neutral'} />
        <KpiCard label="On time" value={m.onTimePercent === null ? '—' : `${m.onTimePercent}%`} hint={`${m.completedOnTime} of ${m.completedOnTime + m.completedLate} filed jobs were on time.`} icon={<CheckCircle2 />} tone={m.onTimePercent !== null && m.onTimePercent < 80 ? 'amber' : 'violet'} />
      </div>

      {/* 2 — statutory deadlines by service */}
      {byService.length > 0 && (
        <section aria-labelledby="by-service" className="mt-4" data-testid="service-tiles">
          <div className="flex items-end justify-between mb-2">
            <h2 id="by-service" className="text-[15px] font-semibold text-slate-900">
              Key deadlines <span className="font-normal text-slate-400">· overdue, and due within {dueSoonDays} days</span>
            </h2>
            <Link to="/jobs" className="text-xs font-medium text-primary-700 hover:underline">
              View all deadlines
            </Link>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5" data-testid="service-tile-grid">
            {byService.map((status) => {
              const Icon = SERVICE_ICONS[status.serviceCode];
              const tone: KpiTone = status.overdue > 0 ? 'red' : status.dueSoon > 0 ? 'amber' : 'neutral';
              return <ServiceTile key={status.serviceCode} label={status.label} value={status.due} hint={serviceTileHint(status, dueSoonDays)} to={`/jobs?service=${status.serviceCode}`} icon={Icon ? <Icon /> : undefined} tone={tone} />;
            })}
          </div>
        </section>
      )}

      <div className="mt-4 grid gap-4 xl:grid-cols-4">
        <div className="xl:col-span-3 space-y-4 min-w-0">
          {/* 3 — what needs a decision now */}
          <Card>
            <CardHeader
              title={
                <span className="flex items-center gap-2">
                  Needs attention <CountBadge count={derived.attention.length} />
                </span>
              }
              description="Jobs that require your input or are waiting on client records."
              action={
                <Link to="/attention" className="text-[13px] font-medium text-primary-700 hover:underline inline-flex items-center gap-1">
                  View all <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              }
            />
            {topAttention.length === 0 ? (
              <EmptyState icon={<CheckCircle2 />} title="Everything is under control" description="There are no jobs requiring immediate action." compact />
            ) : (
              <div className="pb-1">
                <AttentionTable items={topAttention} derived={derived} />
              </div>
            )}
          </Card>

          {/* Quick actions — every one goes somewhere real */}
          <Card>
            <CardHeader title="Take action" description="Quick routes into the work these numbers point at." />
            <CardBody className="pt-0 flex flex-wrap gap-2">
              <QuickAction to="/chasing" icon={<BellRing />} label="Send client reminders" />
              <QuickAction to={`/jobs?due=${dueSoonDays}`} icon={<CalendarClock />} label="Review upcoming deadlines" />
              <QuickAction to="/inbox" icon={<Upload />} label="Review uploaded documents" />
              <QuickAction to="/ask" icon={<Sparkles />} label="Ask the practice" />
            </CardBody>
          </Card>

          {/* 4 — how the practice is running. Quieter than everything above it. */}
          <Card>
            <CardHeader title="Operational efficiency" description="How smoothly the practice is running — no vanity metrics." />
            <CardBody className="pt-0">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-5">
                <Stat label="Average client wait" value={m.averageClientWaitDays === null ? '—' : `${m.averageClientWaitDays} days`} hint="Mean time jobs have been waiting on clients." />
                <Stat label="Jobs ready to file" value={m.readyToFile} hint="Approved and waiting to be submitted." />
                <Stat label="Reminders this month" value={m.remindersThisMonth} hint="Automated and manual reminders sent this calendar month." />
                <Stat label="Completed on time" value={m.onTimePercent === null ? '—' : `${m.completedOnTime}/${m.completedOnTime + m.completedLate}`} hint="Filed jobs submitted before their deadline." />
                <Stat label="Ready before deadline" value={m.readyBeforeDeadline} hint="Jobs ready to file with time to spare." />
                <Stat label="Jobs with no next action" value={m.jobsWithNoNextAction} hint="Open jobs where nobody knows what happens next. Should be zero." />
              </div>
            </CardBody>
          </Card>
        </div>

        {/* Right rail */}
        <div className="space-y-4 min-w-0">
          <Card data-testid="client-workload">
            <CardHeader title="Client workload" description="Every open job, by what is holding it up." />
            <CardBody className="pt-0 flex items-center gap-3">
              <div className="relative h-[100px] w-[100px] shrink-0">
                {/* The centre is the slice total, not a separate metric: a number here that
                    the legend underneath doesn't add up to reads as a bug, however true it is. */}
                <DonutChart segments={slices} centreValue={openJobs} centreLabel="open jobs" />
                <div className="absolute inset-0 grid place-content-center text-center">
                  <p className="text-[22px] font-bold text-slate-900 tabular leading-none">{openJobs}</p>
                  <p className="text-[10px] text-slate-500 leading-tight mt-0.5">open jobs</p>
                </div>
              </div>
              <ul className="flex-1 min-w-0 space-y-1.5">
                {slices.map((s) => (
                  <li key={s.key} className="flex items-center gap-2 text-[12.5px]">
                    <span className="h-2 w-2 rounded-full shrink-0" style={{ background: s.colour }} aria-hidden="true" />
                    <span className="text-slate-600 leading-tight">{s.label}</span>
                    <span className="ml-auto font-semibold text-slate-900 tabular">{s.value}</span>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>

          <Card data-testid="upcoming-deadlines">
            <CardHeader
              title="Upcoming deadlines"
              description={upcoming.length === 0 ? 'Nothing scheduled ahead.' : 'The next statutory dates, soonest first.'}
              action={
                <Link to="/jobs" className="text-[13px] font-medium text-primary-700 hover:underline">
                  View all
                </Link>
              }
            />
            {upcoming.length > 0 && (
              <CardBody className="pt-0">
                <ul className="divide-y divide-slate-100">
                  {upcoming.map((v) => (
                    <li key={v.job.id}>
                      <Link to={`/jobs/${v.job.id}`} className="py-2 flex items-center justify-between gap-2 group">
                        <span className="min-w-0">
                          <span className="block text-[13px] font-medium text-slate-800 truncate group-hover:text-primary-700">{v.client.name}</span>
                          <span className="block text-[11px] text-slate-500 truncate">{v.job.name}</span>
                        </span>
                        <span className="shrink-0 text-right">
                          <DueBadge days={v.daysUntilDue} />
                          <span className="block text-[10.5px] text-slate-400 tabular mt-0.5">{formatDate(v.job.dueDate, { year: true })}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardBody>
            )}
          </Card>

          {identityDue.length > 0 && (
            <Card data-testid="identity-verification">
              <CardHeader
                title="Identity verification"
                icon={<ShieldAlert />}
                description={`${identityDue.length} confirmation statement${identityDue.length === 1 ? '' : 's'} at risk`}
                action={
                  <Link to="/readiness" className="text-[13px] font-medium text-primary-700 hover:underline">
                    Manage
                  </Link>
                }
              />
              <CardBody className="pt-0">
                <ul className="divide-y divide-slate-100">
                  {identityDue.slice(0, 3).map((a) => {
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
              </CardBody>
            </Card>
          )}

          {readyToFile.length > 0 && (
            <Card data-testid="ready-to-file">
              <CardHeader title="Ready to file" icon={<FileCheck />} description={`${readyToFile.length} approved and ready`} />
              <CardBody className="pt-0">
                <ul className="divide-y divide-slate-100">
                  {readyToFile.slice(0, 4).map((v) => (
                    <li key={v.job.id}>
                      <Link to={`/jobs/${v.job.id}`} className="py-2 flex items-center justify-between gap-2 hover:text-primary-700">
                        <span className="text-[13px] font-medium text-slate-800 truncate">
                          {v.client.name} · {v.job.name}
                        </span>
                        <DueBadge days={v.daysUntilDue} />
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}

          <Card data-testid="recent-activity">
            <CardHeader
              title="Recent activity"
              action={
                <Link to="/activity" className="text-[13px] font-medium text-primary-700 hover:underline">
                  View all
                </Link>
              }
            />
            <CardBody className="pt-0">
              {data.activities.length === 0 ? (
                <p className="text-[13px] text-slate-500">Nothing recorded yet.</p>
              ) : (
                <ul className="space-y-2.5">
                  {data.activities.slice(0, 5).map((a) => (
                    <li key={a.id} className="text-[12.5px] text-slate-700 leading-snug">
                      {a.message}
                      <span className="block text-[10.5px] text-slate-400 mt-0.5">{formatAgo(a.occurredAt, today)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

/** A quick action. Every one is a link to a route that already exists — no dead buttons. */
function QuickAction({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  return (
    <Link to={to} className="inline-flex items-center gap-2 h-9 rounded-lg border border-slate-200 bg-surface px-3 text-[13px] font-medium text-slate-700 hover:border-primary-300 hover:text-primary-700 transition-colors">
      <span className="text-slate-400 [&>svg]:h-4 [&>svg]:w-4">{icon}</span>
      {label}
    </Link>
  );
}
