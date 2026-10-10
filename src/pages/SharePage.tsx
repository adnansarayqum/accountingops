import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Check, FileText, HelpCircle, Loader2, Share2, Smartphone } from 'lucide-react';
import { PageHeader } from '../ui/components/PageHeader';
import { Card, CardBody } from '../ui/components/Card';
import { Button, LinkButton } from '../ui/components/Button';
import { Field, Select } from '../ui/components/Form';
import { EmptyState } from '../ui/components/EmptyState';
import { Badge } from '../ui/components/Badge';
import { useAppStore } from '../application/store';
import { useData } from '../application/selectors';
import { clearParkedShare, prepareFiles, readParkedShare, type ParkedShare } from '../application/sharedFiles';
import { assignSharedDocument, releaseShare, sendShare, type ShareError, type ShareResult, type SharedDocument } from '../integrations/intake';

type Phase =
  | { kind: 'loading' }
  | { kind: 'nothing'; reason: 'missing' | 'not_ready' | 'unreadable' | 'local' }
  | { kind: 'sending' }
  | { kind: 'failed'; error: ShareError | 'nothing_sendable' }
  | { kind: 'done'; result: ShareResult };

const NOTHING: Record<'missing' | 'not_ready' | 'unreadable' | 'local', { title: string; description: string }> = {
  missing: { title: 'Nothing to send', description: 'Share a photo, PDF or message from WhatsApp or your email app and choose “F&R Ops”. It lands here.' },
  not_ready: { title: 'The app wasn’t ready for that share', description: 'Open F&R Ops once so it can finish installing, then share again.' },
  unreadable: { title: 'That share couldn’t be read', description: 'Try sharing it again — if it keeps happening, send it as a photo or PDF.' },
  local: { title: 'Sharing needs the online version', description: 'Documents shared from your phone are read and stored by the practice’s server, which this browser-only copy doesn’t have.' },
};

const FAILED: Record<ShareError | 'nothing_sendable', string> = {
  already_shared: 'You already shared exactly these files this week, so they weren’t read again. They’re in Smart Inbox.',
  not_configured: 'The practice’s server isn’t set up to receive shared documents.',
  too_large: 'That’s too much in one go — share up to 10 files, 20 MB in total.',
  unsupported: 'Some of that isn’t a photo, PDF or text the app can read.',
  failed: 'Couldn’t reach the practice’s server. Check your connection and try again.',
  nothing_sendable: 'Nothing in that share is a photo, PDF or text the app can read.',
};

/**
 * Where a share from WhatsApp or email lands (Android hands it to
 * public/sw.js, which parks the files and opens this page). Sends them on,
 * says where each document is going, and lets Ray correct the client before
 * the practice sees it. Leaving without pressing Done is fine — the server
 * releases the share on its own after a few minutes.
 */
