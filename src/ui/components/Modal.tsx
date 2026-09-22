import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '../cn';
import { useFocusTrap } from '../useFocusTrap';

export function Modal({ open, onClose, title, description, children, footer, size = 'md' }: { open: boolean; onClose: () => void; title: ReactNode; description?: ReactNode; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' }) {
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useFocusTrap(ref, open);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    const first = ref.current?.querySelector<HTMLElement>('input, textarea, select, button:not([data-close])');
    first?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);
  if (!open) return null;
  const width = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl' }[size];
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" role="presentation">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={onClose} aria-hidden="true" />
      {/* Capped to the viewport on a phone, with the body (not the page) as the
          thing that scrolls: min-h-0 lets the flex child shrink below its
          content height, which is what makes overflow-y-auto take effect. */}
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="modal-title" className={cn('relative w-full bg-surface shadow-pop rounded-t-2xl sm:rounded-2xl animate-in max-h-[100dvh] sm:max-h-[92vh] flex flex-col', width)}>
        <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-3 border-b border-slate-100 shrink-0">
          <div>
            <h2 id="modal-title" className="text-base font-semibold text-slate-900">
              {title}
            </h2>
            {description && <p className="text-[13px] text-slate-500 mt-0.5">{description}</p>}
          </div>
          <button data-close type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-5 py-4 overflow-y-auto flex-1 min-h-0">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-slate-100 flex flex-wrap items-center justify-end gap-2 bg-slate-50/60 rounded-b-2xl shrink-0">{footer}</div>}
      </div>
    </div>
  );
}
