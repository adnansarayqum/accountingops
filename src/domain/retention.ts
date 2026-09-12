import type { AuditEvent, PracticeData } from './types';

/**
 * Retention caps for the feeds that grow with every action. The whole
 * practice snapshot is saved on every change (and, in browser-only mode,
 * lives in localStorage's few megabytes), so unbounded feeds would
 * eventually make every save slower and finally impossible. Business
 * records — clients, jobs, communications, documents — are never trimmed.
 *
 * Every feed is kept newest-first, so "the first N" is "the newest N".
 */
export const RETENTION = Object.freeze({
  /** Activity feed entries kept. */
  activities: 2000,
  /** Audit log entries kept. */
  auditEvents: 2000,
  /**
   * Audit entries that keep their full before/after payload. Older entries
   * keep the header (who, what, which record, when, correlation id) but not
   * the values — except identity-related actions, whose payloads are small,
   * already redacted, and the ones worth being able to scroll back to.
   */
  auditDetail: 500,
  /** Notifications kept (read or unread). */
  notifications: 500,
  /** Longest before/after payload (as JSON) kept verbatim on any audit entry. */
  auditPayloadChars: 2000,
});

/** Actions whose before/after payloads are kept for as long as the entry itself. */
const DETAIL_KEPT_FOR = /^(identifier\.|person_role\.verification)/;

/**
 * Replaces an over-long before/after payload with a short summary of what
 * it was, so one bulk action (an import of hundreds of clients, say) can't
 * add kilobytes to every save from then on.
 */
export function trimAuditPayload(value: unknown): unknown {
  if (value === undefined || value === null) return value;
  const json = JSON.stringify(value);
  if (json === undefined || json.length <= RETENTION.auditPayloadChars) return value;
  if (Array.isArray(value)) return { truncated: true, chars: json.length, length: value.length };
  if (typeof value === 'object') return { truncated: true, chars: json.length, keys: Object.keys(value as object).slice(0, 20) };
  return { truncated: true, chars: json.length };
}

function hasPayload(event: AuditEvent): boolean {
  return event.before !== undefined || event.after !== undefined;
}

function retainAuditEvent(event: AuditEvent, index: number): AuditEvent {
  if (index >= RETENTION.auditDetail && !DETAIL_KEPT_FOR.test(event.action)) {
    if (!hasPayload(event)) return event;
    const { before: _before, after: _after, ...header } = event;
    return header;
  }
  const before = trimAuditPayload(event.before);
  const after = trimAuditPayload(event.after);
  if (before === event.before && after === event.after) return event;
  return { ...event, before, after };
}

/**
 * Applies the caps above. Pure: returns the same object when nothing is
 * over its cap, and never mutates the input (older audit entries that lose
 * their payload are copied, not edited in place).
 */
export function applyRetention(data: PracticeData): PracticeData {
  let changed = false;
  const result = { ...data };

  if (data.activities.length > RETENTION.activities) {
    result.activities = data.activities.slice(0, RETENTION.activities);
    changed = true;
  }
  if (data.notifications.length > RETENTION.notifications) {
    result.notifications = data.notifications.slice(0, RETENTION.notifications);
    changed = true;
  }

  const kept = data.auditEvents.length > RETENTION.auditEvents ? data.auditEvents.slice(0, RETENTION.auditEvents) : data.auditEvents;
  let auditChanged = kept !== data.auditEvents;
  const auditEvents = kept.map((event, index) => {
    const retained = retainAuditEvent(event, index);
    if (retained !== event) auditChanged = true;
    return retained;
  });
  if (auditChanged) {
    result.auditEvents = auditEvents;
    changed = true;
  }

  return changed ? result : data;
}
