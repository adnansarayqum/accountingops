import { describe, expect, it } from 'vitest';
import { normaliseCompanyNumber } from '../companyNumber.mjs';
import { normaliseCompanyNumber as clientNormalise } from '../../../src/domain/companyNumber.ts';

describe('server normaliseCompanyNumber', () => {
  it('matches the client-side normaliser exactly', () => {
    for (const input of ['8654123', '08654123', ' 0865 4123 ', 'sc123456', 'SC 123456', 'NI012345', '1', '12345678', '123456789', '', null, undefined, 8654123]) {
      expect(normaliseCompanyNumber(input)).toBe(clientNormalise(input));
    }
  });

  it('pads short numeric numbers to eight digits', () => {
    expect(normaliseCompanyNumber('8654123')).toBe('08654123');
    expect(normaliseCompanyNumber('SC 123456')).toBe('SC123456');
  });
});
