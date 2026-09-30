/**
 * Server copy of src/domain/companyNumber.ts — the server runs as plain
 * Node and cannot import TypeScript. A parity test imports both, so the two
 * cannot drift apart unnoticed.
 */
export function normaliseCompanyNumber(raw) {
  const compact = String(raw ?? '')
    .replace(/\s+/g, '')
    .toUpperCase();
  return /^\d{1,7}$/.test(compact) ? compact.padStart(8, '0') : compact;
}
