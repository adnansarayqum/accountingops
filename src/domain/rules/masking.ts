import type { IdentifierKind } from '../types';

/**
 * Display-only masking. This is a UX convenience, not a security control:
 * production must enforce field-level authorisation server-side and audit reveals.
 */
export function maskIdentifier(value: string, kind: IdentifierKind): string {
  const clean = value.replace(/\s+/g, '');
  switch (kind) {
    case 'company_number':
      return value; // public information at Companies House
    case 'vat_number':
      return `GB •••• ${clean.slice(-3)}`;
    case 'paye_reference':
      return `${clean.slice(0, 3)}/•••••${clean.slice(-2)}`;
    case 'nino':
      return `${clean.slice(0, 2)} •• •• •• ${clean.slice(-1)}`;
    case 'utr':
    case 'accounts_office_ref':
    default:
      return `•••••${clean.slice(-5)}`;
  }
}

export function formatIdentifier(value: string, kind: IdentifierKind): string {
  const clean = value.replace(/\s+/g, '');
  if (kind === 'nino' && clean.length === 9) {
    return `${clean.slice(0, 2)} ${clean.slice(2, 4)} ${clean.slice(4, 6)} ${clean.slice(6, 8)} ${clean.slice(8)}`;
  }
  if (kind === 'utr' && clean.length === 10) return `${clean.slice(0, 5)} ${clean.slice(5)}`;
  return value;
}
