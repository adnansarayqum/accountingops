/**
 * One spelling for a company number wherever it is stored, compared or
 * looked up. Companies House numbers are eight characters — either all
 * digits or a two-letter prefix (SC, NI, OC…) and six digits — but a
 * spreadsheet cell that held one as a number has lost its leading zeros
 * ("08654123" arrives as 8654123), and Companies House answers 404 to the
 * seven-digit form. Digits-only values are padded back to eight; anything
 * else just loses its spaces and gains capitals.
 */
export function normaliseCompanyNumber(raw: string | number | null | undefined): string {
  const compact = String(raw ?? '')
    .replace(/\s+/g, '')
    .toUpperCase();
  return /^\d{1,7}$/.test(compact) ? compact.padStart(8, '0') : compact;
}
