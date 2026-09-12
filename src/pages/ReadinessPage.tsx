import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, ShieldCheck, ShieldAlert, ShieldQuestion } from 'lucide-react';
import { PageHeader } from '../ui/components/PageHeader';
import { Card, CardBody, CardHeader } from '../ui/components/Card';
import { Tabs } from '../ui/components/Tabs';
import { Badge } from '../ui/components/Badge';
import { Select } from '../ui/components/Form';
import { useAppStore } from '../application/store';
import { useData, useDerived } from '../application/selectors';
import { describeCompaniesHouseVerification, evaluateIdentityReadiness, evaluateMtd, groupRolesByPerson } from '../domain/rules';
import { normaliseCompanyNumber } from '../domain/companyNumber';
import { formatDate } from '../domain/dates';
import type { IdentityVerificationStatus, MtdStatus } from '../domain/types';
import { cn } from '../ui/cn';

const MTD_LABEL: Record<MtdStatus, string> = { ready: 'Ready', action_needed: 'Action needed', not_yet_required: 'Not yet required', review: 'Review' };
const MTD_TONE: Record<MtdStatus, 'green' | 'red' | 'neutral' | 'amber'> = { ready: 'green', action_needed: 'red', not_yet_required: 'neutral', review: 'amber' };
const BAND_LABEL = { under_20k: 'Under £20k', '20k_30k': '£20k–£30k', '30k_50k': '£30k–£50k', over_50k: 'Over £50k' };

