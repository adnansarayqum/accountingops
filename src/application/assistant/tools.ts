/**
 * Scoped application tools for "Ask the Practice".
 *
 * These are the only surface a future LLM will be given. Each tool takes a
 * narrow input and returns a bounded, tenant-scoped result. The whole
 * database is never handed to a model.
 */
import { daysSince, daysUntil } from '../../domain/dates';
import { maskIdentifier } from '../../domain/rules';
import { IDENTIFIER_LABELS, JOB_STATUS_LABELS, SERVICES } from '../../domain/catalog';
import type { PracticeData, ServiceCode } from '../../domain/types';
import type { Derived } from '../selectors';

export interface ToolContext {
  data: PracticeData;
  derived: Derived;
  today: string;
}

export interface ToolResultRow {
  title: string;
  subtitle?: string;
  href?: string;
  tone?: 'red' | 'amber' | 'green' | 'neutral';
}

export interface ToolResult {
  tool: string;
  answer: string;
  rows: ToolResultRow[];
}

export const assistantTools = {
  search_clients(ctx: ToolContext, query: string): ToolResult {
    const q = query.toLowerCase().trim();
    const rows = ctx.data.clients
      .filter((c) => c.name.toLowerCase().includes(q))
      .slice(0, 10)
      .map((c) => ({ title: c.name, subtitle: SERVICES_LIST(ctx, c.id), href: `/clients/${c.id}` }));
    return { tool: 'search_clients', answer: rows.length ? `${rows.length} client${rows.length === 1 ? '' : 's'} match "${query}".` : `No clients match "${query}".`, rows };
  },

  get_client_identifier(ctx: ToolContext, clientName: string, kind: keyof typeof IDENTIFIER_LABELS): ToolResult {
    const client = findClient(ctx, clientName);
    if (!client) return { tool: 'get_client_identifier', answer: `I couldn't find a client matching "${clientName}".`, rows: [] };
    const idf = ctx.data.identifiers.find((i) => i.clientId === client.id && i.kind === kind);
    if (!idf) return { tool: 'get_client_identifier', answer: `${client.name} has no ${IDENTIFIER_LABELS[kind]} on record.`, rows: [{ title: client.name, href: `/clients/${client.id}` }] };
    return {
      tool: 'get_client_identifier',
      answer: `${client.name}'s ${IDENTIFIER_LABELS[kind]} is ${maskIdentifier(idf.value, kind)}. Open the client record to reveal it in full — reveals are audited.`,
      rows: [{ title: client.name, subtitle: `${IDENTIFIER_LABELS[kind]}: ${maskIdentifier(idf.value, kind)}`, href: `/clients/${client.id}` }],
    };
  },

  get_attention_queue(ctx: ToolContext): ToolResult {
    const rows = ctx.derived.attention.slice(0, 12).map((a) => ({
      title: `${ctx.derived.clientById.get(a.clientId)?.name} — ${a.headline}`,
      subtitle: a.recommendedAction.label,
      href: `/jobs/${a.jobId}`,
      tone: a.severity,
    }));
    const red = ctx.derived.attention.filter((a) => a.severity === 'red').length;
    return { tool: 'get_attention_queue', answer: `${ctx.derived.attention.length} job${ctx.derived.attention.length === 1 ? '' : 's'} need attention today, ${red} at immediate risk.`, rows };
  },

  get_upcoming_jobs(ctx: ToolContext, opts: { service?: ServiceCode; withinDays: number; thisMonth?: boolean }): ToolResult {
    const monthPrefix = ctx.today.slice(0, 7);
    const rows = ctx.derived.jobViews
      .filter((v) => v.job.status !== 'filed')
      .filter((v) => (opts.service ? v.job.serviceCode === opts.service : true))
      .filter((v) => (opts.thisMonth ? v.job.dueDate.startsWith(monthPrefix) : v.daysUntilDue <= opts.withinDays))
      .map((v) => ({
        title: `${v.client.name} — ${v.job.name}`,
        subtitle: `${dueLabel(v.daysUntilDue)} · ${JOB_STATUS_LABELS[v.job.status]}`,
        href: `/jobs/${v.job.id}`,
        tone: v.daysUntilDue < 0 ? ('red' as const) : v.daysUntilDue <= 7 ? ('amber' as const) : ('neutral' as const),
      }));
    const what = opts.service ? SERVICES[opts.service].name.toLowerCase() + 's' : 'jobs';
    const when = opts.thisMonth ? 'this month' : `in the next ${opts.withinDays} days`;
    return { tool: 'get_upcoming_jobs', answer: `${rows.length} ${what} due ${when}.`, rows };
  },

  get_missing_information(ctx: ToolContext, opts: { service?: ServiceCode; withinDays?: number; documentLabel?: string }): ToolResult {
    const rows = ctx.derived.jobViews
      .filter((v) => v.job.status !== 'filed' && !v.completeness.complete)
      .filter((v) => (opts.service ? v.job.serviceCode === opts.service : true))
      .filter((v) => (opts.withinDays !== undefined ? v.daysUntilDue <= opts.withinDays : true))
      .filter((v) => (opts.documentLabel ? v.completeness.missing.some((m) => m.label.toLowerCase().includes(opts.documentLabel!.toLowerCase())) : true))
      .map((v) => ({
        title: `${v.client.name} — ${v.job.name}`,
        subtitle: `Missing: ${v.completeness.missing.map((m) => m.label.toLowerCase()).join(', ')} · ${dueLabel(v.daysUntilDue)}`,
        href: `/jobs/${v.job.id}`,
        tone: v.daysUntilDue <= 7 ? ('red' as const) : ('amber' as const),
      }));
    return { tool: 'get_missing_information', answer: `${rows.length} job${rows.length === 1 ? '' : 's'} still missing information.`, rows };
  },

  get_waiting_on_clients(ctx: ToolContext, opts: { minDaysSilent?: number; needsChasingThisMonth?: boolean }): ToolResult {
    const monthEnd = daysUntil(endOfMonth(ctx.today), ctx.today);
    const rows = ctx.derived.jobViews
      .filter((v) => v.job.status !== 'filed' && v.job.waitingOn === 'client')
      .filter((v) => (opts.needsChasingThisMonth ? v.chasing.required && v.daysUntilDue <= monthEnd + 31 : true))
      .filter((v) => {
        if (opts.minDaysSilent === undefined) return true;
        const profile = ctx.derived.responsivenessByClient.get(v.client.id);
        const last = profile?.lastInbound?.sentAt;
        const silent = last ? daysSince(last, ctx.today, ctx.data.practice.timezone) : 999;
        return silent >= opts.minDaysSilent;
      })
      .map((v) => ({
        title: `${v.client.name} — ${v.job.name}`,
        subtitle: `${v.chasing.reason} ${v.chasing.remindersSent} reminder${v.chasing.remindersSent === 1 ? '' : 's'} sent · ${dueLabel(v.daysUntilDue)}`,
        href: `/jobs/${v.job.id}`,
        tone: v.daysUntilDue <= 7 ? ('red' as const) : ('amber' as const),
      }));
    const clients = new Set(rows.map((r) => r.title.split(' — ')[0])).size;
    return { tool: 'get_waiting_on_clients', answer: `Waiting on ${clients} client${clients === 1 ? '' : 's'} across ${rows.length} job${rows.length === 1 ? '' : 's'}.`, rows };
  },

  get_capacity(ctx: ToolContext, window: 7 | 30 | 60): ToolResult {
    const summary = ctx.derived.capacity[window];
    const rows = summary.rows.map((r) => ({
      title: r.user.name,
      subtitle: `${r.jobCount} jobs · ${r.estimatedHours}h of ${r.availableHours}h · ${r.band === 'overloaded' ? 'Overloaded' : r.band === 'under' ? 'Under capacity' : 'Balanced'}`,
      href: '/capacity',
      tone: r.band === 'overloaded' ? ('red' as const) : r.band === 'under' ? ('amber' as const) : ('green' as const),
    }));
    const overloaded = summary.rows.filter((r) => r.band === 'overloaded').map((r) => r.user.name.split(' ')[0]);
    return { tool: 'get_capacity', answer: overloaded.length ? `${overloaded.join(' and ')} ${overloaded.length === 1 ? 'is' : 'are'} overloaded over the next ${window} days.` : `Nobody is overloaded over the next ${window} days.`, rows };
  },

  get_ready_to_file(ctx: ToolContext): ToolResult {
    const rows = ctx.derived.jobViews.filter((v) => v.job.status === 'ready_to_file').map((v) => ({ title: `${v.client.name} — ${v.job.name}`, subtitle: dueLabel(v.daysUntilDue), href: `/jobs/${v.job.id}`, tone: 'green' as const }));
    return { tool: 'get_ready_to_file', answer: `${rows.length} job${rows.length === 1 ? '' : 's'} ready to file.`, rows };
  },
};

function SERVICES_LIST(ctx: ToolContext, clientId: string): string {
  return ctx.data.subscriptions.filter((s) => s.clientId === clientId && s.active).map((s) => SERVICES[s.serviceCode].shortName).join(' · ');
}

export function findClient(ctx: ToolContext, name: string) {
  const q = name.toLowerCase().replace(/\b(ltd|limited|plc|llp)\b/g, '').trim();
  return ctx.data.clients.find((c) => c.name.toLowerCase().replace(/\b(ltd|limited|plc|llp)\b/g, '').trim() === q)
    ?? ctx.data.clients.find((c) => c.name.toLowerCase().includes(q))
    ?? ctx.data.clients.find((c) => q.split(/\s+/).every((w) => c.name.toLowerCase().includes(w)));
}

function dueLabel(days: number): string {
  if (days < 0) return `overdue by ${Math.abs(days)} days`;
  if (days === 0) return 'due today';
  return `due in ${days} days`;
}

function endOfMonth(today: string): string {
  const [y, m] = today.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
}
