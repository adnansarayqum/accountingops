import { useState } from 'react';
import { Check, KeyRound, LogOut, Pencil, RotateCcw, ShieldCheck, ShieldOff, SlidersHorizontal, Users, X } from 'lucide-react';
import { PageHeader } from '../ui/components/PageHeader';
import { Card, CardBody, CardHeader } from '../ui/components/Card';
import { Button } from '../ui/components/Button';
import { Field, Input, Select } from '../ui/components/Form';
import { Avatar } from '../ui/components/Avatar';
import { SnapshotHistoryCard } from '../ui/components/SnapshotHistoryCard';
import { MessagingStatusCard } from '../ui/components/MessagingStatusCard';
import { DuplicatePeopleCard } from '../ui/components/DuplicatePeopleCard';
import { CorporationTaxCard } from '../ui/components/CorporationTaxCard';
import { useAppStore } from '../application/store';
import { useData } from '../application/selectors';
import { changePassword, logout, logoutEverywhere } from '../application/auth';
import { DEFAULT_THRESHOLDS, MAX_THRESHOLD_DAYS, MIN_THRESHOLD_DAYS, resolveThresholds } from '../domain/rules';
import type { PracticeThresholds } from '../domain/types';

export function SettingsPage() {
  const data = useData();
  const currentUserId = useAppStore((s) => s.currentUserId);
  const authMode = useAppStore((s) => s.authMode);
  const authUser = useAppStore((s) => s.authUser);
  const renameUser = useAppStore((s) => s.renameUser);
  const toast = useAppStore((s) => s.toast);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState('');

  const startEditing = (userId: string, currentName: string) => {
    setEditingUserId(userId);
    setNameDraft(currentName);
  };
  const saveEditing = () => {
    if (editingUserId) {
      const before = data.users.find((u) => u.id === editingUserId)?.name;
      renameUser(editingUserId, nameDraft);
      const after = useAppStore.getState().data.users.find((u) => u.id === editingUserId)?.name;
      // Confirmed like every other change — a rename that silently reverts (blank
      // name) or silently sticks looked the same until now.
      if (after && after !== before) toast({ title: 'Name updated', description: `${before} is now ${after}.`, tone: 'success' });
    }
    setEditingUserId(null);
  };

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
                    {data.users.find((u) => u.id === currentUserId)?.name ?? authUser.name} <span className="text-slate-400">({authUser.username})</span>
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
              <li key={u.id} className="flex items-center gap-2.5 rounded-lg border border-slate-100 px-3 py-2" data-testid={`team-member-${u.id}`}>
                <Avatar user={u} />
                <div className="min-w-0 flex-1">
                  {editingUserId === u.id ? (
                    <div className="flex items-center gap-1.5">
                      <Input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} autoFocus className="h-7 text-[13px]" aria-label={`Name for ${u.name}`} />
                      <button type="button" onClick={saveEditing} className="text-emerald-600 hover:text-emerald-700" aria-label="Save name">
                        <Check className="h-4 w-4" />
                      </button>
                      <button type="button" onClick={() => setEditingUserId(null)} className="text-slate-400 hover:text-slate-600" aria-label="Cancel">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <p className="text-[13px] font-medium text-slate-900 flex items-center gap-1.5">
                      {u.name}
                      <button type="button" onClick={() => startEditing(u.id, u.name)} className="text-slate-300 hover:text-slate-600" aria-label={`Edit name for ${u.name}`}>
                        <Pencil className="h-3 w-3" />
                      </button>
                    </p>
                  )}
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
      {authMode === 'server' && <SnapshotHistoryCard />}
      <ThresholdsCard />
      <MessagingStatusCard />
      <DuplicatePeopleCard />
      <CorporationTaxCard />

      <Card>
        <CardHeader title="Security posture" icon={<ShieldCheck />} />
        <CardBody className="pt-0 text-[13px] text-slate-700 space-y-1.5">
          <p>• Identifiers are masked on screen and every reveal is written to the audit log. This is a UX convenience — production enforces field-level authorisation server-side.</p>
          <p>• Filing is simulated — nothing is submitted to HMRC or Companies House. Reminders leave the app only as the Messaging card above describes.</p>
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
  const [signingOutEverywhere, setSigningOutEverywhere] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== confirm) {
      toast({ title: "New passwords don't match", tone: 'error' });
      return;
    }
    setBusy(true);
    try {
      await changePassword(current, next);
      toast({ title: 'Password updated', description: 'Any other signed-in session for this account was signed out.', tone: 'success' });
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

  const doLogoutEverywhere = async () => {
    if (!window.confirm('Sign out every device currently signed in to this account?')) return;
    setSigningOutEverywhere(true);
    try {
      await logoutEverywhere();
      window.location.reload();
    } finally {
      setSigningOutEverywhere(false);
    }
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
        <div className="pt-2 border-t border-slate-100 flex flex-wrap gap-2">
          <Button variant="ghost" icon={<LogOut />} onClick={doLogout}>
            Sign out
          </Button>
          <Button variant="ghost" icon={<ShieldOff />} onClick={() => void doLogoutEverywhere()} disabled={signingOutEverywhere} data-testid="logout-everywhere">
            {signingOutEverywhere ? 'Signing out everywhere…' : 'Sign out everywhere'}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

/** Validated fields, in page order, and the input id each error belongs to — same pattern as NewClientPage. */
const THRESHOLD_FIELDS: { key: keyof PracticeThresholds; label: string; hint: string; id: string }[] = [
  { key: 'dueSoonDays', label: 'Due soon window', hint: 'How far ahead of a job’s deadline counts as "due soon" on the dashboard.', id: 'th-due-soon' },
  { key: 'identityVerificationWindowDays', label: 'Identity verification look-ahead', hint: 'How far ahead of a confirmation statement an unverified director or PSC gets flagged.', id: 'th-identity' },
  { key: 'staleJobDays', label: 'Stale job threshold', hint: 'How long a job can sit with no status change before it’s flagged as stale.', id: 'th-stale' },
  { key: 'reviewWaitDays', label: 'Review wait threshold', hint: 'How long a job can sit in internal review with no reviewer before it’s flagged.', id: 'th-review' },
  { key: 'approvalWaitDays', label: 'Approval wait threshold', hint: 'How long a job can wait for client approval before it’s flagged.', id: 'th-approval' },
];

function draftFrom(thresholds: PracticeThresholds): Record<keyof PracticeThresholds, string> {
  return Object.fromEntries(THRESHOLD_FIELDS.map((f) => [f.key, String(thresholds[f.key])])) as Record<keyof PracticeThresholds, string>;
}

function ThresholdsCard() {
  const data = useData();
  const updatePracticeThresholds = useAppStore((s) => s.updatePracticeThresholds);
  const toast = useAppStore((s) => s.toast);
  const [draft, setDraft] = useState<Record<keyof PracticeThresholds, string>>(() => draftFrom(resolveThresholds(data.practice.thresholds)));
  const [errors, setErrors] = useState<Partial<Record<keyof PracticeThresholds, string>>>({});
  /** Links an input to its Field's error message for assistive tech. */
  const invalid = (key: keyof PracticeThresholds, id: string) => ({ 'aria-invalid': errors[key] ? true : undefined, 'aria-describedby': errors[key] ? `${id}-error` : undefined });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed: Partial<PracticeThresholds> = {};
    const nextErrors: Partial<Record<keyof PracticeThresholds, string>> = {};
    for (const field of THRESHOLD_FIELDS) {
      const value = Number(draft[field.key]);
      if (!Number.isInteger(value) || value < MIN_THRESHOLD_DAYS || value > MAX_THRESHOLD_DAYS) {
        nextErrors[field.key] = `Enter a whole number from ${MIN_THRESHOLD_DAYS} to ${MAX_THRESHOLD_DAYS}.`;
      } else {
        parsed[field.key] = value;
      }
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    updatePracticeThresholds(parsed);
    toast({ title: 'Timing thresholds updated', description: 'Needs Attention and the dashboard reflect this immediately.', tone: 'success' });
  };

  const resetDraft = () => {
    setDraft(draftFrom(DEFAULT_THRESHOLDS));
    setErrors({});
  };

  return (
    <Card>
      <CardHeader title="Timing thresholds" icon={<SlidersHorizontal />} description="How urgency is judged across Needs Attention and the dashboard's due-soon view." />
      <CardBody className="pt-0">
        <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
          {THRESHOLD_FIELDS.map((field) => (
            <Field key={field.key} label={field.label} htmlFor={field.id} hint={field.hint} error={errors[field.key]}>
              <div className="flex items-center gap-2">
                <Input
                  id={field.id}
                  type="number"
                  inputMode="numeric"
                  min={MIN_THRESHOLD_DAYS}
                  max={MAX_THRESHOLD_DAYS}
                  value={draft[field.key]}
                  onChange={(e) => setDraft({ ...draft, [field.key]: e.target.value })}
                  className="w-24"
                  {...invalid(field.key, field.id)}
                />
                <span className="text-xs text-slate-500">days</span>
              </div>
            </Field>
          ))}
          <div className="sm:col-span-2 flex flex-wrap gap-2 pt-1">
            <Button type="submit">Save thresholds</Button>
            <Button type="button" variant="ghost" icon={<RotateCcw />} onClick={resetDraft}>
              Reset to defaults
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
