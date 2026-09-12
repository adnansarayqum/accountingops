import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, FileText, Upload, XCircle } from 'lucide-react';
import { approveViaPortal, describePortalError, getPublicJob, publicAttachmentUrl, uploadToPortal, type PublicJobView, type PublicOutcome } from '../integrations/portal';
import { formatDate } from '../domain/dates';
import { cn } from '../ui/cn';

/**
 * The client's page. Reached by a link, with no account and no sign-in;
 * rendered outside the app shell and before any auth check (see App.tsx),
 * so it never loads the practice's data and has nothing to leak.
 *
 * Deliberately plain: one job, one purpose, nothing else on the page. A
 * client who has never seen this app should be able to do the one thing
 * they were asked to do without a tour.
 */
export function PortalPage() {
  const { token = '' } = useParams();
  const [outcome, setOutcome] = useState<PublicOutcome | 'loading'>('loading');
  const [view, setView] = useState<PublicJobView | null>(null);

  const load = async () => {
    const result = await getPublicJob(token);
    setOutcome(result.outcome);
    setView(result.view);
  };

  useEffect(() => {
    void load();
  }, [token]);

  return (
    <div className="min-h-screen bg-canvas px-4 py-8 sm:py-14">
      <div className="mx-auto w-full max-w-xl">
        {outcome === 'loading' && <p className="text-sm text-slate-500">Loading…</p>}
        {outcome === 'not_found' && <DeadLink />}
        {outcome === 'unavailable' && (
          <Panel>
            <h1 className="text-lg font-semibold text-slate-900">Temporarily unavailable</h1>
            <p className="mt-1 text-sm text-slate-600">The service could not be reached. Please try again in a few minutes.</p>
          </Panel>
        )}
        {outcome === 'ok' && view && (view.purpose === 'upload' ? <UploadView token={token} view={view} onChanged={load} /> : <ApproveView token={token} view={view} />)}
        <p className="mt-6 text-center text-[11px] text-slate-400">This page was sent to you by {view?.practiceName ?? 'your accountant'}. It shows one piece of work and nothing else.</p>
      </div>
    </div>
  );
}

function Panel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('card px-5 py-5 sm:px-7 sm:py-6', className)}>{children}</div>;
}

function DeadLink() {
  return (
    <Panel>
      <h1 className="text-lg font-semibold text-slate-900">This link is no longer valid</h1>
      <p className="mt-1 text-sm text-slate-600">It may have expired, already been used, or been replaced. Please contact your accountant for a new one.</p>
    </Panel>
  );
}

