import { describe, expect, it } from 'vitest';
import { mapRosterRecords } from '../clientRosterFile';

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
  });

  it('ignores unrecognised columns rather than failing', () => {
    const { rows } = mapRosterRecords([{ Name: 'Extra Ltd', 'Company no': '55556666', 'Some other column': 'ignored' }]);
    expect(rows).toHaveLength(1);
    expect(rows[0].companyNumber).toBe('55556666');
  });

  it('leaves a date field unset when the cell is blank or unparsable', () => {
    const { rows } = mapRosterRecords([{ Name: 'Blank Dates Ltd', 'Company no': '77778888', Due: '', 'Date for CS': 'not a date' }]);
    expect(rows[0].accountsDue).toBeUndefined();
    expect(rows[0].confirmationStatementDue).toBeUndefined();
  });
});
