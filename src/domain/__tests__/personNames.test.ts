import { describe, expect, it } from 'vitest';
import { birthMonthYearOf, isSamePerson, normalisePersonName, personNameKey } from '../personNames';

describe('normalisePersonName', () => {
  it('turns the officers-list "SURNAME, Forename" form into "Forename Surname"', () => {
    expect(normalisePersonName('HASAN, Mohammad')).toBe('Mohammad Hasan');
    expect(normalisePersonName('SMITH, Jane Elizabeth')).toBe('Jane Elizabeth Smith');
  });

  it('drops the title from the PSC-list "Mr Forename Surname" form', () => {
    expect(normalisePersonName('Mr Mohammad Hasan')).toBe('Mohammad Hasan');
    expect(normalisePersonName('Mrs. Jane Smith')).toBe('Jane Smith');
    expect(normalisePersonName('Dr Priya Patel')).toBe('Priya Patel');
  });

  it('leaves a plain, already-cased name alone', () => {
    expect(normalisePersonName('Jane Smith')).toBe('Jane Smith');
    expect(normalisePersonName('Ronald McDonald')).toBe('Ronald McDonald');
    expect(normalisePersonName("Siobhan O'Brien")).toBe("Siobhan O'Brien");
  });

  it('cases shouting or whispering names, keeping hyphens and apostrophes', () => {
    expect(normalisePersonName('SMITH-JONES, ANNA')).toBe('Anna Smith-Jones');
    expect(normalisePersonName("o'brien, siobhan")).toBe("Siobhan O'Brien");
  });

  it('collapses stray whitespace and never strips a name down to nothing', () => {
    expect(normalisePersonName('  SMITH ,   Jane  ')).toBe('Jane Smith');
    expect(normalisePersonName('Mr')).toBe('Mr');
    expect(normalisePersonName('')).toBe('');
  });
});

describe('personNameKey', () => {
  it('is the same for every spelling Companies House uses for one person', () => {
    const key = personNameKey('Mohammad Hasan');
    expect(personNameKey('HASAN, Mohammad')).toBe(key);
    expect(personNameKey('Mr Mohammad Hasan')).toBe(key);
    expect(personNameKey('mohammad hasan')).toBe(key);
  });
});

describe('birthMonthYearOf', () => {
  it('formats month and year, zero-padding the month', () => {
    expect(birthMonthYearOf({ month: '5', year: '1980' })).toBe('1980-05');
    expect(birthMonthYearOf({ month: '11', year: '1975' })).toBe('1975-11');
  });

  it('is undefined when Companies House gave nothing', () => {
    expect(birthMonthYearOf(null)).toBeUndefined();
    expect(birthMonthYearOf(undefined)).toBeUndefined();
    expect(birthMonthYearOf({ month: '', year: '1980' })).toBeUndefined();
  });
});

describe('isSamePerson', () => {
  it('matches the two Companies House spellings of one person', () => {
    expect(isSamePerson({ name: 'HASAN, Mohammad', birthMonthYear: '1985-03' }, { name: 'Mr Mohammad Hasan', birthMonthYear: '1985-03' })).toBe(true);
  });

  it('keeps two namesakes apart when their birth months differ', () => {
    expect(isSamePerson({ name: 'John Smith', birthMonthYear: '1960-01' }, { name: 'SMITH, John', birthMonthYear: '1992-07' })).toBe(false);
  });

  it('matches on name alone when either side has no birth month recorded', () => {
    expect(isSamePerson({ name: 'John Smith' }, { name: 'SMITH, John', birthMonthYear: '1992-07' })).toBe(true);
    expect(isSamePerson({ name: 'John Smith', birthMonthYear: '1992-07' }, { name: 'Mr John Smith' })).toBe(true);
  });

  it('never matches different names', () => {
    expect(isSamePerson({ name: 'John Smith' }, { name: 'Jane Smith' })).toBe(false);
  });
});
