import { describe, expect, it } from 'vitest';
import { mapRosterRecords, parseSpreadsheetDate } from '../clientRosterFile';

describe('mapRosterRecords', () => {
  it('maps known header variants to roster fields, including dates', () => {
    const { rows, warnings } = mapRosterRecords([
      {
        Name: 'Acme Trading Ltd',
        'Company no': '13579246',
        'UTR number': '1122334455',
        'Auth code': 'ACM123',
        'Next accounts': new Date(2026, 5, 30),
        Due: new Date(2027, 2, 31),
        'Date for CS': new Date(2026, 10, 15),
      },
    ]);
    expect(warnings).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: 'Acme Trading Ltd',
      companyNumber: '13579246',
      utr: '1122334455',
      chAuthCode: 'ACM123',
      accountsPeriodEnd: '2026-06-30',
      accountsDue: '2027-03-31',
      confirmationStatementDue: '2026-11-15',
    });
  });

  it('is case- and whitespace-insensitive about headers, and accepts synonyms', () => {
    const { rows } = mapRosterRecords([{ '  name  ': 'Synonym Ltd', 'COMPANY NUMBER': '10101010', 'Government Gateway': 'GG-123' }]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'Synonym Ltd', companyNumber: '10101010', gatewayCredentials: 'GG-123' });
  });

  it('skips rows missing a name or company number and reports why', () => {
    const { rows, warnings } = mapRosterRecords([{ Name: 'No Company Ltd' }, { 'Company no': '11112222' }, { Name: 'Good Ltd', 'Company no': '33334444' }]);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Good Ltd');
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('No Company Ltd');
    // The row number counts the header as row 1, the way the spreadsheet shows it.
    expect(warnings[1]).toContain('row 3 of the sheet');
  });

  it('notes unrecognised columns rather than failing or ignoring them silently', () => {
    const { rows, notes } = mapRosterRecords([{ Name: 'Extra Ltd', 'Company no': '55556666', 'Some other column': 'ignored', Fee: 500 }]);
    expect(rows).toHaveLength(1);
    expect(rows[0].companyNumber).toBe('55556666');
    expect(notes).toEqual(['Columns "Some other column", "Fee" not recognised and ignored.']);
  });

  it('notes cells under a blank or merged header', () => {
    const { rows, notes } = mapRosterRecords([{ Name: 'Merged Ltd', 'Company no': '55556667', __EMPTY: 'stray', __EMPTY_1: undefined }]);
    expect(rows).toHaveLength(1);
    expect(notes).toEqual(['1 cell under a blank or merged header ignored.']);
  });

  it('leaves a date field unset when the cell is blank, and says so when it is unreadable', () => {
    const { rows, notes } = mapRosterRecords([{ Name: 'Blank Dates Ltd', 'Company no': '77778888', Due: '', 'Date for CS': 'not a date' }]);
    expect(rows[0].accountsDue).toBeUndefined();
    expect(rows[0].confirmationStatementDue).toBeUndefined();
    expect(notes).toEqual(['Blank Dates Ltd: couldn\'t read "not a date" as a date for Date for CS — left blank.']);
  });

  it('reads UK-style typed dates and unformatted Excel date serials', () => {
    const { rows, notes } = mapRosterRecords([
      { Name: 'Typed Dates Ltd', 'Company no': '77778889', 'Next accounts': '30/06/2026', Due: '31/03/2027', 'Date for CS': 46341 },
    ]);
    expect(notes).toEqual([]);
    expect(rows[0]).toMatchObject({ accountsPeriodEnd: '2026-06-30', accountsDue: '2027-03-31', confirmationStatementDue: '2026-11-15' });
  });

  it('restores the leading zero a numeric company-number cell lost', () => {
    const { rows } = mapRosterRecords([{ Name: 'Zero Ltd', 'Company no': 8654123 }]);
    expect(rows[0].companyNumber).toBe('08654123');
  });

  it('skips a second row with the same company number as an earlier one, naming the earlier row', () => {
    const { rows, warnings } = mapRosterRecords([
      { Name: 'First Ltd', 'Company no': '08654123' },
      { Name: 'First Ltd (again)', 'Company no': '8654123' },
    ]);
    expect(rows).toHaveLength(1);
    expect(warnings).toEqual(['First Ltd (again): same company number (08654123) as First Ltd earlier in the file — skipped.']);
  });
});

describe('parseSpreadsheetDate', () => {
  it('reads day-first, never month-first', () => {
    expect(parseSpreadsheetDate('03/04/2027')).toBe('2027-04-03');
    expect(parseSpreadsheetDate('31/03/2027')).toBe('2027-03-31');
    expect(parseSpreadsheetDate('31-03-2027')).toBe('2027-03-31');
    expect(parseSpreadsheetDate('31.03.2027')).toBe('2027-03-31');
    expect(parseSpreadsheetDate('1/4/27')).toBe('2027-04-01');
  });

  it('reads ISO and written-out dates', () => {
    expect(parseSpreadsheetDate('2027-03-31')).toBe('2027-03-31');
    expect(parseSpreadsheetDate('2027-03-31T00:00:00')).toBe('2027-03-31');
    expect(parseSpreadsheetDate('31 March 2027')).toBe('2027-03-31');
    expect(parseSpreadsheetDate('31 Mar 2027')).toBe('2027-03-31');
  });

  it('reads a real date cell and an Excel serial', () => {
    expect(parseSpreadsheetDate(new Date(2027, 2, 31))).toBe('2027-03-31');
    expect(parseSpreadsheetDate(46477)).toBe('2027-03-31');
    expect(parseSpreadsheetDate(45658)).toBe('2025-01-01');
  });

  it('is null for a blank cell and invalid for nonsense, an impossible date, or an implausible number', () => {
    expect(parseSpreadsheetDate('')).toBeNull();
    expect(parseSpreadsheetDate('   ')).toBeNull();
    expect(parseSpreadsheetDate(null)).toBeNull();
    expect(parseSpreadsheetDate(undefined)).toBeNull();
    expect(parseSpreadsheetDate('not a date')).toBe('invalid');
    expect(parseSpreadsheetDate('31/02/2027')).toBe('invalid');
    expect(parseSpreadsheetDate('13/13/2027')).toBe('invalid');
    expect(parseSpreadsheetDate(12)).toBe('invalid');
    expect(parseSpreadsheetDate(true)).toBe('invalid');
  });
});
