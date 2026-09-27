import { useCallback, useEffect, useState } from 'react';
import { Landmark } from 'lucide-react';
import { Card, CardBody, CardHeader } from './Card';
import { Button } from './Button';
import { Badge } from './Badge';
import { useAppStore } from '../../application/store';
import { hasPermission } from '../../application/auth';
import { disconnectHmrc, getHmrcConnectUrl, getHmrcStatus, type HmrcStatus } from '../../integrations/hmrcDeviceData';
import { formatDate } from '../../domain/dates';

/**
 * The practice's HMRC Making Tax Digital connection.
 *
 * One authorisation covers every client: HMRC authorise the agent services
 * account, and check the practice's authority over each individual client
 * themselves on every call. So this is a single connect/disconnect, not
 * something per client.
 *
 * Renders nothing without HMRC credentials configured, which includes the
 * whole browser-only mode.
 */
export function HmrcConnectionCard() {
  const toast = useAppStore((s) => s.toast);
  const canConnect = hasPermission(useAppStore((s) => s.authUser), 'hmrc.connect');
  const [status, setStatus] = useState<HmrcStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => setStatus(await getHmrcStatus()), []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!status?.configured) return null;

  const connect = async () => {
    setBusy(true);
    try {
      const url = await getHmrcConnectUrl();
      if (!url) {
        toast({ title: "Couldn't start the HMRC sign-in", description: 'The server did not return an authorisation URL.', tone: 'error' });
        return;
      }
      // HMRC's consent screen is their own page, so this leaves the app.
      window.location.assign(url);
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!window.confirm('Disconnect the HMRC agent account? VAT deadlines will stop updating until it is reconnected.')) return;
    setBusy(true);
    try {
      if (await disconnectHmrc()) {
        await load();
        toast({ title: 'HMRC disconnected', tone: 'success' });
      } else {
        toast({ title: "Couldn't disconnect HMRC", description: 'Only an owner can change the HMRC connection.', tone: 'error' });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card data-testid="hmrc-connection">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            HMRC (Making Tax Digital)
            {status.sandbox && <Badge tone="amber">Sandbox</Badge>}
            {status.connected ? <Badge tone="green">Connected</Badge> : <Badge tone="neutral">Not connected</Badge>}
          </span>
        }
        icon={<Landmark />}
        description="One authorisation covers every client — HMRC check the practice's authority over each one on every call."
        action={
          !canConnect ? undefined : status.connected ? (
            <Button variant="secondary" size="sm" onClick={() => void disconnect()} disabled={busy} data-testid="hmrc-disconnect">
              Disconnect
            </Button>
          ) : (
            <Button size="sm" onClick={() => void connect()} disabled={busy} data-testid="hmrc-connect">
              Connect HMRC
            </Button>
          )
        }
      />
      <CardBody className="pt-0 text-[13px] text-slate-700 space-y-1.5">
        {status.sandbox && (
          <p className="text-amber-700">
            Pointed at HMRC&rsquo;s sandbox. Obligations returned here are canned test scenarios, not real deadlines — nothing from this environment should be treated as a filing date.
          </p>
        )}
        {status.connected ? (
          <>
            <p>
              Connected{status.connectedAt ? ` on ${formatDate(status.connectedAt.slice(0, 10), { year: true })}` : ''}. Access lapses {status.expiresAt ? `at ${new Date(status.expiresAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : 'shortly'} and is renewed automatically
              {status.canRefresh ? '' : ' — no refresh token is stored, so this will need reconnecting by hand'}.
            </p>
            <p className="text-slate-500">VAT obligation dates come from HMRC&rsquo;s own record, so a changed stagger corrects itself instead of going stale.</p>
          </>
        ) : (
          <p>Connect the practice&rsquo;s agent services account to read VAT obligations — the filing periods and statutory due dates HMRC hold for each client.</p>
        )}
        {!canConnect && <p className="text-slate-500">Only an owner can connect or disconnect HMRC.</p>}
      </CardBody>
    </Card>
  );
}