export function SharePage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const authMode = useAppStore((s) => s.authMode);
  const toast = useAppStore((s) => s.toast);
  const data = useData();
  const shareId = params.get('id');
  const errorParam = params.get('error');

  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [parked, setParked] = useState<ParkedShare | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [documents, setDocuments] = useState<SharedDocument[]>([]);
  const started = useRef(false);

  const clients = useMemo(() => [...data.clients].sort((a, b) => a.name.localeCompare(b.name)), [data.clients]);

  const send = async (share: ParkedShare) => {
    setPhase({ kind: 'sending' });
    const { ready, skipped: left } = await prepareFiles(share.files);
    setSkipped(left);
    if (ready.length === 0 && !share.text.trim()) {
      setPhase({ kind: 'failed', error: 'nothing_sendable' });
      return;
    }
    const outcome = await sendShare(ready, share.text);
    if (!outcome.ok) {
      setPhase({ kind: 'failed', error: outcome.error });
      // A share the server already has is safe to forget.
      if (outcome.error === 'already_shared' && shareId) void clearParkedShare(shareId);
      return;
    }
    setDocuments(outcome.result.documents);
    setPhase({ kind: 'done', result: outcome.result });
    if (shareId) void clearParkedShare(shareId);
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (authMode !== 'server') {
      setPhase({ kind: 'nothing', reason: 'local' });
      return;
    }
    if (errorParam === 'not_ready' || errorParam === 'unreadable') {
      setPhase({ kind: 'nothing', reason: errorParam });
      return;
    }
    if (!shareId) {
      setPhase({ kind: 'nothing', reason: 'missing' });
      return;
    }
    void readParkedShare(shareId)
      .then((share) => {
        if (!share || (share.files.length === 0 && !share.text.trim())) {
          setPhase({ kind: 'nothing', reason: 'missing' });
          return;
        }
        setParked(share);
        return send(share);
      })
      .catch(() => setPhase({ kind: 'nothing', reason: 'unreadable' }));
    // Runs once per visit: a share is sent exactly once, even under StrictMode.
  }, []);

  const previews = useMemo(() => (parked?.files ?? []).map((file) => ({ name: file.name, url: file.type.startsWith('image/') ? URL.createObjectURL(file) : null })), [parked]);
  useEffect(() => () => previews.forEach((p) => p.url && URL.revokeObjectURL(p.url)), [previews]);

  const changeClient = async (doc: SharedDocument, clientId: string) => {
    const next = clientId || null;
    const ok = await assignSharedDocument(doc.id, next);
    if (!ok) {
      toast({ title: 'Couldn’t change the client', description: 'It may already be in Smart Inbox — change it there instead.', tone: 'error' });
      return;
    }
    const name = clients.find((c) => c.id === next)?.name ?? null;
    setDocuments((docs) => docs.map((d) => (d.id === doc.id ? { ...d, clientId: next, clientName: name, filed: Boolean(next) } : d)));
  };

  const finish = async () => {
    if (phase.kind === 'done') await releaseShare(phase.result.batchId);
    const filed = documents.filter((d) => d.filed).length;
    toast({ title: 'Sent to the practice', description: filed === documents.length ? 'Everything is filed.' : `${documents.length - filed} to sort in Smart Inbox.`, tone: 'success' });
    navigate('/inbox');
  };

  return (
    <div className="animate-in max-w-2xl" data-testid="share-page">
      <PageHeader title="Shared from your phone" description="The AI reads what you shared, works out which client it belongs to and files it. Check it here before it goes in." />

      {phase.kind === 'loading' && (
        <Card>
          <CardBody className="py-10 flex items-center justify-center gap-2 text-sm text-slate-600">
            <Loader2 className="h-4 w-4 animate-spin" /> Opening your share…
          </CardBody>
        </Card>
      )}

      {phase.kind === 'nothing' && (
        <Card>
          <EmptyState icon={<Share2 />} title={NOTHING[phase.reason].title} description={NOTHING[phase.reason].description} action={<LinkButton to="/inbox">Go to Smart Inbox</LinkButton>} />
        </Card>
      )}

      {parked && phase.kind !== 'nothing' && (
        <Card className="mb-3">
          <CardBody className="pt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">What you shared</p>
            <div className="flex flex-wrap gap-2" data-testid="share-previews">
              {previews.map((p, index) =>
                p.url ? (
                  <img key={index} src={p.url} alt={p.name} className="h-16 w-16 rounded-lg object-cover border border-slate-200" />
                ) : (
                  <span key={index} className="h-16 w-16 rounded-lg border border-slate-200 bg-slate-50 flex flex-col items-center justify-center text-[10px] text-slate-500 px-1 text-center break-all">
                    <FileText className="h-5 w-5 mb-0.5" />
                    {p.name.slice(0, 18)}
                  </span>
                ),
              )}
            </div>
            {parked.text && <p className="mt-2 text-sm text-slate-700 whitespace-pre-wrap line-clamp-4" data-testid="share-text">{parked.text}</p>}
            {skipped.length > 0 && <p className="mt-2 text-xs text-amber-700">Left out (not a photo, PDF or text): {skipped.join(', ')}</p>}
          </CardBody>
        </Card>
      )}

      {phase.kind === 'sending' && (
        <Card>
          <CardBody className="py-8 flex flex-col items-center gap-2 text-sm text-slate-600" data-testid="share-sending">
            <Loader2 className="h-5 w-5 animate-spin text-primary-600" />
            Reading your documents — this can take a minute for a long statement.
          </CardBody>
        </Card>
      )}

      {phase.kind === 'failed' && (
        <Card>
          <CardBody className="pt-4 space-y-3" data-testid="share-failed">
            <p className="text-sm text-slate-800">{FAILED[phase.error]}</p>
            <div className="flex gap-2">
              {parked && phase.error === 'failed' && (
                <Button onClick={() => void send(parked)} data-testid="share-retry">
                  Try again
                </Button>
              )}
              <LinkButton to="/inbox" variant="secondary">
                Go to Smart Inbox
              </LinkButton>
            </div>
          </CardBody>
        </Card>
      )}

      {phase.kind === 'done' && (
        <>
          {!phase.result.read && (
            <p className="mb-3 text-sm text-amber-700" data-testid="share-unread">
              Saved, but it couldn’t be read automatically — choose a client for each below, or sort them in Smart Inbox.
            </p>
          )}
          <div className="space-y-3" data-testid="share-documents">
            {documents.map((doc) => (
              <Card key={doc.id} data-testid={`share-doc-${doc.id}`}>
                <CardBody className="pt-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900">{doc.documentType}</p>
                      {doc.summary && <p className="text-xs text-slate-600">{doc.summary}</p>}
                      <p className="text-xs text-slate-500 break-all">{doc.fileName}</p>
                    </div>
                    {doc.filed ? (
                      <Badge tone="green">
                        <Check className="h-3 w-3" /> Filing
                      </Badge>
                    ) : (
                      <Badge tone="amber">
                        <HelpCircle className="h-3 w-3" /> Check
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-slate-800" data-testid={`share-doc-status-${doc.id}`}>
                    {doc.filed && doc.clientName
                      ? `Filing under ${doc.clientName}.`
                      : doc.clientName
                        ? `Best guess: ${doc.clientName} — confirm or change it.`
                        : 'Not sure which client — choose one, or leave it for Smart Inbox.'}
                  </p>
                  <Field label="Client" htmlFor={`share-client-${doc.id}`}>
                    <Select id={`share-client-${doc.id}`} value={doc.filed ? (doc.clientId ?? '') : ''} onChange={(e) => void changeClient(doc, e.target.value)}>
                      <option value="">{doc.clientName && !doc.filed ? `Leave for Smart Inbox (guess: ${doc.clientName})` : 'Leave for Smart Inbox'}</option>
                      {clients.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </CardBody>
              </Card>
            ))}
          </div>
          <div className="mt-4 flex justify-end">
            <Button size="lg" icon={<Smartphone />} onClick={() => void finish()} data-testid="share-done">
              Done
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
