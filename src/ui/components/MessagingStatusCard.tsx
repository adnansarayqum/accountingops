import { useEffect, useState } from 'react';
import { Mail, MessageCircle, MessageSquare, Send } from 'lucide-react';
import { Card, CardBody, CardHeader } from './Card';
import { Badge } from './Badge';
import { getMessagingStatus, type MessagingStatus } from '../../integrations/messaging';

/** What each reminder channel actually does on this deployment — so nobody has to guess whether "Send" sent. */
export function MessagingStatusCard() {
  const [status, setStatus] = useState<MessagingStatus | null>(null);
  useEffect(() => {
    void getMessagingStatus().then(setStatus);
  }, []);
  if (!status) return null;
  const emailLive = status.email.configured && status.email.provider !== 'simulated';

  return (
    <Card data-testid="messaging-status">
      <CardHeader title="Messaging" icon={<Send />} description="How each reminder channel leaves the app." />
      <CardBody className="pt-0">
        <ul className="divide-y divide-slate-100 text-[13px]">
          <li className="py-2 flex items-start gap-3">
            <Mail className="h-4 w-4 mt-0.5 text-slate-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-slate-900">
                Email {emailLive ? <Badge tone="green">live · {status.email.provider}</Badge> : <Badge tone="neutral">simulated</Badge>}
              </p>
              <p className="text-xs text-slate-500">
                {emailLive ? `Sent from ${status.email.from}.` : 'Logged only — nothing is sent. To turn it on, set MESSAGING_EMAIL_PROVIDER=postmark, POSTMARK_SERVER_TOKEN and MESSAGING_FROM_EMAIL (see docs/INTEGRATIONS.md).'}
              </p>
            </div>
          </li>
          <li className="py-2 flex items-start gap-3">
            <MessageCircle className="h-4 w-4 mt-0.5 text-slate-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-slate-900">
                WhatsApp <Badge tone="green">opens your WhatsApp</Badge>
              </p>
              <p className="text-xs text-slate-500">Send opens WhatsApp on this device with the drafted message filled in; you press send there. Logged here as handed off.</p>
            </div>
          </li>
          <li className="py-2 flex items-start gap-3">
            <MessageSquare className="h-4 w-4 mt-0.5 text-slate-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-slate-900">
                SMS <Badge tone="neutral">simulated</Badge>
              </p>
              <p className="text-xs text-slate-500">Logged only. Needs a sender to be chosen first — an alphanumeric sender is one-way, so the "reply here" wording would change.</p>
            </div>
          </li>
        </ul>
      </CardBody>
    </Card>
  );
}