export function ReadinessPage() {
  const data = useData();
  const derived = useDerived();
  const update = useAppStore((s) => s.updatePersonRoleVerification);
  const toast = useAppStore((s) => s.toast);
  const [tab, setTab] = useState<'mtd' | 'identity'>('identity');

  const mtdRows = data.mtdReadiness.map((r) => ({ r, client: derived.clientById.get(r.clientId)!, ev: evaluateMtd(r) })).filter((x) => x.client);
  const identityRows = data.clients.filter((c) => c.type === 'limited_company').map((c) => evaluateIdentityReadiness(c, data.personRoles, data.people)).filter((x) => x.total > 0).sort((a, b) => Number(a.status === 'ready') - Number(b.status === 'ready'));
  const companyNumberOf = (clientId: string) => {
    const stored = data.identifiers.find((i) => i.clientId === clientId && i.kind === 'company_number')?.value;
    return stored ? normaliseCompanyNumber(stored) : undefined;
  };

  return (
    <div className="animate-in">
      <PageHeader title="Readiness" description="Regulatory changes that need action before deadlines: MTD for Income Tax and Companies House identity verification." />
      <Tabs
        value={tab}
        onChange={setTab}
        className="mb-4"
        options={[
          { value: 'identity', label: 'Companies House identity', count: identityRows.filter((r) => r.status !== 'ready').length },
          { value: 'mtd', label: 'MTD Income Tax', count: mtdRows.filter((r) => r.ev.status === 'action_needed' || r.ev.status === 'review').length },
        ]}
      />

      {tab === 'identity' && (
        <div className="grid gap-4 lg:grid-cols-2">
          {identityRows.map((row) => (
            <Card key={row.client.id} className={cn(row.confirmationStatementBlocked && 'border-amber-200')}>
              <CardHeader
                title={
                  <Link to={`/clients/${row.client.id}`} className="hover:text-primary-700">
                    {row.client.name}
                  </Link>
                }
                description={`${row.verified} of ${row.total} verified`}
                action={<Badge tone={row.status === 'ready' ? 'green' : row.status === 'in_progress' ? 'amber' : 'red'} dot>{row.status === 'ready' ? 'Ready' : row.status === 'in_progress' ? 'In progress' : 'Blocked'}</Badge>}
              />
              <CardBody className="pt-0">
                {row.confirmationStatementBlocked && <p className="mb-2 text-xs text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/30 rounded-md px-2.5 py-1.5">Confirmation statement cannot be filed until every director and PSC is verified.</p>}
                {companyNumberOf(row.client.id) && (
                  <a
                    href={`https://find-and-update.company-information.service.gov.uk/company/${companyNumberOf(row.client.id)}/officers`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mb-2 inline-flex items-center gap-1 text-xs font-medium text-primary-700 hover:underline"
                    data-testid={`check-on-companies-house-${row.client.id}`}
                  >
                    Check on Companies House <ExternalLink className="h-3 w-3" aria-hidden="true" />
                  </a>
                )}
                <ul className="divide-y divide-slate-100">
                  {groupRolesByPerson(row.roles).map(({ person, roles: personRoles }) => (
                    <li key={person.id} className="py-2">
                      <p className="text-[13px] font-medium text-slate-900">{person.fullName}</p>
                      <div className="mt-1.5 space-y-2">
                        {personRoles.map((role) => {
                          const Icon = role.identityVerification === 'verified' ? ShieldCheck : role.identityVerification === 'in_progress' ? ShieldQuestion : ShieldAlert;
                          const kindLabel = role.kind === 'psc' ? 'PSC' : role.kind.charAt(0).toUpperCase() + role.kind.slice(1);
                          return (
                            <div key={role.id} className="flex flex-wrap items-center gap-3">
                              <Icon className={cn('h-4 w-4 shrink-0', role.identityVerification === 'verified' ? 'text-emerald-500' : role.identityVerification === 'in_progress' ? 'text-amber-500' : 'text-red-500')} />
                              <div className="min-w-0 flex-1">
                                <p className="text-xs text-slate-500">
                                  {kindLabel} · personal code {role.personalCodeCaptured ? 'captured' : 'not captured'} · evidence {role.evidenceStatus}
                                </p>
                                {role.identityVerification === 'verified' && role.identityVerificationSource === 'companies_house' ? (
                                  <p className="text-xs text-emerald-700" data-testid={`verified-by-companies-house-${role.id}`}>
                                    Confirmed by Companies House{role.identityVerifiedOn ? ` · ${formatDate(role.identityVerifiedOn)}` : ''}
                                  </p>
                                ) : (
                                  describeCompaniesHouseVerification(role) && (
                                    <p className={cn('text-xs', role.companiesHouseVerification?.verifiedOn ? 'text-emerald-700' : role.companiesHouseVerification?.dueOn ? 'text-amber-700' : 'text-slate-400')} data-testid={`companies-house-verification-${role.id}`}>
                                      {describeCompaniesHouseVerification(role)}
                                    </p>
                                  )
                                )}
                              </div>
                              <Select
                                value={role.identityVerification}
                                onChange={(e) => {
                                  update(role.id, e.target.value as IdentityVerificationStatus);
                                  toast({ title: 'Verification updated', description: `${person.fullName} (${kindLabel}): ${e.target.value.replace(/_/g, ' ')}`, tone: 'success' });
                                }}
                                aria-label={`${kindLabel} verification status for ${person.fullName}`}
                                className="w-40"
                              >
                                <option value="not_started">Not started</option>
                                <option value="in_progress">In progress</option>
                                <option value="verified">Verified</option>
                                <option value="expired">Expired</option>
                              </Select>
                            </div>
                          );
                        })}
                      </div>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {tab === 'mtd' && (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-medium text-slate-500 border-b border-slate-100">
                  <th className="py-2 pl-5 pr-3 font-medium">Client</th>
                  <th className="py-2 px-3 font-medium">Income band</th>
                  <th className="py-2 px-3 font-medium">Start year</th>
                  <th className="py-2 px-3 font-medium">Signed up</th>
                  <th className="py-2 px-3 font-medium">Software</th>
                  <th className="py-2 px-3 font-medium">Agent auth</th>
                  <th className="py-2 px-3 font-medium">Basis</th>
                  <th className="py-2 px-3 font-medium">Next quarterly</th>
                  <th className="py-2 px-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {mtdRows.map(({ r, client, ev }) => (
                  <tr key={r.id} className="hover:bg-slate-50/80">
                    <td className="py-2.5 pl-5 pr-3">
                      <Link to={`/clients/${client.id}`} className="font-medium text-slate-900 hover:text-primary-700">
                        {client.name}
                      </Link>
                      <p className="text-xs text-slate-500">{ev.reasons[0]}</p>
                    </td>
                    <td className="px-3 text-slate-700">{BAND_LABEL[r.incomeBand]}</td>
                    <td className="px-3 text-slate-700 tabular">{r.startYear}</td>
                    <td className="px-3">{yesNo(r.signedUp)}</td>
                    <td className="px-3">{yesNo(r.softwareReady)}</td>
                    <td className="px-3">{yesNo(r.agentAuthorised)}</td>
                    <td className="px-3 text-slate-700 capitalize">{r.accountingBasis}</td>
                    <td className="px-3 text-slate-700 tabular whitespace-nowrap">{r.nextQuarterlyDue ? formatDate(r.nextQuarterlyDue) : '—'}</td>
                    <td className="px-3">
                      <Badge tone={MTD_TONE[ev.status]} dot>
                        {MTD_LABEL[ev.status]}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function yesNo(v: boolean) {
  return <span className={cn('text-xs font-medium', v ? 'text-emerald-600' : 'text-red-600')}>{v ? 'Yes' : 'No'}</span>;
}
