import { describe, expect, it } from 'vitest';
import { AUTO_FILE_THRESHOLD, buildRoster, decideMatch } from '../telegramMatch.mjs';

const identifier = (clientId, kind, value, sensitive = false) => ({ id: `id_${clientId}_${kind}`, practiceId: 'prac_main', clientId, kind, value, sensitive });

const snapshot = {
  clients: [
    { id: 'cl_acme', name: 'Acme Ltd' },
    { id: 'cl_khan', name: 'Khan Consulting' },
    { id: 'cl_scot', name: 'Highland Ltd' },
  ],
  identifiers: [
    identifier('cl_acme', 'company_number', '08654123'),
    identifier('cl_acme', 'ch_auth_code', 'ABC123', true),
    identifier('cl_acme', 'gateway_credentials', 'user:pass', true),
    identifier('cl_khan', 'utr', '12345 67890'),
    identifier('cl_khan', 'nino', 'QQ123456C', true),
    identifier('cl_khan', 'vat_number', 'GB 123 4567 89'),
    identifier('cl_scot', 'company_number', 'SC123456'),
  ],
};

const read = (overrides = {}) => ({
  documentType: 'Corporation Tax notice to deliver',
  reference: '1234567890',
  letterDate: '2026-09-20',
  period: '2025-26',
  identifiers: { companyNumber: null, utr: null, vatNumber: null, payeReference: null },
  clientId: null,
  confidence: 0,
  rationale: 'Name on the letter.',
  ...overrides,
});

describe('buildRoster', () => {
  it('sends names and only allow-listed, non-sensitive identifiers — never credentials', () => {
    const roster = buildRoster(snapshot);
    const text = JSON.stringify(roster);
    expect(roster.find((c) => c.id === 'cl_acme').identifiers).toEqual([{ kind: 'company_number', value: '08654123' }]);
    for (const secret of ['ABC123', 'user:pass', 'QQ123456C']) expect(text).not.toContain(secret);
  });

  it('copes with an empty or missing snapshot', () => {
    expect(buildRoster(null)).toEqual([]);
    expect(buildRoster({ clients: [{ id: 'c', name: 'C' }] })).toEqual([{ id: 'c', name: 'C', identifiers: [] }]);
  });
});

describe('decideMatch', () => {
  it('files on a company number however it was printed', () => {
    for (const printed of ['8654123', '08654123', '0865 4123']) {
      const decision = decideMatch(read({ identifiers: { companyNumber: printed } }), snapshot);
      expect(decision).toMatchObject({ kind: 'filed', clientId: 'cl_acme' });
      expect(decision.suggestion.confidence).toBeGreaterThanOrEqual(0.95);
      expect(decision.suggestion.rationale).toMatch(/Company number/);
    }
    expect(decideMatch(read({ identifiers: { companyNumber: 'sc 123456' } }), snapshot).clientId).toBe('cl_scot');
  });

  it('files on a UTR or VAT number regardless of spacing and prefixes', () => {
    expect(decideMatch(read({ identifiers: { utr: '1234567890' } }), snapshot).clientId).toBe('cl_khan');
    expect(decideMatch(read({ identifiers: { vatNumber: '123456789' } }), snapshot).clientId).toBe('cl_khan');
  });

  it('lets an identifier on the letter overrule the model’s own pick', () => {
    const decision = decideMatch(read({ identifiers: { companyNumber: '08654123' }, clientId: 'cl_khan', confidence: 0.9 }), snapshot);
    expect(decision).toMatchObject({ kind: 'filed', clientId: 'cl_acme' });
    expect(decision.suggestion.rationale).toMatch(/overriding/);
  });

  it('trusts a confident model pick when no identifier is printed', () => {
    const decision = decideMatch(read({ clientId: 'cl_khan', confidence: AUTO_FILE_THRESHOLD }), snapshot);
    expect(decision).toMatchObject({ kind: 'filed', clientId: 'cl_khan' });
    expect(decision.suggestion).toMatchObject({ documentType: 'Corporation Tax notice to deliver', extractedReference: '1234567890', extractedDate: '2026-09-20', period: '2025-26' });
  });

  it('asks instead of filing below the threshold, offering the model’s guess', () => {
    const decision = decideMatch(read({ clientId: 'cl_khan', confidence: 0.6 }), snapshot);
    expect(decision).toMatchObject({ kind: 'unsure', candidates: ['cl_khan'] });
  });

  it('ignores a client id the model made up', () => {
    expect(decideMatch(read({ clientId: 'cl_nope', confidence: 0.99 }), snapshot)).toMatchObject({ kind: 'unsure', candidates: [] });
  });

  it('never auto-files when the printed identifier belongs to two clients', () => {
    const shared = { ...snapshot, identifiers: [...snapshot.identifiers, identifier('cl_scot', 'utr', '1234567890')] };
    const decision = decideMatch(read({ identifiers: { utr: '1234567890' }, clientId: 'cl_khan', confidence: 0.99 }), shared);
    expect(decision.kind).toBe('unsure');
    expect(decision.candidates.sort()).toEqual(['cl_khan', 'cl_scot']);
  });

  it('drops a malformed date rather than passing it on', () => {
    expect(decideMatch(read({ clientId: 'cl_khan', confidence: 0.9, letterDate: '20/09/2026' }), snapshot).suggestion.extractedDate).toBeUndefined();
  });
});
