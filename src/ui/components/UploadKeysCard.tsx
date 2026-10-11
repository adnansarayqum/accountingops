import { useEffect, useState } from 'react';
import { Copy, KeyRound, Trash2 } from 'lucide-react';
import { Card, CardBody, CardHeader } from './Card';
import { Button } from './Button';
import { Input } from './Form';
import { useAppStore } from '../../application/store';
import { createUploadKey, listUploadKeys, revokeUploadKey, type UploadKey } from '../../integrations/intake';
import { formatAgo } from '../../domain/dates';
import { useToday } from '../../application/selectors';

/**
 * iPhones can't make an installed web app a share target, so on an iPhone
 * the way in is a Shortcut in the share sheet that sends the files here.
 * A Shortcut has no signed-in session, so it carries a personal key made
 * here: shown once, revocable, and good for one thing — sending a share.
 *
 * Renders nothing in the browser-only mode, where there is no server to
 * send to.
 */
export function UploadKeysCard() {
  const toast = useAppStore((s) => s.toast);
  const today = useToday();
  const [keys, setKeys] = useState<UploadKey[] | null>(null);
  const [label, setLabel] = useState('');
  const [fresh, setFresh] = useState<{ token: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void listUploadKeys().then((list) => {
      if (!cancelled) setKeys(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!keys) return null;

  const make = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const made = await createUploadKey(label.trim());
      if (!made.ok) {
        toast({ title: made.error === 'too_many' ? 'That is five keys already' : "Couldn't make a key", description: made.error === 'too_many' ? 'Remove one you no longer use first.' : undefined, tone: 'error' });
        return;
      }
      setKeys([made.key, ...keys]);
      setFresh({ token: made.token });
      setLabel('');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (key: UploadKey) => {
    if (!(await revokeUploadKey(key.id))) {
      toast({ title: "Couldn't remove that key", tone: 'error' });
      return;
    }
    setKeys(keys.filter((k) => k.id !== key.id));
    toast({ title: 'Key removed', description: `${key.label} can no longer send anything.`, tone: 'success' });
  };

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: `${what} copied`, tone: 'success' });
    } catch {
      toast({ title: "Couldn't copy", description: 'Select it and copy by hand.', tone: 'error' });
    }
  };

  const url = `${window.location.origin}/api/intake/batches`;

  return (
    <Card data-testid="upload-keys">
      <CardHeader title="Send from an iPhone" description="A Shortcut in the share sheet that sends WhatsApp and Mail files here. Android doesn't need this — install the app instead." icon={<KeyRound />} />
      <CardBody className="pt-0 space-y-4 text-[13px] text-slate-700">
        <form onSubmit={make} className="flex flex-col sm:flex-row gap-2">
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Name this phone, e.g. Ray’s iPhone" maxLength={60} aria-label="Name for the new key" data-testid="upload-key-label" className="sm:max-w-xs" />
          <Button type="submit" disabled={busy} data-testid="upload-key-make">
            Make a key
          </Button>
        </form>

        {fresh && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-2" role="status" data-testid="upload-key-fresh">
            <p className="font-medium text-amber-900">Copy this key now — it is only shown once.</p>
            <div className="flex flex-col sm:flex-row gap-2">
              <code className="flex-1 min-w-0 break-all rounded bg-white border border-amber-200 px-2 py-1.5 text-xs" data-testid="upload-key-token">
                {fresh.token}
              </code>
              <Button size="sm" variant="secondary" icon={<Copy />} onClick={() => copy(fresh.token, 'Key')}>
                Copy key
              </Button>
            </div>
          </div>
        )}

        {keys.length > 0 && (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200" data-testid="upload-key-list">
            {keys.map((k) => (
              <li key={k.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <p className="font-medium text-slate-900 truncate">{k.label}</p>
                  <p className="text-xs text-slate-500">{k.lastUsedAt ? `Last used ${formatAgo(k.lastUsedAt, today)}` : 'Not used yet'}</p>
                </div>
                <Button size="sm" variant="ghost" icon={<Trash2 />} onClick={() => revoke(k)} aria-label={`Remove ${k.label}`}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}

        <div>
          <p className="font-semibold text-slate-900 mb-1">Set up the Shortcut (once, about five minutes)</p>
          <ol className="list-decimal pl-5 space-y-1.5">
            <li>Make a key above and copy it.</li>
            <li>
              On the iPhone open <strong>Shortcuts</strong>, tap <strong>+</strong> and name it <strong>Send to F&amp;R</strong>. In its settings turn on <strong>Show in Share Sheet</strong> and let it receive <strong>Images, PDFs and Text</strong>.
            </li>
            <li>
              If you share photos from the Photos app, add <strong>Convert Image</strong> first, set to <strong>JPEG</strong> — the app can't read the iPhone's default HEIC. Photos already sent through WhatsApp are JPEG and don't need it.
            </li>
            <li>
              Add <strong>Get Contents of URL</strong>. URL:{' '}
              <button type="button" onClick={() => copy(url, 'Address')} className="font-mono text-xs text-primary-700 hover:underline break-all text-left" data-testid="upload-key-url">
                {url}
              </button>
            </li>
            <li>
              Tap <strong>Show More</strong>: Method <strong>POST</strong>. Add a header <strong>Authorization</strong> with the value <code className="font-mono text-xs">Bearer</code> then a space then your key. Request Body: <strong>Form</strong>, and add a <strong>File</strong> field named <code className="font-mono text-xs">file</code> set to <strong>Shortcut Input</strong>.
            </li>
            <li>
              Add <strong>Get Dictionary Value</strong> for <code className="font-mono text-xs">message</code> from the contents of the URL, then <strong>Show Notification</strong> with it. It says where the document was filed, or what went wrong.
            </li>
            <li>
              In WhatsApp or Mail, share a file, choose <strong>Send to F&amp;R</strong>. The document then appears in Smart Inbox here.
            </li>
          </ol>
          <p className="mt-2 text-xs text-slate-500">Lost the phone, or think someone has the key? Remove it here — it stops working at once. Signing out everywhere, or changing your password, removes every key.</p>
        </div>
      </CardBody>
    </Card>
  );
}
