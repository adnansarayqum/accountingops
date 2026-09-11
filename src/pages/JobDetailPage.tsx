import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Send, Play, ArrowRight, CheckCircle2, FileCheck, PauseCircle, PlayCircle, Mail, MessageCircle, MessageSquare, Phone, Globe, ArrowUpRight, ArrowDownLeft, ClipboardCheck, Landmark } from 'lucide-react';
import { PageHeader } from '../ui/components/PageHeader';
import { Card, CardBody, CardHeader } from '../ui/components/Card';
import { Badge, DueBadge, SeverityBadge, StatusBadge, WaitingOnBadge } from '../ui/components/Badge';
import { Avatar } from '../ui/components/Avatar';
import { Button } from '../ui/components/Button';
import { Select, Field, Input } from '../ui/components/Form';
import { Modal } from '../ui/components/Modal';
import { DocumentChecklist } from '../ui/components/DocumentChecklist';
import { ReminderComposer } from '../ui/components/ReminderComposer';
import { NotFoundPage } from './NotFoundPage';
import { useAppStore } from '../application/store';
import { useData, useDerived, useToday } from '../application/selectors';
import { CHANNEL_LABELS, JOB_STATUS_LABELS, JOB_STATUS_ORDER, SERVICES, WAITING_ON_LABELS, FILING_DESTINATION } from '../domain/catalog';
import { formatDate, formatDateTime, daysSince } from '../domain/dates';
import { ALLOWED_TRANSITIONS, primaryActionLabel, primaryActionTarget } from '../domain/rules';
import type { WaitingOn } from '../domain/types';
import { cn } from '../ui/cn';

