import { useCallback, useEffect, useState } from 'react';
import { Copy, Link2, Paperclip, ShieldOff } from 'lucide-react';
import { Card, CardBody, CardHeader } from './Card';
import { Button } from './Button';
import { Badge } from './Badge';
import { useAppStore } from '../../application/store';
import { usePracticeTimezone } from '../../application/selectors';
import { createPortalLink, fileToUploadBody, getPortalStatus, listPortalLinks, revokePortalLink, type PortalLink, type PortalPurpose } from '../../integrations/portal';
import { formatDate } from '../../domain/dates';
import type { Job } from '../../domain/types';

/**
 * Links a client can act on without an account: upload the records being
 * chased, or approve the work before it is filed. Lives on the job, since
 * a link is for one job and nothing else.
 *
 * The URL is shown exactly once, at creation — the server keeps only a
 * hash, so there is no "show me again". A lost link is revoked and a new
 * one made; that is the design, not a limitation.
 *
 * Renders nothing when the portal isn't available, which is the whole
 * browser-only mode.
 */
export function ClientLinkCard({ job }: { job: Job }) {
  const timeZone = usePracticeTimezone();
  const toast = useAppStore((s) => s.toast);
  const [configured, setConfigured] = useState(false);
  const [links, setLinks] = useState<PortalLink[]>([]);
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<{ url: string; purpose: PortalPurpose } | null>(null);
  const [message, setMessage] = useState('');
  const [attachment, setAttachment] = useState<File | null>(null);

  const load = useCallback(async () => setLinks(await listPortalLinks(job.id)), [job.id]);

  useEffect(() => {
    let cancelled = false;
    void getPortalStatus().then((status) => {
      if (cancelled || !status.configured) return;
      setConfigured(true);
      void load();
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  if (!configured || job.status === 'filed') return null;

  const canUpload = job.status === 'waiting_for_records' || job.status === 'ready_to_start' || job.status === 'in_progress';
  const canApprove = job.status === 'waiting_client_approval';

  const create = async (purpose: PortalPurpose) => {
    setBusy(true);
    try {
      const body = attachment && purpose === 'approve' ? await fileToUploadBody(attachment) : undefined;
      const result = await createPortalLink({ clientId: job.clientId, jobId: job.id, purpose, message: message.trim() || undefined, attachment: body });
      if ('error' in result) {
        toast({ title: "Couldn't create the link", description: result.error === 'too_large' ? 'The attachment is over 10 MB.' : result.error, tone: 'error' });
        return;
      }
      setFresh({ url: result.url, purpose });
      setMessage('');
      setAttachment(null);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: 'Link copied', description: 'Paste it into an email or WhatsApp to the client.', tone: 'success' });
    } catch {
      toast({ title: 'Copy the link from the box', tone: 'info' });
    }
  };

  const revoke = async (link: PortalLink) => {
    if (!window.confirm('Revoke this link? The client will see "no longer valid" if they open it.')) return;
    await revokePortalLink(link.id);
    if (fresh && links.find((l) => l.id === link.id)) setFresh(null);
    await load();
  };

  const live = links.filter((l) => l.state === 'live');

  return (
    <Card data-testid="client-link-card">
      <CardHeader title="Client link" icon={<Link2 />} description="A link the client can act on without an account — one job, one purpose, nothing else on the page." />
      <CardBody className="pt-0 space-y-3">
        {fresh && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2.5" data-testid="fresh-link">
            <p className="text-xs font-semibold text-emerald-800 mb-1">New {fresh.purpose === 'upload' ? 'upload' : 'approval'} link — copy it now. It is not shown again.</p>
            <div className="flex items-center gap-2">
              <input readOnly value={fresh.url} className="flex-1 min-w-0 h-8 rounded-md border border-emerald-200 bg-surface px-2 text-[12px] font-mono" onFocus={(e) => e.currentTarget.select()} data-testid="fresh-link-url" />
              <Button size="sm" icon={<Copy />} onClick={() => void copy(fresh.url)} data-testid="copy-link">
                Copy
              </Button>
            </div>
          </div>
        )}

        {(canUpload || canApprove) && (
          <div className="space-y-2">
            <input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="A note the client will see (optional)" className="w-full h-9 rounded-lg border border-slate-200 bg-surface px-3 text-[13px]" aria-label="Message to the client" data-testid="link-message" />
            {canApprove && (
              <label className="flex items-center gap-2 text-[13px] text-slate-700 cursor-pointer">
                <Paperclip className="h-4 w-4 text-slate-400" />
                <span>{attachment ? attachment.name : 'Attach the document to approve (PDF)'}</span>
                <input type="file" accept=".pdf" className="sr-only" onChange={(e) => setAttachment(e.target.files?.[0] ?? null)} data-testid="link-attachment" />
              </label>
            )}
            <div className="flex flex-wrap gap-2">
              {canUpload && (
                <Button size="sm" onClick={() => void create('upload')} disabled={busy} data-testid="create-upload-link">
                  Create upload link
                </Button>
              )}
              {canApprove && (
                <Button size="sm" onClick={() => void create('approve')} disabled={busy} data-testid="create-approve-link">
                  Create approval link
                </Button>
              )}
            </div>
          </div>
        )}

        {links.length > 0 && (
          <ul className="divide-y divide-slate-100" data-testid="link-list">
            {links.slice(0, 6).map((l) => (
              <li key={l.id} className="py-2 flex items-center justify-between gap-2 text-[13px]">
                <span className="min-w-0">
                  <span className="font-medium text-slate-800 capitalize">{l.purpose}</span>
                  <span className="text-slate-500"> · created {formatDate(l.createdAt, { timeZone })}</span>
                  <span className="block text-[11px] text-slate-400">
                    {l.lastOpenedAt ? `Opened ${formatDate(l.lastOpenedAt, { timeZone })} · ` : 'Not yet opened · '}
                    expires {formatDate(l.expiresAt, { timeZone })}
                  </span>
                </span>
                <span className="flex items-center gap-2 shrink-0">
                  <Badge tone={l.state === 'live' ? 'green' : l.state === 'used' ? 'blue' : 'neutral'}>{l.state}</Badge>
                  {l.state === 'live' && (
                    <Button size="sm" variant="ghost" icon={<ShieldOff />} onClick={() => void revoke(l)} aria-label="Revoke link" title="Revoke" />
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        {live.length === 0 && links.length === 0 && !canUpload && !canApprove && <p className="text-[13px] text-slate-500">Links can be created while the job is waiting for records or for client approval.</p>}
      </CardBody>
    </Card>
  );
}
