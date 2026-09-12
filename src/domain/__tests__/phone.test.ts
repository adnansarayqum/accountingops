import { describe, expect, it } from 'vitest';
import { toUkE164Digits } from '../phone';

describe('toUkE164Digits', () => {
  it('reads every common way of writing a UK mobile', () => {
    for (const written of ['07700 900123', '07700900123', '+44 7700 900123', '+447700900123', '0044 7700 900123', '44 7700 900123', '+44 (0)7700 900123', '07700-900-123']) {
      expect(toUkE164Digits(written), written).toBe('447700900123');
    }
  });

  it('accepts a landline, with or without the leading zero', () => {
    expect(toUkE164Digits('020 7946 0958')).toBe('442079460958');
    expect(toUkE164Digits('+44 20 7946 0958')).toBe('442079460958');
  });

  it('is null for anything that is not a UK number', () => {
    expect(toUkE164Digits('')).toBeNull();
    expect(toUkE164Digits(undefined)).toBeNull();
    expect(toUkE164Digits('+1 415 555 0100')).toBeNull();
    expect(toUkE164Digits('077')).toBeNull();
    expect(toUkE164Digits('not a number')).toBeNull();
  });
});
