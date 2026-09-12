import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Mail, MessageCircle, MessageSquare, Phone, Globe, Send, ArrowUpRight, ArrowDownLeft, ShieldCheck, ShieldAlert, ShieldQuestion, Pencil, Check, X, RefreshCw } from 'lucide-react';
import { PageHeader } from '../ui/components/PageHeader';
import { Card, CardBody, CardHeader } from '../ui/components/Card';
import { Badge, DueBadge, ResponsivenessBadge, StatusBadge, WaitingOnBadge } from '../ui/components/Badge';
import { Avatar } from '../ui/components/Avatar';
import { MaskedValue } from '../ui/components/Masked';
import { JobList } from '../ui/components/JobList';
import { DocumentChecklist } from '../ui/components/DocumentChecklist';
import { Button } from '../ui/components/Button';
import { ReminderComposer } from '../ui/components/ReminderComposer';
import { Tabs } from '../ui/components/Tabs';
import { Input, Select } from '../ui/components/Form';
import { NotFoundPage } from './NotFoundPage';
import { useAppStore } from '../application/store';
import { useData, useDerived, useToday } from '../application/selectors';
import { CHANNEL_LABELS, CLIENT_TYPE_LABELS, IDENTIFIER_LABELS, SERVICES } from '../domain/catalog';
import { formatAgo, formatDate, formatDateTime, formatSince } from '../domain/dates';
import { normaliseCompanyNumber } from '../domain/companyNumber';
import { normalisePersonName } from '../domain/personNames';
import type { Channel, IdentifierKind, Job } from '../domain/types';
import { cn } from '../ui/cn';
import { ContactsCard } from '../ui/components/ContactsCard';
import { getCompaniesHouseStatus, getCompanyPeople, getCompanyProfile } from '../integrations/companiesHouse';

const ID_ORDER: IdentifierKind[] = ['utr', 'nino', 'company_number', 'vat_number', 'paye_reference', 'accounts_office_ref', 'ch_auth_code', 'personal_code', 'gateway_credentials'];

