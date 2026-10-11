import { useEffect, useState } from 'react';
import { Copy, Mail } from 'lucide-react';
import { Card, CardBody, CardHeader } from './Card';
import { Button } from './Button';
import { Badge } from './Badge';
import { Input } from './Form';
import { useAppStore } from '../../application/store';
import { getEmailForwarding, saveEmailSenders, type EmailForwarding } from '../../integrations/intake';

const parseAddresses = (text: string): string[] => text.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);

/**
 * Email into the app without opening it: forward an email — attachments and
 * all — to the practice's inbound address and it is read and filed like a
 * share. Only addresses listed here are accepted, since anyone could email
 * that address; each person lists the mail accounts they forward from.
 *
 * Renders nothing in the browser-only mode, where there is no server to
 * receive the email.
 */
export function ForwardEmailCard() {
  const toast = useAppStore((s) => s.toast);
  const [info, setInfo] = useState<EmailForwarding | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getEmailForwarding().then((result) => {
      if (cancelled || !result) return;
      setInfo(result);
      setText(result.senders.join(', '));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!info) return null;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const result = await saveEmailSenders(parseAddresses(text));
      if (!result.ok) {
        const description =
          result.error === 'invalid' ? `“${result.email}” does not look like an email address.`
          : result.error === 'too_many' ? `Up to ${info.maxSenders} addresses.`
          : result.error === 'taken' ? `${result.email} is already used by someone else.`
          : undefined;
        toast({ title: "Couldn't save those addresses", description, tone: 'error' });
        return;
      }
      setInfo({ ...info, senders: result.senders });
      setText(result.senders.join(', '));
      toast({ title: result.senders.length > 0 ? 'Addresses saved' : 'Addresses cleared', description: result.senders.length > 0 ? `Emails from ${result.senders.join(', ')} will be filed.` : 'No forwarded email will be accepted from you.', tone: 'success' });
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!info.address) return;
    try {
      await navigator.clipboard.writeText(info.address);
      toast({ title: 'Address copied', tone: 'success' });
    } catch {
      toast({ title: "Couldn't copy", description: 'Select it and copy by hand.', tone: 'error' });
    }
  };

  return (
    <Card data-testid="forward-email">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            Email documents in
            {info.ready ? <Badge tone="green">Ready</Badge> : <Badge tone="neutral">Not set up</Badge>}
          </span>
        }
        description="Forward an email — attachments and all — and it is read and filed like a shared document."
        icon={<Mail />}
      />
      <CardBody className="pt-0 space-y-4 text-[13px] text-slate-700">
        {info.address ? (
          <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
            <code className="min-w-0 break-all rounded bg-slate-50 border border-slate-200 px-2 py-1.5 text-xs" data-testid="forward-email-address">
              {info.address}
            </code>
            <Button size="sm" variant="secondary" icon={<Copy />} onClick={copy}>
              Copy address
            </Button>
          </div>
        ) : (
          <p className="text-slate-500" data-testid="forward-email-unavailable">
            The server's inbound email isn't set up yet, so there is no address to forward to. It needs a Postmark inbound address and the three INBOUND_EMAIL settings — see docs/INTEGRATIONS.md.
          </p>
        )}

        <form onSubmit={save} className="space-y-2">
          <label htmlFor="forward-senders" className="block font-medium text-slate-900">
            Addresses you forward from
          </label>
          <Input id="forward-senders" value={text} onChange={(e) => setText(e.target.value)} placeholder="ray@gmail.com, ray@firm.co.uk" data-testid="forward-email-senders" />
          <p className="text-xs text-slate-500">Only email from these addresses is accepted — anyone could write to the inbound address. Separate several with commas, up to {info.maxSenders}.</p>
          <Button type="submit" disabled={busy} data-testid="forward-email-save">
            Save addresses
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}
