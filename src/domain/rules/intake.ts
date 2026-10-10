/**
 * Document types the intake reader (server/lib/intakeReader.mjs) can name
 * that are letters from HMRC or Companies House rather than something the
 * client sent. Attaching one is not the client getting in touch.
 */
export const OFFICIAL_LETTER_TYPES: ReadonlySet<string> = new Set([
  'Corporation Tax notice to deliver',
  'Corporation Tax statement',
  'Self Assessment statement',
  'Self Assessment notice',
  'VAT notice',
  'PAYE notice',
  'Penalty notice',
  'Companies House correspondence',
  'Other HMRC letter',
]);

export function isOfficialLetter(documentType: string): boolean {
  return OFFICIAL_LETTER_TYPES.has(documentType);
}
