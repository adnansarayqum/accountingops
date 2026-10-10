import { useEffect, useState } from 'react';
import { Smartphone } from 'lucide-react';
import { Card, CardBody, CardHeader } from './Card';
import { Button } from './Button';
import { Badge } from './Badge';

/** Chrome's install prompt; not in the DOM typings. */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function isInstalled(): boolean {
  return typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);
}

/**
 * Installing the app on a phone is what puts "F&R Ops" in WhatsApp's and
 * the email app's share sheet (Android). Offers Chrome's own install
 * prompt when the browser has one ready, and says how otherwise.
 */
export function InstallAppCard() {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(isInstalled);

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setPrompt(null);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const install = async () => {
    if (!prompt) return;
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === 'accepted') setInstalled(true);
    setPrompt(null);
  };

  return (
    <Card data-testid="install-app">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            Phone app
            {installed && <Badge tone="green">Installed</Badge>}
          </span>
        }
        icon={<Smartphone />}
        description="Install the app on your phone, then share bank statements, letters and messages straight in from WhatsApp or your email app."
        action={
          prompt &&
          !installed && (
            <Button size="sm" onClick={() => void install()} data-testid="install-app-button">
              Install
            </Button>
          )
        }
      />
      <CardBody className="pt-0 text-[13px] text-slate-700 space-y-1.5">
        {installed ? (
          <p>Installed. On Android, choose “F&R Ops” when you share something from WhatsApp or email.</p>
        ) : (
          <>
            <p>
              <span className="font-medium">Android:</span> open this page in Chrome, tap the ⋮ menu, then “Install app”. “F&R Ops” then appears when you share from WhatsApp or email.
            </p>
            <p>
              <span className="font-medium">iPhone:</span> in Safari, tap Share, then “Add to Home Screen”. Sharing in from an iPhone uses a Shortcut, coming next.
            </p>
          </>
        )}
      </CardBody>
    </Card>
  );
}
