import { describe, expect, it } from 'vitest';
import { normaliseCompanyNumber } from '../companyNumber';

describe('normaliseCompanyNumber', () => {
  it('restores the leading zeros a numeric spreadsheet cell drops', () => {
    expect(normaliseCompanyNumber(8654123)).toBe('08654123');
    expect(normaliseCompanyNumber('8654123')).toBe('08654123');
    expect(normaliseCompanyNumber('123')).toBe('00000123');
  });

  it('leaves a full eight-digit number alone', () => {
    expect(normaliseCompanyNumber('14829301')).toBe('14829301');
  });

  it('upper-cases prefixed numbers and strips spaces, without padding them', () => {
    expect(normaliseCompanyNumber('sc123456')).toBe('SC123456');
    expect(normaliseCompanyNumber(' NI 000123 ')).toBe('NI000123');
    expect(normaliseCompanyNumber('OC 30 12 34')).toBe('OC301234');
  });

  it('gives the same answer for every spelling of one number', () => {
    const forms = ['08654123', '8654123', ' 08654123 ', 8654123, '0865 4123'];
    expect(new Set(forms.map(normaliseCompanyNumber)).size).toBe(1);
  });

  it('is empty for nothing', () => {
    expect(normaliseCompanyNumber(undefined)).toBe('');
    expect(normaliseCompanyNumber(null)).toBe('');
    expect(normaliseCompanyNumber('')).toBe('');
  });
});
