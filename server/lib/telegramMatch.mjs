/**
 * Telegram letter matching — pure. Decides which client a letter belongs
 * to from what the vision model read, but never on the model's word alone:
 * an identifier printed on the letter that matches exactly one client is
 * closer to ground truth than a self-reported confidence score.
 */
import { normaliseCompanyNumber } from './companyNumber.mjs';

export const AUTO_FILE_THRESHOLD = 0.85;
const IDENTIFIER_MATCH_CONFIDENCE = 0.95;
const MAX_CANDIDATES = 3;

/**
 * The only identifier kinds that ever leave the server. Everything else a
 * practice records (Companies House auth codes, Gateway credentials,
 * personal codes, NINOs) is a credential or personal data a letter match
 * does not need — so it is allow-listed, not deny-listed.
 */
const SHAREABLE_KINDS = ['company_number', 'utr', 'vat_number', 'paye_reference'];

const digitsOnly = (value) => String(value ?? '').replace(/\D/g, '');
const compact = (value) => String(value ?? '').replace(/\s+/g, '').toUpperCase();

/** Per kind: how an extracted value and a stored one are compared. */
const COMPARE = {
  company_number: (value) => normaliseCompanyNumber(value),
  utr: digitsOnly,
  vat_number: (value) => digitsOnly(value).replace(/^0+/, ''),
  paye_reference: compact,
};

const EXTRACTED_FIELD = { company_number: 'companyNumber', utr: 'utr', vat_number: 'vatNumber', paye_reference: 'payeReference' };
const KIND_LABEL = { company_number: 'Company number', utr: 'UTR', vat_number: 'VAT number', paye_reference: 'PAYE reference' };

/** What the model is shown: each client's name and only its shareable identifiers. */
export function buildRoster(snapshot) {
  const clients = Array.isArray(snapshot?.clients) ? snapshot.clients : [];
  const identifiers = Array.isArray(snapshot?.identifiers) ? snapshot.identifiers : [];
  return clients.map((client) => ({
    id: client.id,
    name: client.name,
    identifiers: identifiers
      .filter((i) => i.clientId === client.id && !i.sensitive && SHAREABLE_KINDS.includes(i.kind) && i.value)
      .map((i) => ({ kind: i.kind, value: i.value })),
  }));
}

/** Clients whose stored identifier equals one the model read off the letter. */
function identifierMatches(extraction, roster) {
  const matches = [];
  for (const kind of SHAREABLE_KINDS) {
    const read = extraction?.identifiers?.[EXTRACTED_FIELD[kind]];
    const wanted = read ? COMPARE[kind](read) : '';
    if (!wanted) continue;
    for (const client of roster) {
      if (client.identifiers.some((i) => i.kind === kind && COMPARE[kind](i.value) === wanted)) {
        matches.push({ clientId: client.id, kind, value: read });
      }
    }
  }
  return matches;
}

function suggestionFrom(extraction, clientId, confidence, rationale) {
  return {
    clientId,
    documentType: extraction.documentType || 'Other',
    period: extraction.period || undefined,
    extractedReference: extraction.reference || undefined,
    extractedDate: /^\d{4}-\d{2}-\d{2}$/.test(extraction.letterDate ?? '') ? extraction.letterDate : undefined,
    confidence: Math.max(0, Math.min(1, confidence)),
    rationale,
  };
}

/**
 * { kind: 'filed', clientId, suggestion } — confident enough to file.
 * { kind: 'unsure', candidates, suggestion } — ask; candidates are client
 * ids, best first, possibly empty.
 */
export function decideMatch(extraction, snapshot) {
  const roster = buildRoster(snapshot);
  const known = new Set(roster.map((c) => c.id));
  const modelPick = known.has(extraction?.clientId) ? extraction.clientId : null;
  const modelConfidence = modelPick ? Number(extraction.confidence) || 0 : 0;

  const byIdentifier = identifierMatches(extraction, roster);
  const identifiedClients = [...new Set(byIdentifier.map((m) => m.clientId))];

  if (identifiedClients.length === 1) {
    const clientId = identifiedClients[0];
    const match = byIdentifier.find((m) => m.clientId === clientId);
    const disagreed = modelPick && modelPick !== clientId ? ' (overriding the model’s own guess)' : '';
    const rationale = `${KIND_LABEL[match.kind]} ${match.value} on the letter matches this client${disagreed}.`;
    return { kind: 'filed', clientId, suggestion: suggestionFrom(extraction, clientId, Math.max(IDENTIFIER_MATCH_CONFIDENCE, modelPick === clientId ? modelConfidence : 0), rationale) };
  }

  // Two clients sharing an identifier the letter shows is a data problem the
  // model cannot settle — never auto-file over it.
  if (identifiedClients.length === 0 && modelPick && modelConfidence >= AUTO_FILE_THRESHOLD) {
    return { kind: 'filed', clientId: modelPick, suggestion: suggestionFrom(extraction, modelPick, modelConfidence, extraction.rationale || 'Matched from the letter’s contents.') };
  }

  const candidates = [...new Set([...identifiedClients, ...(modelPick ? [modelPick] : [])])].slice(0, MAX_CANDIDATES);
  const best = candidates[0] ?? null;
  const rationale = identifiedClients.length > 1 ? 'The letter’s reference matches more than one client.' : extraction?.rationale || 'Could not tell which client this is for.';
  return { kind: 'unsure', candidates, suggestion: suggestionFrom(extraction ?? {}, best, modelPick ? modelConfidence : 0, rationale) };
}
