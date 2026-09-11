import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Search, ChevronRight } from 'lucide-react';
import { PageHeader } from '../ui/components/PageHeader';
import { LinkButton } from '../ui/components/Button';
import { Card } from '../ui/components/Card';
import { Input, Select } from '../ui/components/Form';
import { Avatar } from '../ui/components/Avatar';
import { Badge, DueBadge, ResponsivenessBadge } from '../ui/components/Badge';
import { EmptyState } from '../ui/components/EmptyState';
import { useData, useDerived } from '../application/selectors';
import { CLIENT_TYPE_LABELS, SERVICES } from '../domain/catalog';
import type { ClientType } from '../domain/types';

export function ClientsPage() {
  const data = useData();
  const derived = useDerived();
  const [q, setQ] = useState('');
  const [type, setType] = useState<'all' | ClientType>('all');
  const [owner, setOwner] = useState('all');

  const rows = useMemo(() => {
    const query = q.trim().toLowerCase();
    const compact = query.replace(/\s+/g, '');
    return data.clients
      .filter((c) => (type === 'all' ? true : c.type === type))
      .filter((c) => (owner === 'all' ? true : c.ownerUserId === owner))
      .map((c) => {
        const contact = derived.primaryContactByClient.get(c.id);
        const ids = data.identifiers.filter((i) => i.clientId === c.id);
        const idMatch = compact.length >= 4 ? ids.find((i) => i.value.replace(/\s+/g, '').toLowerCase().includes(compact)) : undefined;
        const matches = !query || c.name.toLowerCase().includes(query) || contact?.name.toLowerCase().includes(query) || contact?.email?.toLowerCase().includes(query) || !!idMatch;
        const openJobs = derived.jobViews.filter((v) => v.client.id === c.id && v.job.status !== 'filed');
        const next = openJobs[0];
        const attention = openJobs.filter((v) => v.attention).length;
        const services = data.subscriptions.filter((s) => s.clientId === c.id && s.active).map((s) => SERVICES[s.serviceCode].shortName);
        return { client: c, contact, matches, idMatch, openJobs, next, attention, services, responsiveness: derived.responsivenessByClient.get(c.id)! };
      })
      .filter((r) => r.matches)
      .sort((a, b) => b.attention - a.attention || a.client.name.localeCompare(b.client.name));
  }, [data, derived, q, type, owner]);

  return (
    <div className="animate-in">
      <PageHeader title="Clients" description={`${data.clients.length} clients · search by name, contact, company number, UTR, VAT or PAYE reference.`} actions={<LinkButton to="/clients/new" variant="primary" icon={<Plus />}>New client</LinkButton>} />
      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search clients… try a company number or UTR" className="pl-9" aria-label="Search clients" data-testid="client-search" />
        </div>
        <Select value={type} onChange={(e) => setType(e.target.value as 'all' | ClientType)} aria-label="Client type" className="sm:w-44">
          <option value="all">All types</option>
          {(Object.keys(CLIENT_TYPE_LABELS) as ClientType[]).map((t) => (
            <option key={t} value={t}>
              {CLIENT_TYPE_LABELS[t]}
            </option>
          ))}
        </Select>
        <Select value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Owner" className="sm:w-44">
          <option value="all">All owners</option>
          {data.users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </Select>
      </div>

      <Card>
        {rows.length === 0 ? (
          <EmptyState title="No clients match" description="Try a different name, or search by company number, UTR, VAT or PAYE reference." />
        ) : (
          <>
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs font-medium text-slate-500 border-b border-slate-100">
                    <th className="py-2 pl-5 pr-3 font-medium">Client</th>
                    <th className="py-2 px-3 font-medium">Services</th>
                    <th className="py-2 px-3 font-medium">Open jobs</th>
                    <th className="py-2 px-3 font-medium">Next deadline</th>
                    <th className="py-2 px-3 font-medium">Responsiveness</th>
                    <th className="py-2 px-3 font-medium">Owner</th>
                    <th className="py-2 pr-4" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((r) => (
                    <tr key={r.client.id} className="group hover:bg-slate-50/80">
                      <td className="py-2.5 pl-5 pr-3">
                        <Link to={`/clients/${r.client.id}`} className="block">
                          <p className="font-medium text-slate-900 group-hover:text-primary-700 flex items-center gap-2">
                            {r.client.name}
                            {r.client.lifecycle === 'onboarding' && <Badge tone="violet">Onboarding</Badge>}
                            {r.attention > 0 && <Badge tone="red" dot>{r.attention} flagged</Badge>}
                          </p>
                          <p className="text-xs text-slate-500">
                            {CLIENT_TYPE_LABELS[r.client.type]} · {r.contact?.name}
                            {r.idMatch && <span className="ml-2 text-primary-700">matched {r.idMatch.kind.replace(/_/g, ' ')}</span>}
                          </p>
                        </Link>
                      </td>
                      <td className="px-3 text-[13px] text-slate-600">{r.services.join(' · ') || '—'}</td>
                      <td className="px-3 tabular text-slate-700">{r.openJobs.length}</td>
                      <td className="px-3 whitespace-nowrap">{r.next ? <DueBadge days={r.next.daysUntilDue} /> : <span className="text-xs text-slate-400">—</span>}</td>
                      <td className="px-3">
                        <ResponsivenessBadge band={r.responsiveness.band} />
                      </td>
                      <td className="px-3">
                        <span className="inline-flex items-center gap-2 text-[13px] text-slate-700">
                          <Avatar user={derived.userById.get(r.client.ownerUserId)} size="sm" /> {derived.userById.get(r.client.ownerUserId)?.name.split(' ')[0]}
                        </span>
                      </td>
                      <td className="pr-4 text-right">
                        <Link to={`/clients/${r.client.id}`} aria-label={`Open ${r.client.name}`} className="text-slate-300 group-hover:text-primary-600">
                          <ChevronRight className="h-4 w-4 inline" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="md:hidden divide-y divide-slate-100">
              {rows.map((r) => (
                <li key={r.client.id}>
                  <Link to={`/clients/${r.client.id}`} className="block px-4 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium text-slate-900 truncate">{r.client.name}</p>
                        <p className="text-xs text-slate-500">{CLIENT_TYPE_LABELS[r.client.type]} · {r.contact?.name}</p>
                      </div>
                      {r.next && <DueBadge days={r.next.daysUntilDue} />}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <ResponsivenessBadge band={r.responsiveness.band} />
                      {r.attention > 0 && <Badge tone="red" dot>{r.attention} flagged</Badge>}
                      <span className="text-xs text-slate-500">{r.openJobs.length} open jobs</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </div>
  );
}
