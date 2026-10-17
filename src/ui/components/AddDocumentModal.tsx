import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, FolderOpen, Send, X } from 'lucide-react';
import { Modal } from './Modal';
import { Button } from './Button';
import { Textarea } from './Form';
import { sendableType } from '../../application/sharedFiles';
import { stashPendingShare } from '../../application/pendingShare';

/** The most the server takes in one share (server/lib/intake.mjs MAX_FILES_PER_BATCH). */
export const MAX_PAGES = 10;

/**
 * Add a document without leaving the app: take a photo of a letter (one per
 * page, as many as it takes), pick photos or PDFs from the phone, or paste
 * what a client wrote. Goes to the same share page as a share from WhatsApp
 * — which reads it, says which client it is for, and lets the client be
 * changed — so there is one way a document gets in, however it arrived.
 */
export function AddDocumentModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const camera = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  // Start fresh each time it opens.
  useEffect(() => {
    if (open) {
      setFiles([]);
      setText('');
      setProblem(null);
    }
  }, [open]);

  const previews = useMemo(() => files.map((file) => ({ file, url: file.type.startsWith('image/') ? URL.createObjectURL(file) : null })), [files]);
  useEffect(() => () => previews.forEach((p) => p.url && URL.revokeObjectURL(p.url)), [previews]);

  const add = (picked: FileList | null) => {
    if (!picked || picked.length === 0) return;
    const readable: File[] = [];
    const unreadable: File[] = [];
    for (const file of Array.from(picked)) {
      if (sendableType(file)) readable.push(file);
      else unreadable.push(file);
    }
    const room = MAX_PAGES - files.length;
    setFiles((current) => [...current, ...readable.slice(0, Math.max(room, 0))]);
    if (unreadable.length > 0) setProblem(`Left out — the app can only read photos, PDFs and plain text: ${unreadable.map((f) => f.name).join(', ')}.`);
    else if (readable.length > room) setProblem(`That is more than ${MAX_PAGES} pages — only the first ${Math.max(room, 0)} were added. Send these, then add the rest as a separate document.`);
    else setProblem(null);
  };

  const remove = (index: number) => setFiles((current) => current.filter((_, i) => i !== index));

  const send = () => {
    if (files.length === 0 && !text.trim()) return;
    const id = stashPendingShare({ files, text: text.trim() });
    onClose();
    navigate(`/share?id=${id}`);
  };

  const anything = files.length > 0 || text.trim().length > 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a document"
      description="Photograph a letter or statement, or pick files from your phone. The app reads it and files it under the right client."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button icon={<Send />} onClick={send} disabled={!anything} data-testid="add-document-send">
            {files.length > 1 ? `Send ${files.length} pages` : 'Send'}
          </Button>
        </>
      }
    >
      <div className="space-y-4" data-testid="add-document">
        {/* capture="environment" opens the back camera on a phone; a desktop browser just opens its file picker. */}
        <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden" data-testid="add-document-camera-input" onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
        <input ref={picker} type="file" accept="image/*,application/pdf,text/plain,.pdf,.txt" multiple className="hidden" data-testid="add-document-file-input" onChange={(e) => { add(e.target.files); e.target.value = ''; }} />

        <div className="grid gap-2 sm:grid-cols-2">
          <Button size="lg" icon={<Camera />} onClick={() => camera.current?.click()} disabled={files.length >= MAX_PAGES} data-testid="add-document-camera">
            {files.length === 0 ? 'Take a photo' : 'Photograph the next page'}
          </Button>
          <Button size="lg" variant="secondary" icon={<FolderOpen />} onClick={() => picker.current?.click()} disabled={files.length >= MAX_PAGES} data-testid="add-document-files">
            Choose photos or files
          </Button>
        </div>

        {previews.length > 0 && (
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4" data-testid="add-document-pages">
            {previews.map((p, index) => (
              <li key={`${p.file.name}-${index}`} className="relative rounded-lg border border-slate-200 bg-slate-50 overflow-hidden aspect-[3/4] flex items-center justify-center" data-testid={`add-document-page-${index}`}>
                {p.url ? <img src={p.url} alt={`Page ${index + 1}`} className="h-full w-full object-cover" /> : <span className="px-2 text-center text-[11px] text-slate-600 break-all">{p.file.name}</span>}
                <span className="absolute left-1 bottom-1 rounded bg-black/60 px-1.5 text-[10px] font-medium text-white">{index + 1}</span>
                <button type="button" onClick={() => remove(index)} aria-label={`Remove page ${index + 1}`} className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white hover:bg-black/80">
                  <X className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {problem && (
          <p className="text-[13px] text-amber-800" role="alert" data-testid="add-document-problem">
            {problem}
          </p>
        )}

        <div>
          <label htmlFor="add-document-text" className="text-[13px] font-medium text-slate-700">
            Or paste a message the client sent
          </label>
          <Textarea id="add-document-text" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. our new address is…" className="mt-1.5" data-testid="add-document-text" />
        </div>

        <p className="text-xs text-slate-500">Pages of one document go together: photograph them in order. Different documents are sent separately.</p>
      </div>
    </Modal>
  );
}
