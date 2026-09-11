import { useState } from 'react';
import { RotateCcw, Database, ShieldCheck, Users } from 'lucide-react';
import { PageHeader } from '../ui/components/PageHeader';
import { Card, CardBody, CardHeader } from '../ui/components/Card';
import { Button } from '../ui/components/Button';
import { Modal } from '../ui/components/Modal';
import { Select } from '../ui/components/Form';
import { Avatar } from '../ui/components/Avatar';
import { useAppStore } from '../application/store';
import { useData } from '../application/selectors';
import { formatDateTime } from '../domain/dates';

export function SettingsPage() {
  const data = useData();
  const reset = useAppStore((s) => s.resetDemo);
  const lastResetAt = useAppStore((s) => s.lastResetAt);
  const currentUserId = useAppStore((s) => s.currentUserId);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const doReset = async () => {
    setBusy(true);
    await reset();
    setBusy(false);
    setConfirm(false);
  };

  return (
    <div className="animate-in max-w-3xl space-y-5">
      <PageHeader title="Settings & demo" description="Practice configuration and demo controls." />

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
        <CardHeader title="Security posture" icon={<ShieldCheck />} description="What the demo does and does not do." />
        <CardBody className="pt-0 text-[13px] text-slate-700 space-y-1.5">
          <p>• Identifiers are masked on screen and every reveal is written to the audit log. This is a UX convenience — production enforces field-level authorisation server-side.</p>
          <p>• All client data is synthetic. No messages, filings or documents leave this application.</p>
          <p>• Every record carries a practice id so server-side persistence can enforce tenant isolation from day one.</p>
        </CardBody>
      </Card>

      <Card className="border-amber-200">
        <CardHeader title="Demo data" icon={<Database />} description="Restore the showcase scenario. This discards every change made in this browser." />
        <CardBody className="pt-0">
          <p className="text-xs text-slate-500 mb-3">{lastResetAt ? `Last reset ${formatDateTime(lastResetAt)}.` : 'Data is stored locally in this browser.'}</p>
          <Button variant="secondary" icon={<RotateCcw />} onClick={() => setConfirm(true)} data-testid="reset-demo">
            Reset demo data
          </Button>
        </CardBody>
      </Card>

      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Reset demo data?"
        description="All changes made in this browser will be replaced with the original showcase scenario."
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" onClick={doReset} disabled={busy} data-testid="reset-demo-confirm">
              {busy ? 'Resetting…' : 'Yes, reset'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-700">ABC Construction will be back to two missing documents, the Smart Inbox will have six items waiting, and every reminder you sent will be cleared.</p>
      </Modal>
    </div>
  );
}
