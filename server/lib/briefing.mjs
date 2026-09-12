/**
 * The morning briefing, as an email.
 *
 * The app has a good Briefing page that nobody sees unless they open the
 * app and navigate to it. This composes the same shape of digest from the
 * stored practice snapshot and decides when to send it, so the practice
 * gets it at the start of the day whether or not anyone has opened a tab.
 *
 * Deliberately a digest of facts — overdue, due this week, ready to file,
 * clients silent after a chase — and not a re-implementation of the
 * attention rules, which live in src/domain/rules and are the app's
 * business. The email says what is there and links to the app for why.
 *
 * Pure: `composeBriefing` takes a snapshot and a date, `shouldSendNow`
 * takes a clock. The scheduler that owns the interval is in
 * briefingScheduler.mjs, so everything here is testable without time.
 */

const DEFAULT_HOUR = 7;
const SILENT_AFTER_DAYS = 5;

function daysBetween(fromIso, toIso) {
  const a = Date.UTC(...fromIso.slice(0, 10).split('-').map((n, i) => Number(n) - (i === 1 ? 1 : 0)));
  const b = Date.UTC(...toIso.slice(0, 10).split('-').map((n, i) => Number(n) - (i === 1 ? 1 : 0)));
  return Math.round((b - a) / 86_400_000);
}

function formatDate(iso) {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function weekdayName(iso) {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
}

/**
 * The facts of the day. Everything is derived from the snapshot; nothing
 * is fetched, so the same input always gives the same email.
 */
export function composeBriefing(data, today, { appUrl = '' } = {}) {
  const clients = new Map((data?.clients ?? []).map((c) => [c.id, c]));
  const open = (data?.jobs ?? []).filter((j) => j.status !== 'filed' && clients.has(j.clientId));
  const withDays = open.map((j) => ({ job: j, client: clients.get(j.clientId), days: daysBetween(today, j.dueDate) })).sort((a, b) => a.days - b.days);

  const overdue = withDays.filter((x) => x.days < 0);
  const dueThisWeek = withDays.filter((x) => x.days >= 0 && x.days <= 7);
  const ready = withDays.filter((x) => x.job.status === 'ready_to_file');
  const waitingClients = new Set(open.filter((j) => j.waitingOn === 'client').map((j) => j.clientId));

  // Silent clients: the last outbound message is still awaiting a reply and
  // nothing has come in since — the same test the Briefing page applies.
  const comms = data?.communications ?? [];
  const silent = [];
  for (const client of clients.values()) {
    const theirs = comms.filter((c) => c.clientId === client.id).sort((a, b) => b.sentAt.localeCompare(a.sentAt));
    const lastOut = theirs.find((c) => c.direction === 'outbound');
    if (!lastOut || lastOut.responseStatus !== 'awaiting') continue;
    const inboundAfter = theirs.some((c) => c.direction === 'inbound' && c.sentAt > lastOut.sentAt);
    const silentDays = daysBetween(lastOut.sentAt, today);
    if (!inboundAfter && silentDays >= SILENT_AFTER_DAYS) silent.push({ client, silentDays });
  }
  silent.sort((a, b) => b.silentDays - a.silentDays);

  const link = (path) => (appUrl ? `${appUrl.replace(/\/$/, '')}${path}` : '');
  const line = (x) => `  - ${x.client.name} — ${x.job.name}${x.days < 0 ? ` (${-x.days} day${-x.days === 1 ? '' : 's'} overdue)` : x.days === 0 ? ' (today)' : ` (${x.days} day${x.days === 1 ? '' : 's'})`}`;

  const sections = [];
  sections.push(`${weekdayName(today)} briefing — ${formatDate(today)}`);
  sections.push('');
  sections.push(`Overdue: ${overdue.length}   Due this week: ${dueThisWeek.length}   Waiting on clients: ${waitingClients.size}   Ready to file: ${ready.length}   Silent 5+ days: ${silent.length}`);
  sections.push('');

  if (overdue.length > 0) {
    sections.push('OVERDUE');
    sections.push(...overdue.slice(0, 10).map(line));
    if (overdue.length > 10) sections.push(`  …and ${overdue.length - 10} more`);
    sections.push('');
  }
  if (dueThisWeek.length > 0) {
    sections.push('DUE THIS WEEK');
    sections.push(...dueThisWeek.slice(0, 10).map(line));
    if (dueThisWeek.length > 10) sections.push(`  …and ${dueThisWeek.length - 10} more`);
    sections.push('');
  }
  if (ready.length > 0) {
    sections.push('READY TO FILE');
    sections.push(...ready.slice(0, 10).map(line));
    sections.push('');
  }
  if (silent.length > 0) {
    sections.push("CLIENTS WHO HAVEN'T REPLIED");
    sections.push(...silent.slice(0, 10).map((s) => `  - ${s.client.name} — ${s.silentDays} days since we last chased`));
    sections.push('');
  }
  if (overdue.length === 0 && dueThisWeek.length === 0 && ready.length === 0 && silent.length === 0) {
    sections.push("Nothing pressing. A good day to get ahead on next month's work.");
    sections.push('');
  }
  if (appUrl) {
    sections.push(`Why each of these needs attention, and what to do next: ${link('/briefing')}`);
    sections.push('');
  }
  sections.push('You are getting this because morning briefings are switched on for your account. Turn them off in Settings → Account.');

  return {
    subject: `${weekdayName(today)} briefing: ${overdue.length} overdue, ${dueThisWeek.length} due this week, ${ready.length} ready to file`,
    body: sections.join('\n'),
    counts: { overdue: overdue.length, dueThisWeek: dueThisWeek.length, waitingClients: waitingClients.size, ready: ready.length, silent: silent.length },
  };
}

/** The calendar date and hour where the practice is, for a given instant. */
export function localParts(instant, timezone) {
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: timezone || 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false, weekday: 'short' });
  const parts = Object.fromEntries(fmt.formatToParts(instant).map((p) => [p.type, p.value]));
  const hour = Number(parts.hour) % 24;
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour, weekday: parts.weekday };
}

/**
 * Whether a briefing is due now for someone. Weekday mornings only, from
 * the send hour onwards, at most once per local day — and if the server
 * was asleep at seven, the first check afterwards sends it rather than
 * waiting until tomorrow.
 */
export function shouldSendNow({ now, timezone, lastSentOn, sendHour = DEFAULT_HOUR }) {
  const { date, hour, weekday } = localParts(now, timezone);
  if (weekday === 'Sat' || weekday === 'Sun') return { send: false, date };
  if (hour < sendHour) return { send: false, date };
  if (lastSentOn && String(lastSentOn).slice(0, 10) >= date) return { send: false, date };
  return { send: true, date };
}

export function isValidEmail(value) {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) && value.length <= 254;
}
