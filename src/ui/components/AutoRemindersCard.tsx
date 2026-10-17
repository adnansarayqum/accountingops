import { useCallback, useEffect, useState } from 'react';
import { BellRing } from 'lucide-react';
import { Card, CardBody, CardHeader } from './Card';
import { Button } from './Button';
import { Badge } from './Badge';
import { useAppStore } from '../../application/store';
import { useData } from '../../application/selectors';
import { hasPermission } from '../../application/auth';
import { getAutomationStatus, previewAutomation, runAutomationNow, type AutomationStatus } from '../../integrations/automation';

type Preview = Pick<AutomationStatus, 'due' | 'needsYou' | 'waiting' | 'workingHours' | 'hours' | 'enabled' | 'status' | 'problem'>;

const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`;

/**
 * Switches on the reminders that go to clients without anyone pressing Send.
 * Off until the practice turns it on here. It only emails, only the next
 * step of the sequence the Chasing page already shows, only to the client's
 * main contact, on weekdays in working hours — and anything that needs a
 * person (a phone call step, a client who prefers WhatsApp) is listed here
 * rather than sent. "Preview" shows the exact emails before trusting it.
 *
 * Renders nothing in the browser-only mode, where there is no server to send.
 */
export function AutoRemindersCard() {
  const toast = useAppStore((s) => s.toast);
  const authUser = useAppStore((s) => s.authUser);
  const update = useAppStore((s) => s.updateAutomationSettings);
  const enabled = useData().practice.automation?.autoReminders === true;
  const [status, setStatus] = useState<AutomationStatus | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const canChange = hasPermission(authUser, 'practice.configure');

  const load = useCallback(async () => {
    const next = await getAutomationStatus();
    if (next) setStatus(next);
  }, []);

  useEffect(() => {
    void load();
  }, [load, enabled]);

  if (!status) return null;

  const showPreview = async () => {
    setBusy(true);
    try {
      const result = await previewAutomation();
      if (!result) toast({ title: "Couldn't check", tone: 'error' });
      else setPreview(result);
    } finally {
      setBusy(false);
    }
  };

  const runNow = async () => {
    setBusy(true);
    try {
      const result = await runAutomationNow({ ignoreHours: !status.workingHours });
      if ('error' in result) {
        toast({ title: "Couldn't send", description: result.error === 'rate_limited' ? 'Wait a minute and try again.' : result.error, tone: 'error' });
        return;
      }
      setPreview(null);
      const sent = result.sent.length;
      toast({
        title: sent > 0 ? `${sent} reminder${sent === 1 ? '' : 's'} sent` : 'Nothing to send',
        description: sent > 0 ? 'They will appear on each client’s timeline within a minute.' : result.problem ?? undefined,
        tone: sent > 0 ? 'success' : 'info',
      });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const toggle = () => update({ autoReminders: !enabled });

  return (
    <Card data-testid="auto-reminders">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            Automatic client reminders
            {enabled ? <Badge tone="green">On</Badge> : <Badge tone="neutral">Off</Badge>}
          </span>
        }
        icon={<BellRing />}
        description={`When the next reminder in a client's sequence falls due, email it to their main contact — weekdays ${hourLabel(status.hours.from)}–${hourLabel(status.hours.to)}${status.hours.timezone ? ` (${status.hours.timezone})` : ''}. Phone, WhatsApp and text steps are never sent for you.`}
        action={
          <Button size="sm" variant={enabled ? 'secondary' : 'primary'} onClick={toggle} disabled={!canChange} data-testid="auto-reminders-toggle">
            {enabled ? 'Turn off' : 'Turn on'}
          </Button>
        }
      />
      <CardBody className="pt-0 text-[13px] text-slate-700 space-y-2">
        {!status.emailReady && (
          <p className="text-amber-800" data-testid="auto-reminders-no-email">
            {status.emailProblem ?? 'No real email provider is connected'} — nothing can be sent yet. See the Messaging card below.
          </p>
        )}
        {!canChange && <p className="text-slate-500">Only an owner or manager can change this.</p>}
        {status.unknown > 0 && (
          <p className="text-amber-800" data-testid="auto-reminders-unknown">
            {status.unknown} reminder{status.unknown === 1 ? '' : 's'} may or may not have gone (the connection dropped while sending). They will not be sent again — check the email provider’s activity log.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => void showPreview()} disabled={busy} data-testid="auto-reminders-preview">
            Preview what would be sent now
          </Button>
          {enabled && (
            <Button size="sm" variant="secondary" onClick={() => void runNow()} disabled={busy || !canChange || !status.emailReady} data-testid="auto-reminders-run">
              Send due reminders now
            </Button>
          )}
        </div>
        {preview && (
          <div data-testid="auto-reminders-preview-result" className="space-y-2">
            {preview.due.length === 0 ? (
              <p>Nothing is due to send right now.</p>
            ) : (
              <>
                <p className="font-medium">
                  {preview.due.length} email{preview.due.length === 1 ? '' : 's'} due{!enabled ? ' (only sent once this is switched on)' : ''}:
                </p>
                <ul className="space-y-1.5">
                  {preview.due.map((d) => (
                    <li key={d.jobId} className="rounded-lg border border-slate-200 p-2.5">
                      <p className="font-medium text-slate-900">
                        {d.clientName} — {d.jobName} <span className="font-normal text-slate-500">· {d.stage} · to {d.contactName} ({d.to})</span>
                      </p>
                      <details className="mt-1">
                        <summary className="cursor-pointer text-xs text-primary-700">Read the email</summary>
                        <p className="mt-1 text-xs font-medium text-slate-700">{d.subject}</p>
                        <p className="mt-1 whitespace-pre-line text-xs text-slate-600">{d.body}</p>
                      </details>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {preview.needsYou.length > 0 && (
              <div>
                <p className="font-medium">Left for you ({preview.needsYou.length}):</p>
                <ul className="list-disc pl-5 text-slate-600">
                  {preview.needsYou.map((n) => (
                    <li key={n.jobId}>
                      {n.clientName} — {n.jobName}: {n.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
