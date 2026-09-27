import { Link } from 'react-router-dom';
import { CheckCircle2, Circle, UserPlus, ArrowRight } from 'lucide-react';
import { PageHeader } from '../ui/components/PageHeader';
import { Card, CardBody, CardHeader } from '../ui/components/Card';
import { ProgressBar } from '../ui/components/ProgressBar';
import { Button, LinkButton } from '../ui/components/Button';
import { EmptyState } from '../ui/components/EmptyState';
import { Avatar } from '../ui/components/Avatar';
import { useAppStore } from '../application/store';
import { useData, useDerived, useToday } from '../application/selectors';
import { ONBOARDING_STAGES } from '../domain/catalog';
import { formatAgo } from '../domain/dates';
import { cn } from '../ui/cn';

export function OnboardingPage() {
  const data = useData();
  const derived = useDerived();
  const today = useToday();
  const timeZone = data.practice.timezone;
  const toggle = useAppStore((s) => s.toggleOnboardingItem);
  const setStage = useAppStore((s) => s.setOnboardingStage);
  const toast = useAppStore((s) => s.toast);
  const cases = data.onboardingCases.filter((c) => c.stage !== 'active');

  return (
    <div className="animate-in">
      <PageHeader title="Onboarding" description="Lightweight checklist from lead to active client." actions={<LinkButton to="/clients/new" variant="primary" icon={<UserPlus />}>New client</LinkButton>} />
      {cases.length === 0 ? (
        <Card>
          <EmptyState icon={<UserPlus />} title="No clients are being onboarded" description="New clients will appear here with their checklist." />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {cases.map((oc) => {
            const client = derived.clientById.get(oc.clientId);
            if (!client) return null;
            const done = oc.checklist.filter((i) => i.done).length;
            const pct = Math.round((done / oc.checklist.length) * 100);
            const stageIndex = ONBOARDING_STAGES.findIndex((s) => s.key === oc.stage);
            const nextStage = ONBOARDING_STAGES[stageIndex + 1];
            const stageItems = oc.checklist.filter((i) => i.stage === oc.stage);
            const stageDone = stageItems.every((i) => i.done);
            return (
              <Card key={oc.id}>
                <CardHeader
                  title={
                    <Link to={`/clients/${client.id}`} className="hover:text-primary-700">
                      {client.name}
                    </Link>
                  }
                  description={
                    <span className="flex items-center gap-2">
                      <Avatar user={derived.userById.get(client.ownerUserId)} size="xs" /> {derived.userById.get(client.ownerUserId)?.name} · started {formatAgo(oc.startedAt, today, timeZone)}
                    </span>
                  }
                  action={<span className="text-lg font-bold tabular text-slate-900">{pct}%</span>}
                />
                <CardBody>
                  <ProgressBar value={pct} />
                  <ol className="mt-4 flex items-center gap-1 overflow-x-auto scrollbar-thin pb-1">
                    {ONBOARDING_STAGES.map((s, i) => (
                      <li key={s.key} className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => setStage(oc.id, s.key)}
                          className={cn('rounded-md px-2 py-1 text-[11px] font-medium whitespace-nowrap', i < stageIndex ? 'bg-emerald-50 text-emerald-700' : i === stageIndex ? 'bg-primary-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200')}
                          aria-current={i === stageIndex ? 'step' : undefined}
                        >
                          {s.label}
                        </button>
                        {i < ONBOARDING_STAGES.length - 1 && <ArrowRight className="h-3 w-3 text-slate-300" />}
                      </li>
                    ))}
                  </ol>
                  <ul className="mt-4 divide-y divide-slate-100">
                    {oc.checklist.map((item) => (
                      <li key={item.key}>
                        <button type="button" onClick={() => toggle(oc.id, item.key)} className="w-full flex items-center gap-3 py-2 text-left hover:bg-slate-50 rounded-md px-1" aria-pressed={item.done}>
                          {item.done ? <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" /> : <Circle className={cn('h-4 w-4 shrink-0', item.stage === oc.stage ? 'text-primary-400' : 'text-slate-300')} />}
                          <span className={cn('text-sm flex-1', item.done ? 'text-slate-500 line-through decoration-slate-300' : 'text-slate-800')}>{item.label}</span>
                          <span className="text-[11px] text-slate-400">{ONBOARDING_STAGES.find((s) => s.key === item.stage)?.label}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  {nextStage && (
                    <div className="mt-3 flex items-center justify-between gap-3">
                      <p className="text-xs text-slate-500">{stageDone ? `Everything for ${ONBOARDING_STAGES[stageIndex].label} is done.` : `${stageItems.filter((i) => !i.done).length} item${stageItems.filter((i) => !i.done).length === 1 ? '' : 's'} left in this stage.`}</p>
                      <Button size="sm" variant={stageDone ? 'primary' : 'secondary'} iconRight={<ArrowRight />} onClick={() => { setStage(oc.id, nextStage.key); toast({ title: `${client.name} moved to ${nextStage.label}`, tone: 'success' }); }}>
                        Move to {nextStage.label}
                      </Button>
                    </div>
                  )}
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
