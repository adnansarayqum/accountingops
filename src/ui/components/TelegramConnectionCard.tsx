import { useCallback, useEffect, useState } from 'react';
import { Send } from 'lucide-react';
import { Card, CardBody, CardHeader } from './Card';
import { Button } from './Button';
import { Badge } from './Badge';
import { createTelegramLinkCode, getTelegramLink, getTelegramStatus } from '../../integrations/telegram';
import { formatDateTime } from '../../domain/dates';

/**
 * Connects the signed-in user's own Telegram account to the bot — one link
 * per user, not one for the whole practice the way HMRC's connection is.
 * Renders nothing without Telegram configured server-side, which includes
 * the whole browser-only mode.
 */
export function TelegramConnectionCard() {
  const [configured, setConfigured] = useState(false);
  const [linked, setLinked] = useState<{ linked: boolean; linkedAt: string | null } | null>(null);
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const status = await getTelegramStatus();
    setConfigured(status.configured);
    if (status.configured) setLinked(await getTelegramLink());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!configured) return null;

  const generateCode = async () => {
    setBusy(true);
    try {
      const result = await createTelegramLinkCode();
      if (!result) return;
      setCode(result);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card data-testid="telegram-connection">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            Telegram
            {linked?.linked ? <Badge tone="green">Connected</Badge> : <Badge tone="neutral">Not connected</Badge>}
          </span>
        }
        icon={<Send />}
        description="Send a photo of an HMRC letter to the bot and it files it for you to review in Smart Inbox."
        action={
          !linked?.linked && (
            <Button size="sm" onClick={() => void generateCode()} disabled={busy} data-testid="telegram-generate-code">
              Connect Telegram
            </Button>
          )
        }
      />
      <CardBody className="pt-0 text-[13px] text-slate-700 space-y-1.5">
        {linked?.linked ? (
          <p>Connected{linked.linkedAt ? ` on ${formatDateTime(linked.linkedAt)}` : ''}. Send a photo any time.</p>
        ) : code ? (
          <>
            <p>
              Open the bot in Telegram and send: <span className="font-mono font-semibold text-slate-900" data-testid="telegram-code">/start {code.code}</span>
            </p>
            <p className="text-slate-500">Valid until {formatDateTime(code.expiresAt)} — request a new one if it expires.</p>
          </>
        ) : (
          <p>Not connected yet — generate a code and send it to the bot to link this account.</p>
        )}
      </CardBody>
    </Card>
  );
}
