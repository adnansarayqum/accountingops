/**
 * UK phone numbers the way people type them — "07700 900123", "+44 7700
 * 900123", "0044…", "(0)7700…" — to the digits WhatsApp and SMS senders
 * want: country code first, no plus, no spaces ("447700900123").
 * Returns null for anything that doesn't look like a UK number at all.
 */
export function toUkE164Digits(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\(0\)/g, '').replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('0')) digits = `44${digits.slice(1)}`;
  if (!digits.startsWith('44')) return null;
  const national = digits.slice(2);
  // UK mobile and landline national numbers are 10 digits (a few older landlines are 9).
  if (national.length < 9 || national.length > 10) return null;
  return digits;
}