function Header({ view, intro }: { view: PublicJobView; intro: string }) {
  return (
    <div className="mb-5">
      <p className="text-[12px] font-semibold uppercase tracking-wider text-primary-700">{view.practiceName}</p>
      <h1 className="mt-1 text-[22px] font-bold text-slate-900 leading-tight">{view.clientName}</h1>
      <p className="mt-0.5 text-sm text-slate-600">
        {view.jobName} · period ending {formatDate(view.periodEnd, { year: true })} · due {formatDate(view.dueDate, { year: true })}
      </p>
      <p className="mt-3 text-sm text-slate-700">{intro}</p>
      {view.message && <blockquote className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700 border-l-2 border-primary-300">{view.message}</blockquote>}
    </div>
  );
}

function UploadView({ token, view, onChanged }: { token: string; view: PublicJobView; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  const send = async (itemId: string, file: File | undefined) => {
    if (!file) return;
    setBusy(itemId);
    setErrors((e) => ({ ...e, [itemId]: '' }));
    const result = await uploadToPortal(token, file, itemId === 'other' ? undefined : itemId);
    setBusy(null);
    if (result.ok) {
      setDone((d) => ({ ...d, [itemId]: result.fileName }));
      await onChanged();
    } else {
      setErrors((e) => ({ ...e, [itemId]: describePortalError(result.error) }));
    }
  };

  const allDone = view.outstanding.length === 0;

  return (
    <Panel>
      <Header view={view} intro={allDone ? 'Everything we asked for has been received. Thank you.' : `We still need ${view.outstanding.length} ${view.outstanding.length === 1 ? 'item' : 'items'} to complete this work. Upload each one below — PDFs, photos, spreadsheets and Word documents are all fine.`} />
      {allDone ? (
        <p className="flex items-center gap-2 text-sm text-emerald-700" data-testid="portal-all-received">
          <CheckCircle2 className="h-4 w-4" /> Nothing outstanding.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100" data-testid="portal-outstanding">
          {view.outstanding.map((item) => (
            <li key={item.id} className="py-3 flex flex-wrap items-center gap-3" data-testid={`portal-item-${item.id}`}>
              <FileText className="h-4 w-4 text-slate-400 shrink-0" aria-hidden="true" />
              <div className="min-w-0 flex-1 basis-40">
                <p className="text-sm font-medium text-slate-900">{item.label}</p>
                {done[item.id] && <p className="text-xs text-emerald-700">Received: {done[item.id]}</p>}
                {errors[item.id] && <p className="text-xs text-red-600">{errors[item.id]}</p>}
              </div>
              <input
                ref={(el) => {
                  inputs.current[item.id] = el;
                }}
                type="file"
                className="sr-only"
                aria-label={`Upload ${item.label}`}
                accept=".pdf,.jpg,.jpeg,.png,.heic,.csv,.xls,.xlsx,.doc,.docx"
                onChange={(e) => void send(item.id, e.target.files?.[0])}
                data-testid={`portal-file-${item.id}`}
              />
              <button type="button" onClick={() => inputs.current[item.id]?.click()} disabled={busy !== null} className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 h-9 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50">
                <Upload className="h-4 w-4" /> {busy === item.id ? 'Uploading…' : 'Upload'}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 pt-4 border-t border-slate-100">
        <p className="text-xs text-slate-500 mb-2">Something else we did not ask for but you think we need?</p>
        <input
          ref={(el) => {
            inputs.current.other = el;
          }}
          type="file"
          className="sr-only"
          aria-label="Upload another file"
          onChange={(e) => void send('other', e.target.files?.[0])}
          data-testid="portal-file-other"
        />
        <button type="button" onClick={() => inputs.current.other?.click()} disabled={busy !== null} className="text-sm font-medium text-primary-700 hover:underline">
          {busy === 'other' ? 'Uploading…' : 'Upload another file'}
        </button>
        {done.other && <p className="text-xs text-emerald-700 mt-1">Received: {done.other}</p>}
        {errors.other && <p className="text-xs text-red-600 mt-1">{errors.other}</p>}
      </div>
      <p className="mt-5 text-[11px] text-slate-400">This link stops working on {formatDate(view.expiresAt.slice(0, 10), { year: true })}. Each file is limited to 10 MB.</p>
    </Panel>
  );
}

function ApproveView({ token, view }: { token: string; view: PublicJobView }) {
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<'approved' | 'rejected' | null>(null);
  const [error, setError] = useState('');

  const decide = async (decision: 'approved' | 'rejected') => {
    if (!name.trim()) {
      setError('Please enter your name.');
      return;
    }
    setBusy(true);
    setError('');
    const outcome = await approveViaPortal(token, { decision, name: name.trim(), note: note.trim() || undefined });
    setBusy(false);
    if (outcome.ok) setResult(decision);
    else setError(describePortalError(outcome.error ?? ''));
  };

  if (result) {
    return (
      <Panel>
        <Header view={view} intro="" />
        <p className={cn('flex items-center gap-2 text-sm font-medium', result === 'approved' ? 'text-emerald-700' : 'text-amber-700')} data-testid="portal-decided">
          {result === 'approved' ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
          {result === 'approved' ? 'Thank you — your approval has been recorded and your accountant has been told.' : 'Thank you — your accountant has been told you want changes.'}
        </p>
      </Panel>
    );
  }

  return (
    <Panel>
      <Header view={view} intro={view.approvalPending ? 'Please review and let us know whether you approve. Once approved, we will file.' : 'This work is not currently awaiting your approval.'} />
      {view.hasAttachment && (
        <a href={publicAttachmentUrl(token)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-surface px-3 h-9 text-sm font-medium text-slate-800 hover:border-primary-300" data-testid="portal-attachment">
          <FileText className="h-4 w-4 text-slate-500" /> Open the document to review
        </a>
      )}
      {view.approvalPending && (
        <form
          className="mt-5 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void decide('approved');
          }}
          noValidate
        >
          <label className="block">
            <span className="text-xs font-medium text-slate-600">Your name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full h-10 rounded-lg border border-slate-200 bg-surface px-3 text-sm" placeholder="As it should appear on the record" data-testid="portal-name" />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-600">Anything to add (optional)</span>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} className="mt-1 w-full rounded-lg border border-slate-200 bg-surface px-3 py-2 text-sm" data-testid="portal-note" />
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex flex-wrap gap-2 pt-1">
            <button type="submit" disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 h-10 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50" data-testid="portal-approve">
              <CheckCircle2 className="h-4 w-4" /> I approve
            </button>
            <button type="button" disabled={busy} onClick={() => void decide('rejected')} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-surface px-4 h-10 text-sm font-medium text-slate-800 hover:border-slate-300 disabled:opacity-50" data-testid="portal-reject">
              <XCircle className="h-4 w-4" /> I want changes
            </button>
          </div>
          <p className="text-[11px] text-slate-400">This can only be submitted once. The link stops working on {formatDate(view.expiresAt.slice(0, 10), { year: true })}.</p>
        </form>
      )}
    </Panel>
  );
}