export function JobDetailPage() {
  const { jobId } = useParams();
  const data = useData();
  const derived = useDerived();
  const today = useToday();
  const store = useAppStore();
  const [composer, setComposer] = useState(false);
  const [approvalModal, setApprovalModal] = useState<'internal' | 'client' | null>(null);
  const [reviewerName, setReviewerName] = useState('');
  const [note, setNote] = useState('');

  const view = derived.jobViewById.get(jobId ?? '');
  if (!view) return <NotFoundPage />;
  const { job, client, completeness, chasing, nextAction, attention } = view;
  const items = data.requestItems.filter((i) => i.jobId === job.id);
  const comms = data.communications.filter((c) => c.jobId === job.id).sort((a, b) => b.sentAt.localeCompare(a.sentAt));
  const activities = data.activities.filter((a) => a.jobId === job.id);
  const approvals = data.approvals.filter((a) => a.jobId === job.id);
  const filing = data.filings.find((f) => f.jobId === job.id);
  const contact = derived.primaryContactByClient.get(client.id);
  const target = primaryActionTarget(job.status);
  const primaryLabel = primaryActionLabel(job.status);
  const stale = daysSince(job.statusChangedAt, today);
  const ChannelIcon = { email: Mail, whatsapp: MessageCircle, sms: MessageSquare, phone: Phone, portal: Globe };

  const doPrimary = () => {
    try {
      if (job.status === 'ready_to_file') {
        const r = store.fileJob(job.id);
        store.toast({ title: 'Job marked as filed', description: r.nextJob ? `Simulated submission recorded. Next job created: ${r.nextJob.name}.` : 'Simulated submission recorded.', tone: 'success' });
        return;
      }
      if (job.status === 'internal_review') {
        setReviewerName(derived.userById.get(store.currentUserId)?.name ?? '');
        setApprovalModal('internal');
        return;
      }
      if (job.status === 'waiting_client_approval') {
        setReviewerName(contact?.name ?? '');
        setApprovalModal('client');
        return;
      }
      if (target) {
        store.transitionJob(job.id, target);
        store.toast({ title: `Marked as ${JOB_STATUS_LABELS[target].toLowerCase()}`, tone: 'success' });
      }
    } catch (err) {
      store.toast({ title: "Couldn't update the job", description: (err as Error).message, tone: 'error' });
    }
  };

  const recordApproval = (decision: 'approved' | 'rejected') => {
    if (!approvalModal) return;
    store.recordApproval(job.id, approvalModal, decision, reviewerName || 'Unknown', note || undefined);
    store.toast({ title: decision === 'approved' ? 'Approval recorded' : 'Sent back for changes', description: approvalModal === 'client' && decision === 'approved' ? `${client.name} ${job.name} is now ready to file.` : undefined, tone: 'success' });
    setApprovalModal(null);
    setNote('');
  };

  return (
    <div className="animate-in">
      <PageHeader
        eyebrow={
          <span>
            <Link to="/jobs" className="hover:underline">
              Jobs
            </Link>{' '}
            /{' '}
            <Link to={`/clients/${client.id}`} className="hover:underline">
              {client.name}
            </Link>
          </span>
        }
        title={job.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={job.status} />
            <WaitingOnBadge waitingOn={job.waitingOn} />
            {job.status !== 'filed' && <DueBadge days={view.daysUntilDue} />}
            <span className="text-slate-500">Due {formatDate(job.dueDate)}</span>
          </span>
        }
        actions={
          <>
            {chasing.required && (
              <Button icon={<Send />} onClick={() => setComposer(true)} data-testid="job-send-reminder">
                {chasing.kind === 'approval' ? 'Chase approval' : 'Send reminder'}
              </Button>
            )}
            {primaryLabel && (
              <Button variant={chasing.required ? 'secondary' : 'primary'} icon={job.status === 'ready_to_file' ? <FileCheck /> : job.status === 'ready_to_start' ? <Play /> : <ArrowRight />} onClick={doPrimary} data-testid="job-primary-action">
                {primaryLabel}
              </Button>
            )}
          </>
        }
      />

      {attention && (
        <div className={cn('card border-l-4 mb-5 px-5 py-3.5', attention.severity === 'red' ? 'border-l-red-500' : 'border-l-amber-500')}>
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <SeverityBadge severity={attention.severity} />
            <p className="text-sm font-semibold text-slate-900">{attention.headline}</p>
          </div>
          <ul className="text-[13px] text-slate-700 space-y-0.5">
            {attention.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      )}

      {job.status === 'filed' && filing && (
        <div className="card border-l-4 border-l-emerald-500 mb-5 px-5 py-3.5 flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px]">
          <span className="inline-flex items-center gap-2 font-semibold text-emerald-700">
            <CheckCircle2 className="h-4 w-4" /> Filed with {filing.destination}
          </span>
          <span className="text-slate-600">
            {formatDateTime(filing.filedAt)} by {derived.userById.get(filing.filedByUserId)?.name}
          </span>
          <span className="text-slate-600 font-mono">Ref {filing.submissionReference}</span>
          <Badge tone="amber">Simulated submission — nothing was sent to {filing.destination}</Badge>
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="xl:col-span-2 space-y-5 min-w-0">
          <Card>
            <CardHeader
              title="Documents"
              description={completeness.complete ? 'Everything received. No further client chasing required.' : `${completeness.missing.length} still needed from the client.`}
              action={
                chasing.required ? (
                  <Badge tone="amber" dot>
                    Chasing active
                  </Badge>
                ) : job.chasingPaused ? (
                  <Badge tone="neutral">Chasing paused</Badge>
                ) : (
                  <Badge tone="green" dot>
                    No chasing needed
                  </Badge>
                )
              }
            />
            <CardBody>
              <DocumentChecklist job={job} items={items} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Approvals & filing" description="Explicit checkpoints. Filing is simulated in this demo." />
            <CardBody className="pt-0">
              <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Checkpoint label="Internal approval" done={approvals.some((a) => a.kind === 'internal' && a.status === 'approved')} pending={job.status === 'internal_review'} detail={approvalDetail(approvals.find((a) => a.kind === 'internal'))} icon={<ClipboardCheck />} />
                <Checkpoint label="Client approval" done={approvals.some((a) => a.kind === 'client' && a.status === 'approved')} pending={job.status === 'waiting_client_approval'} detail={approvalDetail(approvals.find((a) => a.kind === 'client'))} icon={<CheckCircle2 />} />
                <Checkpoint label="Ready to file" done={job.status === 'ready_to_file' || job.status === 'filed'} pending={false} detail={job.status === 'ready_to_file' ? 'Awaiting submission' : undefined} icon={<FileCheck />} />
                <Checkpoint label={`Filed (${FILING_DESTINATION[job.serviceCode] ?? 'HMRC'})`} done={job.status === 'filed'} pending={false} detail={filing ? `${formatDate(filing.filedAt)} · ${filing.submissionReference}` : undefined} icon={<Landmark />} />
              </ol>
              {job.status === 'internal_review' && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" onClick={doPrimary}>
                    Approve internally
                  </Button>
                  {!job.reviewerUserId && <span className="text-xs text-amber-700 self-center">No reviewer assigned yet.</span>}
                </div>
              )}
              {job.status === 'in_progress' && (
                <div className="mt-3">
                  <Button size="sm" variant="secondary" onClick={() => { store.transitionJob(job.id, 'waiting_client_approval'); store.toast({ title: 'Sent to client for approval', tone: 'success' }); }}>
                    Skip review — send to client for approval
                  </Button>
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Communications" description={`${comms.length} on this job`} action={chasing.required ? <Button size="sm" variant="secondary" icon={<Send />} onClick={() => setComposer(true)}>Send reminder</Button> : undefined} />
            <CardBody className="pt-0">
              {comms.length === 0 ? (
                <p className="text-sm text-slate-500 py-2">No messages on this job yet.</p>
              ) : (
                <ul className="divide-y divide-slate-100" data-testid="job-comms">
                  {comms.map((c) => {
                    const Icon = ChannelIcon[c.channel];
                    return (
                      <li key={c.id} className="py-3 flex gap-3">
                        <span className={cn('h-8 w-8 rounded-lg flex items-center justify-center shrink-0', c.direction === 'outbound' ? 'bg-primary-50 text-primary-700' : 'bg-emerald-50 text-emerald-700')}>
                          <Icon className="h-4 w-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                            <span className="inline-flex items-center gap-1 font-medium text-slate-700">
                              {c.direction === 'outbound' ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownLeft className="h-3 w-3" />}
                              {c.direction === 'outbound' ? `Sent to ${c.recipient}` : `Received`} · {CHANNEL_LABELS[c.channel]}
                            </span>
                            <span>{formatDateTime(c.sentAt)}</span>
                            {c.reminderStage && <Badge tone="blue">{c.reminderStage}</Badge>}
                            {c.direction === 'outbound' && c.reminderStage && <Badge tone={c.responseStatus === 'responded' ? 'green' : 'amber'}>{c.responseStatus === 'responded' ? 'Responded' : 'Awaiting reply'}</Badge>}
                          </div>
                          {c.subject && <p className="text-[13px] font-medium text-slate-900 mt-1">{c.subject}</p>}
                          <p className="text-[13px] text-slate-700 mt-0.5 whitespace-pre-line">{c.body}</p>
                          {c.documentsRequested && c.documentsRequested.length > 0 && <p className="text-xs text-slate-500 mt-1">Requested: {c.documentsRequested.join(', ')}</p>}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="space-y-5 min-w-0">
          <Card>
            <CardHeader title="Next action" />
            <CardBody className="pt-0">
              <p className="text-sm font-semibold text-primary-700">{nextAction.label}</p>
              {nextAction.detail && <p className="text-xs text-slate-500 mt-0.5">{nextAction.detail}</p>}
              <dl className="mt-3 space-y-2 text-[13px]">
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Chasing</dt>
                  <dd className="text-right text-slate-800">{chasing.reason}</dd>
                </div>
                {chasing.nextStep && chasing.required && (
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">Next in sequence</dt>
                    <dd className="text-right text-slate-800">
                      {chasing.nextStep.label}
                      {chasing.overdueStep && <span className="ml-1 text-amber-700">(due now)</span>}
                    </dd>
                  </div>
                )}
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Reminders sent</dt>
                  <dd className="tabular text-slate-800">{chasing.remindersSent}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">In this state for</dt>
                  <dd className={cn('tabular', stale >= 14 ? 'text-amber-700 font-medium' : 'text-slate-800')}>{stale} day{stale === 1 ? '' : 's'}</dd>
                </div>
              </dl>
              {job.status !== 'filed' && (job.status === 'waiting_for_records' || job.status === 'waiting_client_approval') && (
                <button type="button" onClick={() => store.setChasingPaused(job.id, !job.chasingPaused)} className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900">
                  {job.chasingPaused ? <PlayCircle className="h-3.5 w-3.5" /> : <PauseCircle className="h-3.5 w-3.5" />}
                  {job.chasingPaused ? 'Resume automatic chasing' : 'Pause automatic chasing'}
                </button>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Details" />
            <CardBody className="pt-0">
              <dl className="space-y-3 text-[13px]">
                <div>
                  <dt className="text-xs font-medium text-slate-500">Client</dt>
                  <dd>
                    <Link to={`/clients/${client.id}`} className="font-medium text-slate-900 hover:text-primary-700">
                      {client.name}
                    </Link>
                    <span className="block text-xs text-slate-500">{contact?.name} · prefers {CHANNEL_LABELS[client.preferredChannel]}</span>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-slate-500">Service</dt>
                  <dd className="text-slate-800">{SERVICES[job.serviceCode].name}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-slate-500">Period</dt>
                  <dd className="text-slate-800 tabular">
                    {formatDate(job.periodStart)} – {formatDate(job.periodEnd)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-slate-500">Estimated effort</dt>
                  <dd className="text-slate-800 tabular">{job.estimatedHours} hours</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-slate-500 mb-1">Assigned to</dt>
                  <dd className="flex items-center gap-2">
                    <Avatar user={view.assignee} size="sm" />
                    <Select value={job.assigneeUserId ?? ''} onChange={(e) => { store.reassignJob(job.id, e.target.value || undefined); store.toast({ title: 'Job reassigned', tone: 'success' }); }} aria-label="Assignee" disabled={job.status === 'filed'}>
                      <option value="">Unassigned</option>
                      {data.users.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                    </Select>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-slate-500 mb-1">Reviewer</dt>
                  <dd className="flex items-center gap-2">
                    <Avatar user={view.reviewer} size="sm" />
                    <Select value={job.reviewerUserId ?? ''} onChange={(e) => { store.assignReviewer(job.id, e.target.value || undefined); store.toast({ title: e.target.value ? 'Reviewer assigned' : 'Reviewer removed', tone: 'success' }); }} aria-label="Reviewer" disabled={job.status === 'filed'}>
                      <option value="">No reviewer</option>
                      {data.users.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                    </Select>
                  </dd>
                </div>
                {job.status !== 'filed' && (
                  <>
                    <div>
                      <dt className="text-xs font-medium text-slate-500 mb-1">Waiting on</dt>
                      <dd>
                        <Select value={job.waitingOn} onChange={(e) => store.setWaitingOn(job.id, e.target.value as WaitingOn)} aria-label="Waiting on">
                          {(Object.keys(WAITING_ON_LABELS) as WaitingOn[]).map((w) => (
                            <option key={w} value={w}>
                              {WAITING_ON_LABELS[w]}
                            </option>
                          ))}
                        </Select>
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium text-slate-500 mb-1">Move to</dt>
                      <dd>
                        <Select
                          value=""
                          onChange={(e) => {
                            if (!e.target.value) return;
                            try {
                              store.transitionJob(job.id, e.target.value as typeof job.status);
                              store.toast({ title: `Marked as ${JOB_STATUS_LABELS[e.target.value as typeof job.status].toLowerCase()}`, tone: 'success' });
                            } catch (err) {
                              store.toast({ title: "Couldn't change status", description: (err as Error).message, tone: 'error' });
                            }
                          }}
                          aria-label="Change status"
                        >
                          <option value="">Choose a status…</option>
                          {JOB_STATUS_ORDER.filter((s) => ALLOWED_TRANSITIONS[job.status].includes(s) && s !== 'filed').map((s) => (
                            <option key={s} value={s}>
                              {JOB_STATUS_LABELS[s]}
                            </option>
                          ))}
                        </Select>
                      </dd>
                    </div>
                  </>
                )}
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Activity" />
            <CardBody className="pt-0">
              <ul className="space-y-2.5">
                {activities.slice(0, 8).map((a) => (
                  <li key={a.id} className="text-[13px] text-slate-700 leading-snug">
                    {a.message}
                    <span className="block text-[11px] text-slate-400">{formatDateTime(a.occurredAt)}</span>
                  </li>
                ))}
                {activities.length === 0 && <li className="text-sm text-slate-500">No activity yet.</li>}
              </ul>
            </CardBody>
          </Card>
        </div>
      </div>

      {composer && <ReminderComposer job={job} open onClose={() => setComposer(false)} />}

      <Modal
        open={approvalModal !== null}
        onClose={() => setApprovalModal(null)}
        title={approvalModal === 'internal' ? 'Record internal approval' : 'Record client approval'}
        description={`${client.name} · ${job.name}`}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => recordApproval('rejected')}>
              Needs changes
            </Button>
            <Button variant="success" icon={<CheckCircle2 />} onClick={() => recordApproval('approved')} data-testid="confirm-approval">
              Record approval
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label={approvalModal === 'internal' ? 'Reviewer' : 'Approved by'} htmlFor="approval-name">
            <Input id="approval-name" value={reviewerName} onChange={(e) => setReviewerName(e.target.value)} />
          </Field>
          <Field label="Note (optional)" htmlFor="approval-note">
            <Input id="approval-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder={approvalModal === 'client' ? 'e.g. Approved by email' : 'e.g. Checked against prior year'} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}

function approvalDetail(a?: { status: string; decidedAt?: string; reviewerName?: string; requestedAt: string }): string | undefined {
  if (!a) return undefined;
  if (a.status === 'approved') return `${a.reviewerName ?? ''} · ${formatDate(a.decidedAt)}`;
  if (a.status === 'rejected') return `Changes requested · ${formatDate(a.decidedAt)}`;
  return `Requested ${formatDate(a.requestedAt)}`;
}

function Checkpoint({ label, done, pending, detail, icon }: { label: string; done: boolean; pending: boolean; detail?: string; icon: React.ReactNode }) {
  return (
    <li className={cn('rounded-lg border px-3 py-2.5', done ? 'border-emerald-200 dark:border-emerald-500/30 bg-emerald-50/50 dark:bg-emerald-500/10' : pending ? 'border-amber-200 dark:border-amber-500/30 bg-amber-50/50 dark:bg-amber-500/10' : 'border-slate-200 bg-surface')}>
      <div className={cn('flex items-center gap-2 text-[13px] font-medium [&>svg]:h-4 [&>svg]:w-4', done ? 'text-emerald-700' : pending ? 'text-amber-700' : 'text-slate-500')}>
        {icon}
        {label}
      </div>
      <p className="text-xs text-slate-500 mt-1">{detail ?? (done ? 'Done' : pending ? 'In progress' : 'Not yet')}</p>
    </li>
  );
}
