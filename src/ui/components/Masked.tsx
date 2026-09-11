import { useState } from 'react';
import { Eye, EyeOff, Copy, Check } from 'lucide-react';
import type { IdentifierKind } from '../../domain/types';
import { formatIdentifier, maskIdentifier } from '../../domain/rules';
import { useAppStore } from '../../application/store';

/**
 * Masked identifier with a deliberate reveal. Reveal is recorded in the audit
 * log. Display masking is a UX convenience, not a security control.
 */
export function MaskedValue({ value, kind, clientId, allowCopy = true }: { value: string; kind: IdentifierKind; clientId: string; allowCopy?: boolean }) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const record = useAppStore((s) => s.recordIdentifierReveal);
  const sensitive = kind !== 'company_number';
  const shown = revealed || !sensitive ? formatIdentifier(value, kind) : maskIdentifier(value, kind);

  const toggle = () => {
    if (!revealed) record(clientId, kind);
    setRevealed((r) => !r);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      if (!revealed && sensitive) record(clientId, kind);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="font-mono text-[13px] tabular text-slate-900 tracking-wide">{shown}</span>
      {sensitive && (
        <button type="button" onClick={toggle} className="rounded p-0.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100" aria-label={revealed ? 'Hide value' : 'Reveal value'} title={revealed ? 'Hide' : 'Reveal (audited)'}>
          {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </button>
      )}
      {allowCopy && (
        <button type="button" onClick={copy} className="rounded p-0.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100" aria-label="Copy value" title="Copy">
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      )}
    </span>
  );
}
