/**
 * HMRC fraud prevention headers.
 *
 * HMRC require these on every Making Tax Digital call, and they audit them
 * before issuing production credentials — an incomplete or badly-formatted
 * set is the single most common reason an application is refused. So this
 * module builds them in one place, and `missingHeaders` lets the caller
 * refuse to make the call rather than send a set that would fail the audit
 * silently.
 *
 * This app is "web application via server": a browser talks to our own
 * server, which calls HMRC. That connection method has its own mandatory
 * list (below), and crucially several of the values describe the *end
 * user's* device, which a server cannot know — screen size, window size,
 * timezone, browser user agent. Those are collected in the browser and
 * passed through; see src/integrations/hmrcDeviceData.ts.
 *
 * Encoding rule, from the HMRC guidance: every key and value in a
 * key-value header is percent-encoded, but the separators (= and &) are
 * not. Lists of structures are comma-separated.
 *
 * Reference:
 *   developer.service.hmrc.gov.uk/guides/fraud-prevention/connection-method/web-app-via-server/
 */

export const CONNECTION_METHOD = 'WEB_APP_VIA_SERVER';

/**
 * Every header HMRC list as mandatory for this connection method. Used both
 * to build and to check: sending fifteen of sixteen fails the audit just as
 * surely as sending none.
 */
export const REQUIRED_HEADERS = [
  'Gov-Client-Connection-Method',
  'Gov-Client-Browser-JS-User-Agent',
  'Gov-Client-Device-ID',
  'Gov-Client-Multi-Factor',
  'Gov-Client-Public-IP',
  'Gov-Client-Public-IP-Timestamp',
  'Gov-Client-Public-Port',
  'Gov-Client-Screens',
  'Gov-Client-Timezone',
  'Gov-Client-User-IDs',
  'Gov-Client-Window-Size',
  'Gov-Vendor-Forwarded',
  'Gov-Vendor-License-IDs',
  'Gov-Vendor-Product-Name',
  'Gov-Vendor-Public-IP',
  'Gov-Vendor-Version',
];

/** Percent-encodes a key or a value, leaving the separators alone. */
export function encodeComponent(value) {
  return encodeURIComponent(String(value ?? ''));
}

/**
 * One key-value structure: `width=1920&height=1080`. Pairs with an
 * empty or absent value are dropped rather than sent as `key=`, which
 * reads to the validator as a malformed structure.
 */
export function keyValue(pairs) {
  return Object.entries(pairs)
    .filter(([, value]) => value !== undefined && value !== null && String(value) !== '')
    .map(([key, value]) => `${encodeComponent(key)}=${encodeComponent(value)}`)
    .join('&');
}

/** A list of key-value structures, comma-separated: two screens, two hops. */
export function keyValueList(items) {
  return items
    .map((item) => keyValue(item))
    .filter(Boolean)
    .join(',');
}

/**
 * A timezone as HMRC want it: `UTC+01:00`. Takes the offset in minutes as
 * JavaScript reports it (`Date#getTimezoneOffset`, which is inverted —
 * UTC+1 is reported as -60), so callers can pass it straight through.
 */
export function formatTimezone(offsetMinutesBehindUtc) {
  const minutes = Number(offsetMinutesBehindUtc);
  if (!Number.isFinite(minutes)) return null;
  const ahead = -minutes;
  const sign = ahead < 0 ? '-' : '+';
  const abs = Math.abs(ahead);
  return `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

/** An IPv4-mapped IPv6 address ("::ffff:1.2.3.4") is really the IPv4 one; HMRC want the address the user actually has. */
export function normaliseIp(ip) {
  if (typeof ip !== 'string' || !ip.trim()) return null;
  const trimmed = ip.trim();
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(trimmed);
  return mapped ? mapped[1] : trimmed;
}

/**
 * Builds the full set. Anything the caller couldn't supply is simply
 * absent from the result — `missingHeaders` is what turns that into a
 * refusal, so a partial set can never be sent by accident.
 */
export function buildFraudPreventionHeaders(input) {
  const {
    device = {},
    clientPublicIp,
    clientPublicPort,
    vendorPublicIp,
    forwarded = [],
    productName,
    vendorVersion = {},
    licenseIds = {},
    userIds = {},
    multiFactor = [],
    now = () => new Date(),
  } = input ?? {};

  const headers = {
    'Gov-Client-Connection-Method': CONNECTION_METHOD,
    'Gov-Client-Browser-JS-User-Agent': device.userAgent || undefined,
    'Gov-Client-Device-ID': device.deviceId || undefined,
    // HMRC require the header even when no MFA is in play; an empty list is
    // the documented way to say "none", and omitting it fails the check.
    'Gov-Client-Multi-Factor': keyValueList(multiFactor),
    'Gov-Client-Public-IP': normaliseIp(clientPublicIp) ?? undefined,
    'Gov-Client-Public-IP-Timestamp': now().toISOString(),
    'Gov-Client-Public-Port': clientPublicPort ? String(clientPublicPort) : undefined,
    'Gov-Client-Screens': keyValueList(device.screens ?? []),
    'Gov-Client-Timezone': device.timezone || undefined,
    'Gov-Client-User-IDs': keyValue(userIds),
    'Gov-Client-Window-Size': device.windowSize ? keyValue(device.windowSize) : undefined,
    'Gov-Vendor-Forwarded': keyValueList(forwarded),
    'Gov-Vendor-License-IDs': keyValue(licenseIds),
    'Gov-Vendor-Product-Name': productName ? encodeComponent(productName) : undefined,
    'Gov-Vendor-Public-IP': normaliseIp(vendorPublicIp) ?? undefined,
    'Gov-Vendor-Version': keyValue(vendorVersion),
  };

  // An empty string is "I had nothing to put here", which is not the same as
  // a value — drop it so missingHeaders catches it rather than HMRC does.
  // Gov-Client-Multi-Factor is the exception: an empty list is a real answer
  // ("no MFA on this sign-in"), so it stays, and missingHeaders accepts it.
  for (const [key, value] of Object.entries(headers)) {
    if (key === 'Gov-Client-Multi-Factor') continue;
    if (value === undefined || value === '') delete headers[key];
  }
  return headers;
}

/**
 * Which mandatory headers are absent. A non-empty result means the call
 * should not be made: HMRC would accept it in the sandbox and reject the
 * application at approval time, which is the worst place to find out.
 *
 * `Gov-Client-Multi-Factor` is the one exception — an empty list is a
 * legitimate value meaning "no MFA", so it counts as present when the
 * caller explicitly supplied one.
 */
export function missingHeaders(headers) {
  return REQUIRED_HEADERS.filter((name) => {
    const value = headers?.[name];
    // An empty multi-factor list means "no MFA", which is a value; every
    // other header has to actually carry one.
    if (name === 'Gov-Client-Multi-Factor') return value === undefined || value === null;
    return value === undefined || value === null || value === '';
  });
}

/** True when every mandatory header carries a value HMRC would accept. */
export function isComplete(headers) {
  return missingHeaders(headers).length === 0;
}
