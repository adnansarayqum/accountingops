/**
 * The device half of HMRC's fraud prevention headers.
 *
 * This app is "web application via server": the browser talks to our own
 * server, which calls HMRC. HMRC require headers describing the *end
 * user's* device — screen, window, timezone, browser user agent, and a
 * stable device identifier — none of which a server can know. So the
 * browser collects them and posts them with each request; the server
 * formats and signs them into the header set (see
 * server/lib/hmrc/fraudPreventionHeaders.mjs).
 *
 * The device id is a random UUID kept in localStorage. It identifies the
 * browser, not the person: no name, no account, nothing derived from
 * practice data. It persists because HMRC want the same device to look
 * like the same device across sessions.
 */

const DEVICE_ID_KEY = 'practiceops.hmrc.deviceId';

export interface HmrcScreen {
  width: number;
  height: number;
  'scaling-factor': number;
  'colour-depth': number;
}

export interface HmrcDeviceData {
  deviceId: string;
  userAgent: string;
  /** Minutes behind UTC, as Date#getTimezoneOffset reports it; the server formats it. */
  timezoneOffsetMinutes: number;
  screens: HmrcScreen[];
  windowSize: { width: number; height: number };
}

function readOrCreateDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const created = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, created);
    return created;
  } catch {
    // Private browsing, or storage disabled. A fresh id per call is worse
    // than a stable one but far better than sending none, which would fail
    // the header check outright.
    return crypto.randomUUID();
  }
}

/**
 * Collects what HMRC ask for. Every value is read defensively — a headless
 * or unusual browser that reports nothing useful should still produce a
 * well-formed set rather than throwing partway through.
 */
export function collectDeviceData(): HmrcDeviceData {
  const screens: HmrcScreen[] = [
    {
      width: Math.max(0, Math.round(window.screen?.width ?? 0)),
      height: Math.max(0, Math.round(window.screen?.height ?? 0)),
      'scaling-factor': window.devicePixelRatio ?? 1,
      'colour-depth': window.screen?.colorDepth ?? 24,
    },
  ];
  return {
    deviceId: readOrCreateDeviceId(),
    userAgent: navigator.userAgent ?? '',
    timezoneOffsetMinutes: new Date().getTimezoneOffset(),
    screens,
    windowSize: {
      width: Math.max(0, Math.round(window.innerWidth ?? 0)),
      height: Math.max(0, Math.round(window.innerHeight ?? 0)),
    },
  };
}

export interface HmrcStatus {
  configured: boolean;
  /** True while pointed at HMRC's sandbox, where obligations are canned scenarios rather than real deadlines. */
  sandbox: boolean;
  connected?: boolean;
  expiresAt?: string;
  connectedAt?: string;
  connectedBy?: string;
  canRefresh?: boolean;
}

export interface VatObligation {
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  periodKey: string;
  fulfilled: boolean;
  receivedOn: string | null;
}

async function safeJson<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function getHmrcStatus(): Promise<HmrcStatus> {
  try {
    const res = await fetch('/api/hmrc/status');
    if (!res.ok) return { configured: false, sandbox: true };
    return (await safeJson<HmrcStatus>(res)) ?? { configured: false, sandbox: true };
  } catch {
    return { configured: false, sandbox: true };
  }
}

/** The URL to send the user to for HMRC consent. Null when the app can't start the round trip. */
export async function getHmrcConnectUrl(): Promise<string | null> {
  try {
    const res = await fetch('/api/hmrc/connect');
    if (!res.ok) return null;
    return (await safeJson<{ url: string }>(res))?.url ?? null;
  } catch {
    return null;
  }
}

export async function disconnectHmrc(): Promise<boolean> {
  try {
    const res = await fetch('/api/hmrc/disconnect', { method: 'POST' });
    return res.ok;
  } catch {
    return false;
  }
}

export type VatObligationsOutcome = 'ok' | 'not_connected' | 'client_not_authorised' | 'invalid_vrn' | 'fraud_headers_incomplete' | 'unavailable';

export interface VatObligationsResult {
  outcome: VatObligationsOutcome;
  obligations: VatObligation[];
  /** Present when the outcome is fraud_headers_incomplete — which headers were missing. */
  missing?: string[];
}

/**
 * A client's VAT obligations. A POST for what reads like a GET, because the
 * device data above travels with it. Reports why it failed rather than
 * returning an empty list: "no obligations" and "this client has not
 * authorised us" must not look the same on screen.
 */
export async function getVatObligations(vrn: string, options: { testScenario?: string } = {}): Promise<VatObligationsResult> {
  try {
    const res = await fetch(`/api/hmrc/vat/${encodeURIComponent(vrn)}/obligations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device: collectDeviceData(), status: 'open', testScenario: options.testScenario }),
    });
    const body = await safeJson<{ obligations?: VatObligation[]; error?: string; missing?: string[] }>(res);
    if (res.ok) return { outcome: 'ok', obligations: body?.obligations ?? [] };
    const error = body?.error;
    const outcome: VatObligationsOutcome =
      error === 'not_connected' || error === 'refresh_failed'
        ? 'not_connected'
        : error === 'client_not_authorised'
          ? 'client_not_authorised'
          : error === 'invalid_vrn'
            ? 'invalid_vrn'
            : error === 'fraud_headers_incomplete'
              ? 'fraud_headers_incomplete'
              : 'unavailable';
    return { outcome, obligations: [], missing: body?.missing };
  } catch {
    return { outcome: 'unavailable', obligations: [] };
  }
}
