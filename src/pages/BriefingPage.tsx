import { Link } from 'react-router-dom';
import { AlertTriangle, CalendarClock, UserX, FileCheck, MessageSquareOff, ListChecks } from 'lucide-react';
import { PageHeader } from '../ui/components/PageHeader';
import { Card, CardBody, CardHeader } from '../ui/components/Card';
import { Badge } from '../ui/components/Badge';
import { useDerived, useToday, useData } from '../application/selectors';
import { formatDate, weekdayName, daysSince } from '../domain/dates';
import { cn } from '../ui/cn';

export function BriefingPage() {
  const derived = useDerived();
  const data = useData();
  const today = useToday();
  const open = derived.jobViews.filter((v) => v.job.status !== 'filed');
  const urgent = derived.attention.filter((a) => a.severity === 'red');
  const dueThisWeek = open.filter((v) => v.daysUntilDue >= 0 && v.daysUntilDue <= 7);
  const waitingClients = new Set(open.filter((v) => v.job.waitingOn === 'client').map((v) => v.client.id));
  const ready = open.filter((v) => v.job.status === 'ready_to_file');
  const noResponse = data.clients.filter((c) => {
    const p = derived.responsivenessByClient.get(c.id)!;
    if (!p.lastOutbound || p.lastOutbound.responseStatus !== 'awaiting') return false;
    const inboundAfter = p.lastInbound && p.lastInbound.sentAt > p.lastOutbound.sentAt;
    return !inboundAfter && daysSince(p.lastOutbound.sentAt, today) >= 5;
  });

  // Priorities: top attention items, then unassigned/stale
  const seenClients = new Set<string>();
  const priorities = derived.attention.filter((a) => (seenClients.has(a.clientId) ? false : (seenClients.add(a.clientId), true))).slice(0, 6).map((a) => {
    const v = derived.jobViewById.get(a.jobId)!;
    const verb = a.recommendedAction.kind === 'send_reminder' ? (v.client.averageResponseDays > 10 ? 'Call' : 'Chase') : a.recommendedAction.kind === 'chase_approval' ? 'Chase approval from' : a.recommendedAction.kind === 'assign_reviewer' ? 'Assign reviewer for' : a.recommendedAction.kind === 'verify_identity' ? 'Complete ID checks for' : a.recommendedAction.kind === 'file' ? 'File' : 'Review';
    return { id: a.id, text: `${verb} ${v.client.name} — ${v.job.name}`, why: a.reasons[0], to: `/jobs/${v.job.id}`, severity: a.severity };
  });
  const unassigned = open.filter((v) => !v.job.assigneeUserId && v.daysUntilDue <= 60);
  for (const v of unassigned.slice(0, 2)) priorities.push({ id: v.job.id, text: `Assign ${v.client.name} — ${v.job.name}`, why: 'Nobody owns this job yet.', to: `/jobs/${v.job.id}`, severity: 'amber' });

  return (
    <div className="animate-in max-w-4xl">
      <PageHeader eyebrow={formatDate(today)} title={`${weekdayName(today)} Briefing`} description="Your practice has already been analysed. Here's what matters before you start." />
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 [&>*:nth-child(5)]:col-span-2 md:[&>*:nth-child(5)]:col-span-1">
        <Brief icon={<AlertTriangle />} label="Urgent" value={urgent.length} detail={`job${urgent.length === 1 ? '' : 's'} at immediate risk`} tone={urgent.length ? 'red' : 'neutral'} to="/attention?f=red" />
        <Brief icon={<CalendarClock />} label="Due this week" value={dueThisWeek.length} detail="jobs" tone="blue" to="/jobs?due=7" />
        <Brief icon={<UserX />} label="Waiting on clients" value={waitingClients.size} detail="clients" tone="amber" to="/chasing" />
        <Brief icon={<FileCheck />} label="Ready to file" value={ready.length} detail="jobs" tone="green" to="/jobs?status=ready_to_file" />
        <Brief icon={<MessageSquareOff />} label="No response" value={noResponse.length} detail="clients silent 5+ days" tone={noResponse.length ? 'amber' : 'neutral'} to="/chasing" />
      </div>

      <Card className="mt-5">
        <CardHeader title="Recommended priorities" icon={<ListChecks />} description="Ranked by severity, deadline and how long things have been stuck." />
        <CardBody className="pt-0">
          <ol className="divide-y divide-slate-100">
            {priorities.length === 0 && <li className="py-4 text-sm text-slate-500">Nothing pressing. A good day to get ahead on next month's work.</li>}
            {priorities.map((p, i) => (
              <li key={p.id} className="py-3 flex gap-3">
                <span className={cn('h-6 w-6 rounded-full text-xs font-bold flex items-center justify-center shrink-0', p.severity === 'red' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800')}>{i + 1}</span>
                <div className="min-w-0">
                  <Link to={p.to} className="text-sm font-medium text-slate-900 hover:text-primary-700">
                    {p.text}
                  </Link>
                  <p className="text-xs text-slate-500">{p.why}</p>
                </div>
              </li>
            ))}
          </ol>
        </CardBody>
      </Card>

      <div className="mt-5 grid gap-5 md:grid-cols-2">
        <Card>
          <CardHeader title="Due this week" />
          <CardBody className="pt-0">
            <ul className="divide-y divide-slate-100">
              {dueThisWeek.length === 0 && <li className="py-2 text-sm text-slate-500">Nothing due this week.</li>}
              {dueThisWeek.map((v) => (
                <li key={v.job.id} className="py-2 flex items-center justify-between gap-2">
                  <Link to={`/jobs/${v.job.id}`} className="text-[13px] text-slate-800 hover:text-primary-700 truncate">
                    {v.client.name} · {v.job.name}
                  </Link>
                  <Badge tone={v.daysUntilDue <= 2 ? 'red' : 'amber'}>{v.daysUntilDue === 0 ? 'Today' : `${v.daysUntilDue}d`}</Badge>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Clients who haven't replied" description="Reminder sent, nothing back for 5+ days." />
          <CardBody className="pt-0">
            <ul className="divide-y divide-slate-100">
              {noResponse.length === 0 && <li className="py-2 text-sm text-slate-500">Everyone we've chased has come back to us.</li>}
              {noResponse.map((c) => {
                const p = derived.responsivenessByClient.get(c.id)!;
                return (
                  <li key={c.id} className="py-2 flex items-center justify-between gap-2">
                    <Link to={`/clients/${c.id}`} className="text-[13px] text-slate-800 hover:text-primary-700">
                      {c.name}
                    </Link>
                    <span className="text-xs text-slate-500 tabular">{daysSince(p.lastOutbound!.sentAt, today)} days silent</span>
                  </li>
                );
              })}
            </ul>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function Brief({ icon, label, value, detail, tone, to }: { icon: React.ReactNode; label: string; value: number; detail: string; tone: 'red' | 'amber' | 'green' | 'blue' | 'neutral'; to: string }) {
  const colour = { red: 'text-red-600', amber: 'text-amber-600', green: 'text-emerald-600', blue: 'text-primary-600', neutral: 'text-slate-900' }[tone];
  return (
    <Link to={to} className="card card-hover px-4 py-3.5">
      <div className="flex items-center gap-2 text-slate-500 [&>svg]:h-4 [&>svg]:w-4">
        {icon}
        <span className="text-[13px] font-medium">{label}</span>
      </div>
      <p className={cn('mt-1.5 text-2xl font-bold tabular', colour)}>{value}</p>
      <p className="text-xs text-slate-500">{detail}</p>
    </Link>
  );
}