export function ClientDetailPage() {
  const { clientId } = useParams();
  const data = useData();
  const derived = useDerived();
  const today = useToday();
  const updateClient = useAppStore((s) => s.updateClient);
  const updateIdentifier = useAppStore((s) => s.updateIdentifier);
  const refreshClientFromCompaniesHouse = useAppStore((s) => s.refreshClientFromCompaniesHouse);
  const toast = useAppStore((s) => s.toast);
  const [composerJob, setComposerJob] = useState<Job | null>(null);
  const [tab, setTab] = useState<'overview' | 'requests' | 'comms' | 'activity'>('overview');
  const [editing, setEditing] = useState(false);
  const [editingId, setEditingId] = useState<IdentifierKind | null>(null);
  const [idValue, setIdValue] = useState('');
  const [refreshingCh, setRefreshingCh] = useState(false);

  const client = derived.clientById.get(clientId ?? '');
  const views = useMemo(() => derived.jobViews.filter((v) => v.client.id === clientId), [derived, clientId]);
  if (!client) return <NotFoundPage />;

  const contact = derived.primaryContactByClient.get(client.id);
  const owner = derived.userById.get(client.ownerUserId);
  const backup = client.backupOwnerUserId ? derived.userById.get(client.backupOwnerUserId) : undefined;
  const identifiers = data.identifiers.filter((i) => i.clientId === client.id).sort((a, b) => ID_ORDER.indexOf(a.kind) - ID_ORDER.indexOf(b.kind));
  const services = data.subscriptions.filter((s) => s.clientId === client.id && s.active);
  const openViews = views.filter((v) => v.job.status !== 'filed');
  const filedViews = views.filter((v) => v.job.status === 'filed');
  const comms = data.communications.filter((c) => c.clientId === client.id).sort((a, b) => b.sentAt.localeCompare(a.sentAt));
  const activities = data.activities.filter((a) => a.clientId === client.id);
  const responsiveness = derived.responsivenessByClient.get(client.id)!;
  const roles = data.personRoles.filter((r) => r.clientId === client.id);
  const requestViews = openViews.filter((v) => v.completeness.total > 0);
  const chaseView = openViews.find((v) => v.chasing.required);
  const nextDeadline = openViews[0];
  const blocked = openViews.filter((v) => v.job.waitingOn === 'client');
  const missingAll = openViews.flatMap((v) => v.completeness.missing.map((m) => `${m.label} (${v.job.name})`));
  const nextAction = openViews.find((v) => v.attention)?.attention?.recommendedAction.label ?? openViews[0]?.nextAction.label ?? 'Nothing outstanding';
  const applicableIds: IdentifierKind[] =
    client.type === 'limited_company'
      ? ['utr', 'company_number', 'vat_number', 'paye_reference', 'accounts_office_ref', 'ch_auth_code', 'personal_code', 'gateway_credentials']
      : ['utr', 'nino', 'vat_number', 'paye_reference', 'personal_code', 'gateway_credentials'];
  const storedCompanyNumber = identifiers.find((i) => i.kind === 'company_number')?.value;
  // Looked up in the canonical spelling: a number stored before leading zeros
  // were preserved ("8654123") would otherwise get a 404 from the register.
  const companyNumber = storedCompanyNumber ? normaliseCompanyNumber(storedCompanyNumber) : undefined;

  const refreshFromCompaniesHouse = async () => {
    if (!companyNumber) return;
    setRefreshingCh(true);
    try {
      const status = await getCompaniesHouseStatus();
      if (!status.configured) {
        toast({ title: 'No live Companies House data', description: 'No API key is configured — see docs/INTEGRATIONS.md.', tone: 'error' });
        return;
      }
      const [profile, people] = await Promise.all([getCompanyProfile(companyNumber), getCompanyPeople(companyNumber)]);
      if (!profile || profile.source !== 'companies_house') {
        toast({ title: "Couldn't refresh", description: 'The Companies House lookup failed for this company number.', tone: 'error' });
        return;
      }
      const { peopleAdded } = refreshClientFromCompaniesHouse(client.id, profile, people);
      toast({
        title: 'Refreshed from Companies House',
        description: peopleAdded > 0 ? `${peopleAdded} new ${peopleAdded === 1 ? 'person' : 'people'} added.` : 'Company details are up to date.',
        tone: 'success',
      });
    } finally {
      setRefreshingCh(false);
    }
  };

  const ChannelIcon = { email: Mail, whatsapp: MessageCircle, sms: MessageSquare, phone: Phone, portal: Globe };

  const saveIdentifier = () => {
    if (!editingId) return;
    const value = idValue.replace(/\s/g, '').toUpperCase();
    if (!value) return;
    updateIdentifier(client.id, editingId, value);
    toast({ title: 'Client updated', description: `${IDENTIFIER_LABELS[editingId]} saved.`, tone: 'success' });
    setEditingId(null);
  };

  return (
    <div className="animate-in">
      <PageHeader
        eyebrow={
          <Link to="/clients" className="hover:underline">
            Clients
          </Link>
        }
        title={client.name}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{CLIENT_TYPE_LABELS[client.type]}</span>
            {client.sector && <span>· {client.sector}</span>}
            {client.yearEnd && <span>· Year end {client.yearEnd}</span>}
          </span>
        }
        actions={
          <>
            {chaseView && (
              <Button icon={<Send />} onClick={() => setComposerJob(chaseView.job)} data-testid="client-send-reminder">
                Send reminder
              </Button>
            )}
            <Button variant="secondary" icon={<Pencil />} onClick={() => setEditing((e) => !e)}>
              {editing ? 'Done' : 'Edit'}
            </Button>
          </>
        }
      />

      {/* Header strip */}
      <Card className="mb-5">
        <CardBody className="pt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-xs font-medium text-slate-500">Primary contact</p>
            <p className="text-sm font-semibold text-slate-900 mt-0.5">{contact?.name}</p>
            <p className="text-xs text-slate-500">{contact?.role}</p>
            <div className="mt-1.5 flex flex-col gap-0.5 text-[13px]">
              {contact?.email && (
                <a href={`mailto:${contact.email}`} className="text-slate-700 hover:text-primary-700 inline-flex items-center gap-1.5 truncate">
                  <Mail className="h-3.5 w-3.5 text-slate-400" /> {contact.email}
                </a>
              )}
              {contact?.phone && (
                <span className="text-slate-700 inline-flex items-center gap-1.5">
                  <Phone className="h-3.5 w-3.5 text-slate-400" /> {contact.phone}
                </span>
              )}
            </div>
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500">Owner</p>
            {editing ? (
              <Select value={client.ownerUserId} onChange={(e) => updateClient(client.id, { ownerUserId: e.target.value })} className="mt-1" aria-label="Owner">
                {data.users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
            ) : (
              <p className="text-sm font-semibold text-slate-900 mt-0.5 flex items-center gap-2">
                <Avatar user={owner} size="sm" /> {owner?.name}
              </p>
            )}
            <p className="text-xs font-medium text-slate-500 mt-2">Backup</p>
            {editing ? (
              <Select value={client.backupOwnerUserId ?? ''} onChange={(e) => updateClient(client.id, { backupOwnerUserId: e.target.value || undefined })} className="mt-1" aria-label="Backup owner">
                <option value="">None</option>
                {data.users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
            ) : (
              <p className="text-[13px] text-slate-700 mt-0.5 flex items-center gap-2">
                <Avatar user={backup} size="xs" /> {backup?.name ?? 'Not set'}
              </p>
            )}
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500">Responsiveness</p>
            <div className="mt-1">
              <ResponsivenessBadge band={responsiveness.band} />
            </div>
            <p className="text-xs text-slate-600 mt-1.5">
              Average response <span className="font-semibold tabular">{responsiveness.averageResponseDays} days</span> · {responsiveness.remindersSent} reminder{responsiveness.remindersSent === 1 ? '' : 's'} sent
            </p>
            <p className="text-xs text-slate-600 mt-0.5">
              Preferred:{' '}
              {editing ? (
                <Select value={client.preferredChannel} onChange={(e) => updateClient(client.id, { preferredChannel: e.target.value as Channel })} className="mt-1" aria-label="Preferred channel">
                  {(['email', 'whatsapp', 'sms', 'phone'] as Channel[]).map((c) => (
                    <option key={c} value={c}>
                      {CHANNEL_LABELS[c]}
                    </option>
                  ))}
                </Select>
              ) : (
                <span className="font-medium text-slate-800">{CHANNEL_LABELS[client.preferredChannel]}</span>
              )}
            </p>
            {responsiveness.suggestion && <p className="text-xs text-amber-700 mt-1">Suggested: {responsiveness.suggestion}</p>}
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500">Services</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {services.map((s) => (
                <Badge key={s.id} tone="blue">
                  {SERVICES[s.serviceCode].name}
                </Badge>
              ))}
            </div>
            {client.lifecycle === 'onboarding' && (
              <Link to="/onboarding" className="mt-2 inline-block text-xs font-medium text-violet-700 hover:underline">
                Onboarding in progress →
              </Link>
            )}
          </div>
        </CardBody>
      </Card>

      <Tabs
        value={tab}
        onChange={setTab}
        className="mb-4"
        options={[
          { value: 'overview', label: 'Overview' },
          { value: 'requests', label: 'Information requests', count: missingAll.length },
          { value: 'comms', label: 'Communications', count: comms.length },
          { value: 'activity', label: 'Activity', count: activities.length },
        ]}
      />

      {tab === 'overview' && (
        <div className="grid gap-5 xl:grid-cols-3">
          <Card className="xl:col-span-3">
            <CardHeader title="Open jobs" description="Status and who we're waiting on are tracked separately." />
            <JobList views={openViews} showClient={false} emptyTitle="No open jobs" emptyDescription="Recurring obligations will create the next job automatically." />
          </Card>
          <div className="xl:col-span-2 space-y-5 min-w-0">
            <Card>
              <CardHeader title="Upcoming obligations" description="Deadlines across every service, soonest first." />
              <CardBody className="pt-0">
                <ol className="relative border-l border-slate-200 ml-2 space-y-4 py-1">
                  {openViews.slice(0, 8).map((v) => (
                    <li key={v.job.id} className="pl-5 relative">
                      <span className={cn('absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-white', v.daysUntilDue < 0 ? 'bg-red-500' : v.daysUntilDue <= 14 ? 'bg-amber-500' : 'bg-primary-500')} />
                      <div className="flex flex-wrap items-center gap-2">
                        <Link to={`/jobs/${v.job.id}`} className="text-sm font-medium text-slate-900 hover:text-primary-700">
                          {v.job.name}
                        </Link>
                        <DueBadge days={v.daysUntilDue} />
                        <span className="text-xs text-slate-500 tabular">{formatDate(v.job.dueDate)}</span>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {SERVICES[v.job.serviceCode].name} · period ending {formatDate(v.job.periodEnd)}
                      </p>
                    </li>
                  ))}
                  {openViews.length === 0 && <li className="pl-5 text-sm text-slate-500">No upcoming obligations.</li>}
                </ol>
              </CardBody>
            </Card>

            {filedViews.length > 0 && (
              <Card>
                <CardHeader title="Filed" description={`${filedViews.length} completed job${filedViews.length === 1 ? '' : 's'}`} />
                <JobList views={filedViews.slice(0, 5)} showClient={false} dense />
              </Card>
            )}
          </div>

          <div className="space-y-5 min-w-0">
            <Card>
              <CardHeader title="Handover" description="Everything a colleague needs to pick this client up." />
              <CardBody className="pt-0">
                <dl className="space-y-2.5 text-[13px]">
                  <HandoverRow label="Next deadline" value={nextDeadline ? `${nextDeadline.job.name} — ${formatDate(nextDeadline.job.dueDate)}` : 'None'} />
                  <HandoverRow label="Current blocker" value={blocked.length ? `Waiting on client for ${blocked.map((b) => b.job.name).join(', ')}` : openViews.some((v) => v.job.waitingOn === 'senior_review') ? 'Waiting on senior review' : 'None — work is with us'} tone={blocked.length ? 'amber' : undefined} />
                  <HandoverRow label="Last client contact" value={responsiveness.lastInbound ? `${formatAgo(responsiveness.lastInbound.sentAt, today)} (${CHANNEL_LABELS[responsiveness.lastInbound.channel]})` : responsiveness.lastOutbound ? `We last wrote ${formatAgo(responsiveness.lastOutbound.sentAt, today)} — no reply yet` : 'No recorded contact'} />
                  <HandoverRow label="Missing information" value={missingAll.length ? missingAll.join('; ') : 'Nothing outstanding'} tone={missingAll.length ? 'amber' : 'green'} />
                  <HandoverRow label="Next recommended action" value={nextAction} tone="blue" />
                </dl>
                {client.notes && (
                  <div className="mt-3 rounded-lg bg-amber-50/60 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/30 px-3 py-2 text-[13px] text-slate-700">
                    <span className="font-medium text-slate-800">Notes: </span>
                    {client.notes}
                  </div>
                )}
              </CardBody>
            </Card>

            {companyNumber && (
              <Card>
                <CardHeader
                  title="Companies House"
                  description={
                    <>
                      {client.incorporatedOn ? `Incorporated ${formatDate(client.incorporatedOn)} · ` : ''}
                      {client.companiesHouseSyncedAt ? (
                        <span title={formatDateTime(client.companiesHouseSyncedAt)}>Synced {formatSince(client.companiesHouseSyncedAt)}</span>
                      ) : (
                        <span className="text-amber-700">Never synced</span>
                      )}
                    </>
                  }
                  action={
                    <div className="flex items-center gap-2">
                      {client.companiesHouseStatus && <Badge tone={client.companiesHouseStatus === 'active' ? 'green' : 'amber'}>{client.companiesHouseStatus}</Badge>}
                      <Button variant="secondary" size="sm" icon={<RefreshCw className={cn('h-3.5 w-3.5', refreshingCh && 'animate-spin')} />} onClick={refreshFromCompaniesHouse} disabled={refreshingCh} data-testid="refresh-companies-house">
                        {refreshingCh ? 'Refreshing…' : 'Refresh'}
                      </Button>
                    </div>
                  }
                />
                <CardBody className="pt-0 text-[13px] text-slate-700 space-y-2">
                  {client.registeredOffice ? (
                    <div>
                      <p className="text-xs font-medium text-slate-500">Registered office</p>
                      <p>{client.registeredOffice.formatted}</p>
                    </div>
                  ) : (
                    <p className="text-slate-500">No Companies House data yet — click Refresh to pull it in.</p>
                  )}
                  {client.sicCodes && client.sicCodes.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-slate-500">SIC codes</p>
                      <p>{client.sicCodes.join(', ')}</p>
                    </div>
                  )}
                  {client.previousNames && client.previousNames.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-slate-500">Previously traded as</p>
                      <p>{client.previousNames.join(', ')}</p>
                    </div>
                  )}
                </CardBody>
              </Card>
            )}

            <Card>
              <CardHeader title="Identifiers" description="Masked by default. Reveals are recorded in the audit log." />
              <CardBody className="pt-0">
                <dl className="divide-y divide-slate-100">
                  {applicableIds.map((kind) => {
                    const rec = identifiers.find((i) => i.kind === kind);
                    return (
                      <div key={kind} className="flex items-center justify-between gap-3 py-2">
                        <dt className="text-[13px] text-slate-500 min-w-0">{IDENTIFIER_LABELS[kind]}</dt>
                        <dd className="flex items-center gap-2 shrink-0">
                          {editingId === kind ? (
                            <form
                              className="flex items-center gap-1"
                              onSubmit={(e) => {
                                e.preventDefault();
                                saveIdentifier();
                              }}
                            >
                              <Input autoFocus value={idValue} onChange={(e) => setIdValue(e.target.value)} className="h-8 w-40 font-mono text-[13px]" aria-label={IDENTIFIER_LABELS[kind]} />
                              <Button size="sm" type="submit" variant="ghost" icon={<Check />} aria-label="Save" />
                              <Button size="sm" type="button" variant="ghost" icon={<X />} aria-label="Cancel" onClick={() => setEditingId(null)} />
                            </form>
                          ) : rec ? (
                            <MaskedValue value={rec.value} kind={kind} clientId={client.id} />
                          ) : (
                            <span className="text-xs text-slate-400 whitespace-nowrap">Not on file</span>
                          )}
                          {editing && editingId !== kind && (
                            <button
                              type="button"
                              className="text-xs font-medium text-primary-700 hover:underline"
                              onClick={() => {
                                setEditingId(kind);
                                setIdValue(rec?.value ?? '');
                              }}
                            >
                              {rec ? 'Edit' : 'Add'}
                            </button>
                          )}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              </CardBody>
            </Card>

            {roles.length > 0 && (
              <Card>
                <CardHeader title="Directors & PSCs" description="Identity verification status for Companies House." />
                <CardBody className="pt-0">
                  <ul className="divide-y divide-slate-100">
                    {roles.map((r) => {
                      const person = data.people.find((p) => p.id === r.personId);
                      const Icon = r.identityVerification === 'verified' ? ShieldCheck : r.identityVerification === 'in_progress' ? ShieldQuestion : ShieldAlert;
                      return (
                        <li key={r.id} className="py-2 flex items-center gap-3">
                          <Icon className={cn('h-4 w-4', r.identityVerification === 'verified' ? 'text-emerald-500' : r.identityVerification === 'in_progress' ? 'text-amber-500' : 'text-red-500')} />
                          <div className="min-w-0 flex-1">
                            <p className="text-[13px] font-medium text-slate-900">{person ? normalisePersonName(person.fullName) : ''}</p>
                            <p className="text-xs text-slate-500 capitalize">{r.kind === 'psc' ? 'PSC' : r.kind}</p>
                            {r.naturesOfControl && r.naturesOfControl.length > 0 && <p className="text-xs text-slate-400">{r.naturesOfControl.join(', ')}</p>}
                          </div>
                          <Badge tone={r.identityVerification === 'verified' ? 'green' : r.identityVerification === 'in_progress' ? 'amber' : 'red'}>{r.identityVerification.replace(/_/g, ' ')}</Badge>
                        </li>
                      );
                    })}
                  </ul>
                  <Link to="/readiness" className="mt-2 inline-block text-xs font-medium text-primary-700 hover:underline">
                    Manage in Readiness →
                  </Link>
                </CardBody>
              </Card>
            )}

            <ContactsCard clientId={client.id} />
          </div>
        </div>
      )}

      {tab === 'requests' && (
        <div className="grid gap-5 lg:grid-cols-2">
          {requestViews.length === 0 && (
            <Card className="lg:col-span-2">
              <CardBody className="pt-5 text-sm text-slate-500">No open information requests.</CardBody>
            </Card>
          )}
          {requestViews.map((v) => (
            <Card key={v.job.id}>
              <CardHeader
                title={
                  <Link to={`/jobs/${v.job.id}`} className="hover:text-primary-700">
                    {v.job.name}
                  </Link>
                }
                description={
                  <span className="flex items-center gap-2 flex-wrap">
                    <StatusBadge status={v.job.status} /> <WaitingOnBadge waitingOn={v.job.waitingOn} />
                  </span>
                }
                action={v.chasing.required ? <Button size="sm" icon={<Send />} onClick={() => setComposerJob(v.job)}>Send reminder</Button> : <Badge tone="green">No chasing needed</Badge>}
              />
              <CardBody>
                <DocumentChecklist job={v.job} items={data.requestItems.filter((i) => i.jobId === v.job.id)} compact />
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {tab === 'comms' && (
        <Card>
          <CardHeader title="Communications" description="Email, WhatsApp and SMS history, with how each one left." />
          <CardBody className="pt-0">
            {comms.length === 0 ? (
              <p className="text-sm text-slate-500 py-3">No communications recorded yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100" data-testid="comms-timeline">
                {comms.map((c) => {
                  const Icon = ChannelIcon[c.channel];
                  const job = c.jobId ? data.jobs.find((j) => j.id === c.jobId) : undefined;
                  return (
                    <li key={c.id} className="py-3 flex gap-3">
                      <span className={cn('h-8 w-8 rounded-lg flex items-center justify-center shrink-0', c.direction === 'outbound' ? 'bg-primary-50 text-primary-700' : 'bg-emerald-50 text-emerald-700')}>
                        <Icon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                          <span className="inline-flex items-center gap-1 font-medium text-slate-700">
                            {c.direction === 'outbound' ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownLeft className="h-3 w-3" />}
                            {c.direction === 'outbound' ? 'Sent' : 'Received'} · {CHANNEL_LABELS[c.channel]}
                          </span>
                          <span>{formatDateTime(c.sentAt)}</span>
                          {job && <span>· {job.name}</span>}
                          {c.reminderStage && <Badge tone="blue">{c.reminderStage}</Badge>}
                          {c.direction === 'outbound' && c.reminderStage && <Badge tone={c.responseStatus === 'responded' ? 'green' : 'amber'}>{c.responseStatus === 'responded' ? 'Responded' : 'Awaiting reply'}</Badge>}
                          {c.direction === 'outbound' && <span className="text-slate-400">{deliveryLabel(c)}</span>}
                        </div>
                        {c.subject && <p className="text-[13px] font-medium text-slate-900 mt-1">{c.subject}</p>}
                        <p className="text-[13px] text-slate-700 mt-0.5 whitespace-pre-line">{c.body}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardBody>
        </Card>
      )}

      {tab === 'activity' && (
        <Card>
          <CardHeader title="Activity" description="Operational events for this client." />
          <CardBody className="pt-0">
            <ul className="divide-y divide-slate-100">
              {activities.map((a) => (
                <li key={a.id} className="py-2.5">
                  <p className="text-[13px] text-slate-800">{a.message}</p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {formatDateTime(a.occurredAt)}
                    {a.actorUserId && ` · ${derived.userById.get(a.actorUserId)?.name}`}
                  </p>
                </li>
              ))}
              {activities.length === 0 && <li className="py-3 text-sm text-slate-500">No activity yet.</li>}
            </ul>
          </CardBody>
        </Card>
      )}

      {composerJob && <ReminderComposer job={composerJob} open onClose={() => setComposerJob(null)} />}
    </div>
  );
}

function HandoverRow({ label, value, tone }: { label: string; value: string; tone?: 'amber' | 'green' | 'blue' }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className={cn('mt-0.5 text-slate-800', tone === 'amber' && 'text-amber-800', tone === 'green' && 'text-emerald-700', tone === 'blue' && 'text-primary-700 font-medium')}>{value}</dd>
    </div>
  );
}

/** How an outbound message left — older records without a delivery status were all simulated. */
function deliveryLabel(c: { simulated: boolean; deliveryStatus?: 'sent' | 'handed_off' | 'simulated'; providerName?: string }): string {
  const status = c.deliveryStatus ?? (c.simulated ? 'simulated' : 'sent');
  if (status === 'handed_off') return 'opened in WhatsApp';
  if (status === 'sent') return c.providerName ? `sent via ${c.providerName}` : 'sent';
  return 'simulated';
}
