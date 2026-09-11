/**
 * Companies House returns the same person in two shapes: the officers list
 * gives "HASAN, Mohammad" (surname first, upper-cased) while the PSC list
 * gives "Mr Mohammad Hasan". Keyed on the raw string those are two people,
 * and a practice's register fills up with duplicates. Everything here folds
 * both into one form — "Mohammad Hasan" — for display and for matching.
 *
 * Matching is by that folded name, with month and year of birth (the only
 * part of a date of birth Companies House publishes) as a tie-breaker: two
 * records with the same name but different birth months are two people;
 * a record with no birth month recorded matches on name alone.
 */

const TITLES = new Set(['MR', 'MRS', 'MS', 'MISS', 'MX', 'DR', 'PROF', 'PROFESSOR', 'SIR', 'DAME', 'LORD', 'LADY', 'REV', 'REVD', 'HON', 'CAPT', 'MAJOR', 'COL']);

/** "Forename Surname", titles dropped, each word in its usual case. Already-mixed-case words (McDonald) are left alone. */
export function normalisePersonName(raw: string): string {
  let name = raw.replace(/\s+/g, ' ').trim();
  if (!name) return '';
  const comma = name.indexOf(',');
  if (comma !== -1) {
    const surname = name.slice(0, comma).trim();
    const forenames = name.slice(comma + 1).replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
    name = `${forenames} ${surname}`.trim();
  }
  const words = name.split(' ');
  while (words.length > 1 && TITLES.has(words[0].replace(/\.$/, '').toUpperCase())) words.shift();
  return words.map(caseWord).join(' ');
}

function caseWord(word: string): string {
  if (word !== word.toUpperCase() && word !== word.toLowerCase()) return word;
  return word
    .split(/([-'’])/)
    .map((part) => (/^[-'’]$/.test(part) || part === '' ? part : part[0].toUpperCase() + part.slice(1).toLowerCase()))
    .join('');
}

/** Case-insensitive identity of a normalised name, for matching. */
export function personNameKey(raw: string): string {
  return normalisePersonName(raw).toUpperCase();
}

/** "1980-05" from Companies House's { month, year }; undefined when either half is missing. */
export function birthMonthYearOf(dob: { month: string; year: string } | null | undefined): string | undefined {
  if (!dob?.year || !dob?.month) return undefined;
  return `${dob.year}-${String(dob.month).padStart(2, '0')}`;
}

export interface PersonIdentity {
  name: string;
  birthMonthYear?: string;
}

export function isSamePerson(a: PersonIdentity, b: PersonIdentity): boolean {
  if (personNameKey(a.name) !== personNameKey(b.name)) return false;
  if (a.birthMonthYear && b.birthMonthYear && a.birthMonthYear !== b.birthMonthYear) return false;
  return true;
}
