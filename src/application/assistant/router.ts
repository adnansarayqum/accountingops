/**
 * Deterministic question router. Maps natural-language questions to scoped
 * tools. A real LLM can replace `routeQuestion` with tool-calling while the
 * tool surface in ./tools.ts stays exactly the same.
 */
import { IDENTIFIER_LABELS } from '../../domain/catalog';
import type { IdentifierKind, ServiceCode } from '../../domain/types';
import { assistantTools, type ToolContext, type ToolResult } from './tools';

export const EXAMPLE_QUESTIONS = [
  'What needs my attention today?',
  'Which VAT returns are due this month?',
  'Show clients we are waiting on.',
  'Which jobs are at risk?',
  'Show accounts due within 60 days where bank statements are missing.',
  'Which clients haven\'t replied for more than 14 days?',
  'What is ABC Construction\'s UTR?',
  'Who is overloaded next week?',
  'Which clients still need chasing this month?',
  'What is ready to file?',
];

const SERVICE_WORDS: [RegExp, ServiceCode][] = [
  [/\bvat\b/, 'vat'],
  [/\bpayroll\b/, 'payroll'],
  [/\b(self[- ]assessment|tax returns?|sa\b)/, 'self_assessment'],
  [/\bconfirmation statements?\b/, 'confirmation_statement'],
  [/\bcorporation tax|ct600\b/, 'corporation_tax'],
  [/\bmtd\b/, 'mtd_income_tax'],
  [/\baccounts?\b/, 'annual_accounts'],
];

const IDENTIFIER_WORDS: [RegExp, IdentifierKind][] = [
  [/\butr\b/, 'utr'],
  [/\b(ni|nino|national insurance)\b/, 'nino'],
  [/\bcompany (number|no)\b/, 'company_number'],
  [/\bvat (number|no|reg)/, 'vat_number'],
  [/\bpaye\b/, 'paye_reference'],
];

export function routeQuestion(ctx: ToolContext, raw: string): ToolResult {
  const q = raw.toLowerCase().trim();

  // Identifier lookups: "What's ABC Ltd's UTR?"
  for (const [re, kind] of IDENTIFIER_WORDS) {
    if (re.test(q)) {
      const m = raw.match(/(?:what(?:'s| is| are)?|show|find|get)\s+(.+?)(?:'s|’s)?\s+(utr|ni number|nino|national insurance(?: number)?|company number|vat number|paye(?: reference)?)/i)
        ?? raw.match(/(utr|nino|ni number|company number|vat number|paye reference)\s+(?:for|of)\s+(.+?)\??$/i);
      const name = m ? (m[2] && /for|of/.test(raw) && !/what/i.test(raw) ? m[2] : m[1]) : '';
      if (name) return assistantTools.get_client_identifier(ctx, name.replace(/\?$/, '').trim(), kind);
      return { tool: 'get_client_identifier', answer: `Which client's ${IDENTIFIER_LABELS[kind]} do you need? Try "What is ABC Construction's ${IDENTIFIER_LABELS[kind]}?"`, rows: [] };
    }
  }

  if (/overload|capacity|workload|busy/.test(q)) {
    const window = /month|30/.test(q) ? 30 : /60/.test(q) ? 60 : 7;
    return assistantTools.get_capacity(ctx, window);
  }
  if (/ready to file|ready for filing/.test(q)) return assistantTools.get_ready_to_file(ctx);
  if (/attention|at risk|risk|urgent|worry|worried/.test(q)) return assistantTools.get_attention_queue(ctx);

  if (/haven'?t replied|not replied|no reply|silent|not responded|no response/.test(q)) {
    const days = Number(q.match(/(\d+)\s*days?/)?.[1] ?? 14);
    return assistantTools.get_waiting_on_clients(ctx, { minDaysSilent: days });
  }
  if (/chas/.test(q)) return assistantTools.get_waiting_on_clients(ctx, { needsChasingThisMonth: /month/.test(q) });
  if (/waiting on|waiting for/.test(q)) return assistantTools.get_waiting_on_clients(ctx, {});

  const service = SERVICE_WORDS.find(([re]) => re.test(q))?.[1];
  if (/missing|outstanding|still need/.test(q)) {
    const days = Number(q.match(/(\d+)\s*days?/)?.[1] ?? 60);
    const docMatch = q.match(/where (.+?) (?:are|is) missing/) ?? q.match(/missing (.+?)(?:\?|$)/);
    const documentLabel = docMatch?.[1]?.replace(/\b(are|is|the)\b/g, '').trim();
    return assistantTools.get_missing_information(ctx, { service, withinDays: /within|next|days/.test(q) ? days : undefined, documentLabel: documentLabel && documentLabel.length > 2 && !/information|documents?/.test(documentLabel) ? documentLabel : undefined });
  }
  if (/due|deadline|upcoming|this month|this week|next week/.test(q) || service) {
    const thisMonth = /this month/.test(q);
    const days = /this week/.test(q) ? 7 : /next week/.test(q) ? 14 : Number(q.match(/(\d+)\s*days?/)?.[1] ?? 30);
    return assistantTools.get_upcoming_jobs(ctx, { service, withinDays: days, thisMonth });
  }

  // Fallback: treat as a client search
  const clientHit = assistantTools.search_clients(ctx, raw.replace(/[?.]/g, '').replace(/^(show|find|open|who is|what is)\s+/i, ''));
  if (clientHit.rows.length > 0) return clientHit;

  return {
    tool: 'none',
    answer: "I couldn't map that to something I can answer yet. Try one of the example questions — I can answer about deadlines, missing information, chasing, capacity and client identifiers.",
    rows: [],
  };
}
