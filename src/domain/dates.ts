import type { IsoDate, IsoDateTime } from './types';

const DAY_MS = 86_400_000;

function zonedParts(d: Date, timeZone?: string): { year: number; month: number; day: number; hour: number; minute: number } {
  if (!timeZone) {
    return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(), hour: d.getHours(), minute: d.getMinutes() };
  }
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return { year: value('year'), month: value('month'), day: value('day'), hour: value('hour'), minute: value('minute') };
}

export function toIsoDateInTimeZone(d: Date, timeZone?: string): IsoDate {
  const { year, month, day } = zonedParts(d, timeZone);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function hourInTimeZone(d: Date, timeZone?: string): number {
  return zonedParts(d, timeZone).hour;
}

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
  const [ay, am, ad] = from.slice(0, 10).split('-').map(Number);
  const [by, bm, bd] = to.slice(0, 10).split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / DAY_MS);
}

export function daysUntil(due: IsoDate, today: IsoDate): number {
  return daysBetween(today, due);
}

export function daysSince(when: IsoDateTime | IsoDate, today: IsoDate, timeZone?: string): number {
  // A timestamp is UTC; `today` is a local calendar date. Slicing the first
  // ten characters off a timestamp mixes the two, so an event at 00:30 BST
  // reads as the previous day. Convert to the local date first.
  const day = when.length > 10 ? toIsoDateInTimeZone(new Date(when), timeZone) : when;
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

export function todayIso(timeZone?: string, now: Date = new Date()): IsoDate {
  return toIsoDateInTimeZone(now, timeZone);
}

const monthsShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatDate(iso: IsoDate | IsoDateTime | undefined, opts: { year?: boolean; timeZone?: string } = {}): string {
  if (!iso) return '—';
  const parts = iso.length > 10
    ? zonedParts(new Date(iso), opts.timeZone)
    : (() => { const [year, month, day] = iso.slice(0, 10).split('-').map(Number); return { year, month, day }; })();
  const base = `${parts.day} ${monthsShort[parts.month - 1]}`;
  return opts.year === false ? base : `${base} ${parts.year}`;
}

export function formatDateTime(iso: IsoDateTime, timeZone?: string): string {
  const parts = zonedParts(new Date(iso), timeZone);
  const hh = String(parts.hour).padStart(2, '0');
  const mm = String(parts.minute).padStart(2, '0');
  return `${formatDate(iso, { timeZone })}, ${hh}:${mm}`;
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

export function formatAgo(iso: IsoDateTime, today: IsoDate, timeZone?: string): string {
  const n = daysSince(iso, today, timeZone);
  if (n <= 0) return 'Today';
  if (n === 1) return 'Yesterday';
  return `${n} days ago`;
}

export function weekdayName(iso: IsoDate): string {
  const [year, month, day] = iso.slice(0, 10).split('-').map(Number);
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
}
