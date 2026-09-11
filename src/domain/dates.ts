import type { IsoDate, IsoDateTime } from './types';

const DAY_MS = 86_400_000;

export function toIsoDate(d: Date): IsoDate {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseIsoDate(iso: IsoDate): Date {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(iso: IsoDate, days: number): IsoDate {
  const d = parseIsoDate(iso);
  d.setDate(d.getDate() + days);
  return toIsoDate(d);
}

export function addMonths(iso: IsoDate, months: number): IsoDate {
  const d = parseIsoDate(iso);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return toIsoDate(d);
}

/** Whole days from `from` to `to` (positive when `to` is in the future). */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  const a = startOfDay(parseIsoDate(from)).getTime();
  const b = startOfDay(parseIsoDate(to)).getTime();
  return Math.round((b - a) / DAY_MS);
}

export function daysUntil(due: IsoDate, today: IsoDate): number {
  return daysBetween(today, due);
}

export function daysSince(when: IsoDateTime | IsoDate, today: IsoDate): number {
  // A timestamp is UTC; `today` is a local calendar date. Slicing the first
  // ten characters off a timestamp mixes the two, so an event at 00:30 BST
  // reads as the previous day. Convert to the local date first.
  const day = when.length > 10 ? toIsoDate(new Date(when)) : when;
  return daysBetween(day, today);
}

export function isoDateTimeDaysAgo(today: IsoDate, days: number, hour = 9, minute = 0): IsoDateTime {
  const d = parseIsoDate(today);
  d.setDate(d.getDate() - days);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

export function nowIso(): IsoDateTime {
  return new Date().toISOString();
}

export function todayIso(): IsoDate {
  return toIsoDate(new Date());
}

const monthsShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatDate(iso: IsoDate | IsoDateTime | undefined, opts: { year?: boolean } = {}): string {
  if (!iso) return '—';
  const d = iso.length > 10 ? new Date(iso) : parseIsoDate(iso);
  const base = `${d.getDate()} ${monthsShort[d.getMonth()]}`;
  return opts.year === false ? base : `${base} ${d.getFullYear()}`;
}

export function formatDateTime(iso: IsoDateTime): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${formatDate(iso)}, ${hh}:${mm}`;
}

export function formatRelativeDue(due: IsoDate, today: IsoDate): string {
  const n = daysUntil(due, today);
  if (n === 0) return 'Due today';
  if (n === 1) return 'Due tomorrow';
  if (n < 0) return `Overdue by ${Math.abs(n)} day${Math.abs(n) === 1 ? '' : 's'}`;
  return `Due in ${n} days`;
}

/**
 * Clock-granularity "how long ago", for timestamps where hours and minutes
 * matter (a data sync, say) rather than the day-granularity formatAgo used
 * for client correspondence.
 */
export function formatSince(iso: IsoDateTime, now: Date = new Date()): string {
  const minutes = Math.floor((now.getTime() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export function formatAgo(iso: IsoDateTime, today: IsoDate): string {
  const n = daysSince(iso, today);
  if (n <= 0) return 'Today';
  if (n === 1) return 'Yesterday';
  return `${n} days ago`;
}

export function weekdayName(iso: IsoDate): string {
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][parseIsoDate(iso).getDay()];
}
