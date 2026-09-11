import { CheckCircle2, Info, AlertTriangle, X } from 'lucide-react';
import { useAppStore } from '../../application/store';
import { cn } from '../cn';

export function Toaster() {
  const toasts = useAppStore((s) => s.toasts);
  const dismiss = useAppStore((s) => s.dismissToast);
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-4 right-4 left-4 sm:left-auto z-[60] flex flex-col gap-2 sm:w-96" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={cn('animate-toast card flex items-start gap-3 px-4 py-3 shadow-pop border-l-4', t.tone === 'success' ? 'border-l-emerald-500' : t.tone === 'error' ? 'border-l-red-500' : 'border-l-primary-500')}>
          <span className={cn('mt-0.5 shrink-0', t.tone === 'success' ? 'text-emerald-600' : t.tone === 'error' ? 'text-red-600' : 'text-primary-600')}>
            {t.tone === 'success' ? <CheckCircle2 className="h-4 w-4" /> : t.tone === 'error' ? <AlertTriangle className="h-4 w-4" /> : <Info className="h-4 w-4" />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-slate-900">{t.title}</p>
            {t.description && <p className="text-[13px] text-slate-600 mt-0.5">{t.description}</p>}
          </div>
          <button type="button" onClick={() => dismiss(t.id)} aria-label="Dismiss" className="text-slate-400 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
