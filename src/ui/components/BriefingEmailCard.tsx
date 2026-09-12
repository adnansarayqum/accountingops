import { useEffect, useState } from 'react';
import { Sunrise } from 'lucide-react';
import { Card, CardBody, CardHeader } from './Card';
import { Button } from './Button';
import { Badge } from './Badge';
import { Input } from './Form';
import { useAppStore } from '../../application/store';
import { getBriefingSettings, saveBriefingSettings, sendBriefingNow, type BriefingSettings } from '../../integrations/briefing';
import { formatDate } from '../../domain/dates';

/**
 * The Briefing page, delivered: a weekday-morning email of what is
 * overdue, due this week, ready to file and who has gone quiet, so the
 * app is part of the morning rather than somewhere you go when you
 * remember. Per user — each account chooses its own address and switch.
 *
 * Renders nothing in the browser-only mode, where there is no account to
 * attach an address to.
 */
export function BriefingEmailCard() {
  const toast = useAppStore((s) => s.toast);
  const [settings, setSettings] = useState<BriefingSettings | null>(null);
  const [email, setEmail] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getBriefingSettings().then((s) => {
      if (cancelled || !s) return;
      setSettings(s);
      setEmail(s.email ?? '');
      setEnabled(s.enabled);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!settings) return null;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const result = await saveBriefingSettings({ email: email.trim(), enabled });
      if ('error' in result) {
        toast({ title: result.error === 'invalid_email' ? 'That does not look like an email address' : "Couldn't save", tone: 'error' });
        return;
      }
      setSettings(result);
      toast({ title: result.enabled ? 'Morning briefing on' : 'Morning briefing off', description: result.enabled ? `Weekdays from ${String(result.sendHour).padStart(2, '0')}:00 to ${result.email}.` : undefined, tone: 'success' });
    } finally {
      setBusy(false);
    }
  };

  const sendNow = async () => {
    setBusy(true);
    try {
      const result = await sendBriefingNow();
      if (!result.sent) {
        toast({ title: "Couldn't send", description: result.error === 'email_required' ? 'Save an email address first.' : result.error === 'not_configured' ? 'No email provider is configured — see the Messaging card.' : result.error, tone: 'error' });
        return;
      }
      toast({ title: result.status === 'simulated' ? 'Briefing composed (simulated — no email provider)' : 'Briefing sent', description: `To ${result.to}.`, tone: 'success' });
    } finally {
      setBusy(false);
    }
  };

  const providerOff = !settings.provider.configured;

  return (
    <Card data-testid="briefing-email">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            Morning briefing by email
            {settings.enabled ? <Badge tone="green">On</Badge> : <Badge tone="neutral">Off</Badge>}
          </span>
        }
        icon={<Sunrise />}
        description={`What is overdue, due this week, ready to file and who has gone quiet — every weekday from ${String(settings.sendHour).padStart(2, '0')}:00, to you.`}
        action={
          <Button size="sm" variant="secondary" onClick={() => void sendNow()} disabled={busy || !settings.email} data-testid="briefing-send-now">
            Send me one now
          </Button>
        }
      />
      <CardBody className="pt-0">
        <form onSubmit={save} noValidate className="flex flex-col sm:flex-row sm:items-end gap-2">
          <label className="flex-1 min-w-0">
            <span className="text-xs font-medium text-slate-600">Send to</span>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@yourpractice.co.uk" aria-label="Briefing email address" data-testid="briefing-email-input" />
          </label>
          <label className="flex items-center gap-2 text-[13px] text-slate-700 h-9 sm:pb-0">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4 rounded border-slate-300" data-testid="briefing-enabled" />
            Every weekday morning
          </label>
          <Button type="submit" size="md" disabled={busy} data-testid="briefing-save">
            Save
          </Button>
        </form>
        <p className="mt-2 text-xs text-slate-500">
          {settings.lastSentOn ? `Last sent ${formatDate(settings.lastSentOn, { year: true })}. ` : ''}
          {providerOff ? 'No email provider is configured yet, so a send is simulated and logged rather than delivered — see the Messaging card.' : `Sent from ${settings.provider.from}.`}
        </p>
      </CardBody>
    </Card>
  );
}
