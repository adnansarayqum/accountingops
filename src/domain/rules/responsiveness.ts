import type { Client, Communication, ResponsivenessBand } from '../types';

/** Transparent demo banding based on average response time in days. */
export function responsivenessBand(averageResponseDays: number, remindersIgnored = 0): ResponsivenessBand {
  if (remindersIgnored >= 3) return 'chronic';
  if (averageResponseDays <= 2) return 'fast';
  if (averageResponseDays <= 6) return 'normal';
  if (averageResponseDays <= 14) return 'slow';
  return 'chronic';
}

export interface ResponsivenessProfile {
  band: ResponsivenessBand;
  averageResponseDays: number;
  remindersSent: number;
  remindersIgnored: number;
  lastInbound?: Communication;
  lastOutbound?: Communication;
  suggestion?: string;
}

export function responsivenessProfile(client: Client, comms: Communication[]): ResponsivenessProfile {
  const own = comms.filter((c) => c.clientId === client.id).sort((a, b) => b.sentAt.localeCompare(a.sentAt));
  const outbound = own.filter((c) => c.direction === 'outbound');
  const reminders = outbound.filter((c) => c.reminderStage);
  const ignored = reminders.filter((c) => c.responseStatus === 'awaiting').length;
  const band = responsivenessBand(client.averageResponseDays, ignored);
  let suggestion: string | undefined;
  if (band === 'slow') suggestion = 'Start document requests 14 days earlier than the standard sequence.';
  if (band === 'chronic') suggestion = 'Start requests 30 days earlier and follow up by phone after the second reminder.';
  return {
    band,
    averageResponseDays: client.averageResponseDays,
    remindersSent: reminders.length,
    remindersIgnored: ignored,
    lastInbound: own.find((c) => c.direction === 'inbound'),
    lastOutbound: outbound[0],
    suggestion,
  };
}
