import { describe, expect, it } from 'vitest';
import { isOfficialLetter } from '../intake';

describe('isOfficialLetter', () => {
  it('knows HMRC and Companies House letters from what clients send', () => {
    expect(isOfficialLetter('Penalty notice')).toBe(true);
    expect(isOfficialLetter('Companies House correspondence')).toBe(true);
    expect(isOfficialLetter('Bank statement')).toBe(false);
    expect(isOfficialLetter('Message from the client')).toBe(false);
  });
});
