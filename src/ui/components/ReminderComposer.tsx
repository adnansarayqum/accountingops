import { useEffect, useMemo, useState } from 'react';
import { Mail, MessageCircle, MessageSquare, Send } from 'lucide-react';
import { Modal } from './Modal';
import { Button } from './Button';
import { Field, Input, Textarea } from './Form';
import { Badge } from './Badge';
import { useAppStore } from '../../application/store';
import { useData, useToday } from '../../application/selectors';
import { draftReminder, nextReminderStep, sequenceIdFor } from '../../domain/rules';
import type { Channel, Job } from '../../domain/types';
import { CHANNEL_LABELS } from '../../domain/catalog';
import { cn } from '../cn';

const CHANNELS: { value: Channel; icon: typeof Mail }[] = [
  { value: 'email', icon: Mail },
  { value: 'whatsapp', icon: MessageCircle },
  { value: 'sms', icon: MessageSquare },
];

/**
 * One-click reminder: pre-drafts a specific, human message referencing the
 * actual outstanding documents. Sending is simulated — no messaging
 * integration is connected yet.
 */
export function ReminderComposer({ job, open, onClose, initialChannel }: { job: Job; open: boolean; onClose: () => void; initialChannel?: Channel }) {
  const data = useData();
  const today = useToday();
  const sendReminder = useAppStore((s) => s.sendReminder);
  const toast = useAppStore((s) => s.toast);
  const currentUserId = useAppStore((s) => s.currentUserId);

  const client = data.clients.find((c) => c.id === job.clientId)!;
  const contact = data.contacts.find((c) => c.clientId === client.id && c.isPrimary) ?? data.contacts.find((c) => c.clientId === client.id)!;
  const sender = data.users.find((u) => u.id === currentUserId) ?? data.users[0];
  const sequence = data.reminderSequences.find((s) => s.id === sequenceIdFor(job.serviceCode));
  const remindersSent = data.communications.filter((c) => c.jobId === job.id && c.direction === 'outbound' && c.reminderStage).length;
  const step = useMemo(() => nextReminderStep(job, sequence, remindersSent, today)?.step, [job, sequence, remindersSent, today]);

  const defaultChannel: Channel = initialChannel ?? (client.preferredChannel === 'phone' || client.preferredChannel === 'portal' ? 'email' : client.preferredChannel);
  const [channel, setChannel] = useState<Channel>(defaultChannel);
  const draft = useMemo(() => draftReminder({ client, contact, job, items: data.requestItems, channel, step, sender, practiceName: data.practice.name, today }), [client, contact, job, data.requestItems, channel, step, sender, data.practice.name, today]);
  const [body, setBody] = useState(draft.body);
  const [subject, setSubject] = useState(draft.subject ?? '');
  const [recipient, setRecipient] = useState(draft.recipient);

  useEffect(() => {
    setBody(draft.body);
    setSubject(draft.subject ?? '');
    setRecipient(draft.recipient);
  }, [draft]);
  useEffect(() => {
    if (open) setChannel(defaultChannel);
  }, [open]);

  const send = () => {
    if (!recipient.trim() || !body.trim()) {
      toast({ title: 'Add a recipient and message before sending.', tone: 'error' });
      return;
    }
    sendReminder({ jobId: job.id, channel, recipient, subject: channel === 'email' ? subject : undefined, body, documentsRequested: draft.documentsRequested, stage: draft.stage });
    toast({ title: 'Reminder sent', description: `${CHANNEL_LABELS[channel]} to ${contact.name} — logged on ${client.name}. (Simulated — nothing left the app.)`, tone: 'success' });
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Send reminder"
      description={`${client.name} · ${job.name}`}
      footer={
        <>
          <span className="mr-auto text-xs text-slate-500">Sending is simulated and logged. Nothing leaves this application.</span>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={send} icon={<Send />} data-testid="send-reminder-confirm">
            Send {CHANNEL_LABELS[channel]}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div>
          <p className="text-[13px] font-medium text-slate-700 mb-1.5">Channel</p>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Channel">
            {CHANNELS.map((c) => {
              const Icon = c.icon;
              const available = c.value === 'email' ? !!contact.email : c.value === 'whatsapp' ? !!(contact.whatsapp ?? contact.phone) : !!contact.phone;
              return (
                <button
                  key={c.value}
                  type="button"
                  role="radio"
                  aria-checked={channel === c.value}
                  disabled={!available}
                  onClick={() => setChannel(c.value)}
                  className={cn('flex items-center justify-center gap-2 rounded-lg border px-3 h-10 text-sm font-medium transition-colors', channel === c.value ? 'border-primary-500 bg-primary-50 text-primary-700 ring-2 ring-primary-100' : 'border-slate-200 bg-surface text-slate-700 hover:border-slate-300', !available && 'opacity-40')}
                >
                  <Icon className="h-4 w-4" />
                  {CHANNEL_LABELS[c.value]}
                  {client.preferredChannel === c.value && <span className="text-[10px] uppercase tracking-wide text-slate-400">preferred</span>}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <Badge tone="blue">{draft.stage}</Badge>
          {draft.documentsRequested.length > 0 ? <span>Requesting: {draft.documentsRequested.join(', ')}</span> : <span>Requesting approval</span>}
          <span>· Reminder {remindersSent + 1}</span>
        </div>
        <Field label="To" htmlFor="reminder-recipient">
          <Input id="reminder-recipient" value={recipient} onChange={(e) => setRecipient(e.target.value)} />
        </Field>
        {channel === 'email' && (
          <Field label="Subject" htmlFor="reminder-subject">
            <Input id="reminder-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </Field>
        )}
        <Field label="Message" htmlFor="reminder-body" hint="Drafted from the job's actual outstanding items. Edit freely before sending.">
          <Textarea id="reminder-body" rows={channel === 'email' ? 9 : 5} value={body} onChange={(e) => setBody(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
