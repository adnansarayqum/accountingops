import { useState } from 'react';
import { KeyRound, LogOut, ShieldCheck, Users } from 'lucide-react';
import { PageHeader } from '../ui/components/PageHeader';
import { Card, CardBody, CardHeader } from '../ui/components/Card';
import { Button } from '../ui/components/Button';
import { Field, Input, Select } from '../ui/components/Form';
import { Avatar } from '../ui/components/Avatar';
import { useAppStore } from '../application/store';
import { useData } from '../application/selectors';
import { changePassword, logout } from '../application/auth';

export function SettingsPage() {
  const data = useData();
  const currentUserId = useAppStore((s) => s.currentUserId);
  const authMode = useAppStore((s) => s.authMode);
  const authUser = useAppStore((s) => s.authUser);

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
                {authMode === 'server' && authUser ? (
                  <span className="mt-1 inline-flex items-center gap-2 text-[13px] text-slate-900">
                    <Avatar user={data.users.find((u) => u.id === currentUserId)} size="sm" />
                    {authUser.name} <span className="text-slate-400">({authUser.username})</span>
                  </span>
                ) : (
                  <Select value={currentUserId} onChange={(e) => useAppStore.setState({ currentUserId: e.target.value })} aria-label="Signed in as" className="mt-1 max-w-xs">
                    {data.users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} — {u.role}
                      </option>
                    ))}
                  </Select>
                )}
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

      {authMode === 'server' && <AccountCard />}

      <Card>
        <CardHeader title="Security posture" icon={<ShieldCheck />} />
        <CardBody className="pt-0 text-[13px] text-slate-700 space-y-1.5">
          <p>• Identifiers are masked on screen and every reveal is written to the audit log. This is a UX convenience — production enforces field-level authorisation server-side.</p>
          <p>• Sending and filing are simulated — no message or filing integration is connected yet, so nothing leaves this application.</p>
          <p>• Every record carries a practice id so server-side persistence can enforce tenant isolation from day one.</p>
          {authMode === 'server' && <p>• Signed in with a shared account: practice data is stored in a database, not just this browser. Identifiers aren't encrypted at rest there yet — see docs/ARCHITECTURE.md for the security roadmap.</p>}
        </CardBody>
      </Card>
    </div>
  );
}

function AccountCard() {
  const toast = useAppStore((s) => s.toast);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== confirm) {
      toast({ title: "New passwords don't match", tone: 'error' });
      return;
    }
    setBusy(true);
    try {
      await changePassword(current, next);
      toast({ title: 'Password updated', tone: 'success' });
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch (err) {
      toast({ title: "Couldn't update password", description: (err as Error).message, tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const doLogout = async () => {
    await logout();
    window.location.reload();
  };

  return (
    <Card>
      <CardHeader title="Your account" icon={<KeyRound />} description="Change your password, or sign out of this device." />
      <CardBody className="pt-0 space-y-4">
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-3">
          <Field label="Current password" htmlFor="acct-current">
            <Input id="acct-current" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
          </Field>
          <Field label="New password" htmlFor="acct-new" hint="At least 8 characters.">
            <Input id="acct-new" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
          </Field>
          <Field label="Confirm new password" htmlFor="acct-confirm">
            <Input id="acct-confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
          </Field>
          <div className="sm:col-span-3">
            <Button type="submit" variant="secondary" disabled={busy || !current || next.length < 8 || !confirm}>
              {busy ? 'Saving…' : 'Update password'}
            </Button>
          </div>
        </form>
        <div className="pt-2 border-t border-slate-100">
          <Button variant="ghost" icon={<LogOut />} onClick={doLogout}>
            Sign out
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
