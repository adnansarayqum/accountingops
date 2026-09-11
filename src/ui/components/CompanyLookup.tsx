import { useEffect, useRef, useState } from 'react';
import { Search, Building2, CheckCircle2, Loader2, X } from 'lucide-react';
import { Input } from './Form';
import { Badge } from './Badge';
import { searchCompanies, getCompanyProfile, formatAccountingReferenceDate } from '../../integrations/companiesHouse';
import type { CompanyProfile, CompanySearchResult } from '../../integrations/companiesHouseTypes';

/**
 * Type a company name, pick a match, and get back its Companies House
 * profile (company number, registered office, incorporation date, next
 * accounts/confirmation statement dates). Falls back to a clearly-labelled
 * demo dataset when no live API key is configured — see
 * docs/INTEGRATIONS.md.
 */
export function CompanyLookup({ onSelect, id }: { onSelect: (profile: CompanyProfile) => void; id?: string }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<CompanySearchResult[]>([]);
  const [source, setSource] = useState<'companies_house' | 'demo' | null>(null);
  const [selected, setSelected] = useState<CompanyProfile | null>(null);
  const [resolving, setResolving] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (selected) return;
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSource(null);
      setOpen(false);
      return;
    }
    setLoading(true);
    const timer = setTimeout(() => {
      searchCompanies(q).then((res) => {
        setResults(res.results);
        setSource(res.source);
        setOpen(true);
        setLoading(false);
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [query, selected]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const pick = async (result: CompanySearchResult) => {
    setOpen(false);
    setResolving(result.companyNumber);
    const profile = await getCompanyProfile(result.companyNumber);
    setResolving(null);
    if (!profile) return;
    setSelected(profile);
    setQuery(profile.companyName);
    onSelect(profile);
  };

  const clear = () => {
    setSelected(null);
    setQuery('');
    setResults([]);
  };

  return (
    <div className="relative" ref={containerRef}>
      {!selected ? (
        <>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              id={id}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => results.length > 0 && setOpen(true)}
              placeholder="Search Companies House by company name…"
              className="pl-9"
              aria-label="Search Companies House"
              data-testid="company-lookup-input"
            />
            {loading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 animate-spin" />}
          </div>
          {open && (
            <div className="absolute z-20 mt-1 w-full card shadow-pop overflow-hidden" data-testid="company-lookup-results">
              {results.length === 0 ? (
                <p className="px-3 py-3 text-[13px] text-slate-500">No matches. You can still fill in the details below by hand.</p>
              ) : (
                <>
                  <ul className="max-h-64 overflow-y-auto divide-y divide-slate-100">
                    {results.map((r) => (
                      <li key={r.companyNumber}>
                        <button type="button" onClick={() => pick(r)} className="w-full flex items-start gap-2.5 px-3 py-2.5 text-left hover:bg-slate-50" data-testid={`company-result-${r.companyNumber}`}>
                          <Building2 className="h-4 w-4 text-slate-400 mt-0.5 shrink-0" />
                          <span className="min-w-0">
                            <span className="block text-[13px] font-medium text-slate-900 truncate">{r.title}</span>
                            <span className="block text-xs text-slate-500">
                              {r.companyNumber}
                              {r.addressSnippet ? ` · ${r.addressSnippet}` : ''}
                              {r.companyStatus && r.companyStatus !== 'active' ? ` · ${r.companyStatus}` : ''}
                            </span>
                          </span>
                          {resolving === r.companyNumber && <Loader2 className="h-3.5 w-3.5 text-slate-400 animate-spin ml-auto shrink-0" />}
                        </button>
                      </li>
                    ))}
                  </ul>
                  <div className="px-3 py-1.5 border-t border-slate-100 bg-slate-50/60">
                    <SourceBadge source={source} />
                  </div>
                </>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2.5" data-testid="company-lookup-selected">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-start gap-2 min-w-0">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-slate-900 truncate">{selected.companyName}</p>
                <p className="text-xs text-slate-600">
                  {selected.companyNumber}
                  {selected.registeredOfficeAddress ? ` · ${selected.registeredOfficeAddress.formatted}` : ''}
                </p>
                {selected.accountingReferenceDate && <p className="text-xs text-slate-600 mt-0.5">Year end: {formatAccountingReferenceDate(selected.accountingReferenceDate)}</p>}
              </div>
            </div>
            <button type="button" onClick={clear} className="text-slate-400 hover:text-slate-600 shrink-0" aria-label="Clear company lookup">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-1.5">
            <SourceBadge source={selected.source} />
          </div>
        </div>
      )}
    </div>
  );
}

function SourceBadge({ source }: { source: 'companies_house' | 'demo' | null }) {
  if (!source) return null;
  return source === 'companies_house' ? (
    <Badge tone="green" dot>
      Live from Companies House
    </Badge>
  ) : (
    <Badge tone="amber" title="No Companies House API key is configured — see docs/INTEGRATIONS.md">
      Demo data — not a live lookup
    </Badge>
  );
}

