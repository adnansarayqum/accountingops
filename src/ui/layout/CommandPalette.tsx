import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Users, Briefcase, FileText, Sparkles, CornerDownLeft } from 'lucide-react';
import { useData, useDerived } from '../../application/selectors';
import { SERVICES, JOB_STATUS_LABELS } from '../../domain/catalog';
import { NAV_GROUPS } from './nav';
import { cn } from '../cn';

interface Result {
  id: string;
  kind: 'client' | 'job' | 'document' | 'page' | 'ask';
  title: string;
  subtitle?: string;
  to: string;
}

/**
 * Cmd/Ctrl+K search across clients, jobs, documents and pages. Identifier
 * matches (company number, UTR, VAT, PAYE) find the client without exposing
 * the identifier in the result.
 */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const data = useData();
  const derived = useDerived();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ('');
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  const results = useMemo<Result[]>(() => {
    const query = q.trim().toLowerCase();
    const compact = query.replace(/\s+/g, '');
    if (!query) {
      return NAV_GROUPS.flatMap((g) => g.items).map((i) => ({ id: i.to, kind: 'page' as const, title: i.label, subtitle: g(i.to), to: i.to }));
    }
    const out: Result[] = [];
    const isQuestion = /\?$|^(what|which|who|show|how|when)\b/.test(query);
    if (isQuestion || query.split(' ').length >= 3) out.push({ id: 'ask', kind: 'ask', title: `Ask the practice: “${q.trim()}”`, subtitle: 'Get an answer from your practice data', to: `/ask?q=${encodeURIComponent(q.trim())}` });

    for (const c of data.clients) {
      const contact = derived.primaryContactByClient.get(c.id);
      const idMatch = data.identifiers.filter((i) => i.clientId === c.id).find((i) => compact.length >= 4 && i.value.replace(/\s+/g, '').toLowerCase().includes(compact));
      const nameMatch = c.name.toLowerCase().includes(query) || (contact?.name.toLowerCase().includes(query) ?? false);
      if (nameMatch || idMatch) {
        out.push({ id: c.id, kind: 'client', title: c.name, subtitle: idMatch ? `Matched on ${idMatch.kind.replace(/_/g, ' ')} — open to reveal` : contact?.name, to: `/clients/${c.id}` });
      }
    }
    for (const v of derived.jobViews) {
      if (v.job.status === 'filed') continue;
      const hay = `${v.job.name} ${v.client.name} ${SERVICES[v.job.serviceCode].name}`.toLowerCase();
      if (hay.includes(query)) out.push({ id: v.job.id, kind: 'job', title: `${v.job.name} — ${v.client.name}`, subtitle: JOB_STATUS_LABELS[v.job.status], to: `/jobs/${v.job.id}` });
    }
    for (const d of data.documents) {
      if (d.fileName.toLowerCase().includes(query) || d.documentType.toLowerCase().includes(query)) {
        const client = derived.clientById.get(d.clientId);
        out.push({ id: d.id, kind: 'document', title: d.fileName, subtitle: `${d.documentType} · ${client?.name}`, to: d.jobId ? `/jobs/${d.jobId}` : `/clients/${d.clientId}` });
      }
    }
    for (const i of NAV_GROUPS.flatMap((g) => g.items)) {
      if (i.label.toLowerCase().includes(query)) out.push({ id: i.to, kind: 'page', title: i.label, to: i.to });
    }
    return out.slice(0, 14);
  }, [q, data, derived]);

  useEffect(() => setActive(0), [results.length]);

  const go = (r: Result) => {
    navigate(r.to);
    onClose();
  };

  if (!open) return null;
  const Icon = { client: Users, job: Briefcase, document: FileText, page: Search, ask: Sparkles };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] px-4" role="presentation">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]" onClick={onClose} aria-hidden="true" />
      <div role="dialog" aria-modal="true" aria-label="Search" className="relative w-full max-w-xl card shadow-pop overflow-hidden animate-in">
        <div className="flex items-center gap-3 px-4 border-b border-slate-100">
          <Search className="h-4 w-4 text-slate-400" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, results.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === 'Enter' && results[active]) {
                go(results[active]);
              }
            }}
            placeholder="Search clients, jobs, documents, company numbers… or ask a question"
            className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
            aria-label="Search"
            data-testid="command-input"
          />
          <kbd className="hidden sm:inline text-[10px] text-slate-400 border border-slate-200 rounded px-1.5 py-0.5">Esc</kbd>
        </div>
        <ul className="max-h-[50vh] overflow-y-auto py-2" role="listbox">
          {results.length === 0 && <li className="px-4 py-6 text-sm text-slate-500 text-center">No matches. Try a client name, job, company number or document.</li>}
          {results.map((r, i) => {
            const RIcon = Icon[r.kind];
            return (
              <li key={`${r.kind}-${r.id}`} role="option" aria-selected={i === active}>
                <button type="button" onMouseEnter={() => setActive(i)} onClick={() => go(r)} className={cn('w-full flex items-center gap-3 px-4 py-2 text-left', i === active ? 'bg-primary-50' : 'hover:bg-slate-50')}>
                  <span className={cn('h-7 w-7 rounded-md flex items-center justify-center shrink-0', r.kind === 'ask' ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-500')}>
                    <RIcon className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-slate-900 truncate">{r.title}</span>
                    {r.subtitle && <span className="block text-xs text-slate-500 truncate">{r.subtitle}</span>}
                  </span>
                  {i === active && <CornerDownLeft className="h-3.5 w-3.5 text-slate-400" />}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function g(to: string): string {
  return NAV_GROUPS.find((gr) => gr.items.some((i) => i.to === to))?.label ?? '';
}
