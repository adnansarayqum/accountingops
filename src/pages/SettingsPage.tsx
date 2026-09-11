import { ShieldCheck, Users } from 'lucide-react';
import { PageHeader } from '../ui/components/PageHeader';
import { Card, CardBody, CardHeader } from '../ui/components/Card';
import { Select } from '../ui/components/Form';
import { Avatar } from '../ui/components/Avatar';
import { useAppStore } from '../application/store';
import { useData } from '../application/selectors';

export function SettingsPage() {
  const data = useData();
  const currentUserId = useAppStore((s) => s.currentUserId);

  return (
    <div className="animate-in max-w-3xl space-y-5">
      <PageHeader title="Settings" description="Practice configuration." />

      <Card>
        <CardHeader title="Practice" icon={<Users />} />
        <CardBody className="pt-0">
          <dl className="grid gap-3 sm:grid-cols-2 text-[13px]">
            <div>
              <dt className="text-xs font-medium text-slate-500">Name</dt>
              <dd className="text-slate-900">{data.practice.name}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-500">Tenant id</dt>
              <dd className="font-mono text-slate-700">{data.practice.id}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-500">Signed in as</dt>
              <dd>
                <Select value={currentUserId} onChange={(e) => useAppStore.setState({ currentUserId: e.target.value })} aria-label="Signed in as" className="mt-1 max-w-xs">
                  {data.users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} — {u.role}
                    </option>
                  ))}
                </Select>
              </dd>
            </div>
          </dl>
          <p className="text-xs font-medium text-slate-500 mt-4 mb-2">Team</p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {data.users.map((u) => (
              <li key={u.id} className="flex items-center gap-2.5 rounded-lg border border-slate-100 px-3 py-2">
                <Avatar user={u} />
                <div>
                  <p className="text-[13px] font-medium text-slate-900">{u.name}</p>
                  <p className="text-xs text-slate-500 capitalize">
                    {u.role} · {u.weeklyCapacityHours}h / week
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Security posture" icon={<ShieldCheck />} />
        <CardBody className="pt-0 text-[13px] text-slate-700 space-y-1.5">
          <p>• Identifiers are masked on screen and every reveal is written to the audit log. This is a UX convenience — production enforces field-level authorisation server-side.</p>
          <p>• Sending and filing are simulated — no message or filing integration is connected yet, so nothing leaves this application.</p>
          <p>• Every record carries a practice id so server-side persistence can enforce tenant isolation from day one.</p>
        </CardBody>
      </Card>
    </div>
  );
}
